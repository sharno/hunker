use std::{collections::HashMap, sync::Arc};

use futures::{StreamExt, TryStreamExt, stream};
use serde::{Deserialize, Serialize};

use crate::{
    cache::SingleFlightCache,
    character_diff::{self, CharacterDiffRow},
    diff,
    error::{AppError, AppResult},
    github::GitHub,
    local::Local,
    revision::{RevisionKey, RevisionSnapshot},
    semantic::{MovedBlock, SemanticResult},
    source_presentation::FilePresentation,
    types::{FilePair, RelativePath},
};

const SNAPSHOT_CACHE_SIZE: usize = 16;
const FILE_ANALYSIS_CONCURRENCY: usize = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InlineDiff {
    Off,
    Token,
    Character,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WhitespaceMode {
    Ignore,
    Show,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Toggle {
    Enabled,
    Disabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct AnalysisOptions {
    pub whitespace: WhitespaceMode,
    pub semantic: Toggle,
    pub syntax: Toggle,
    pub inline_diff: InlineDiff,
}

impl AnalysisOptions {
    fn requests_nothing(self) -> bool {
        self.semantic == Toggle::Disabled
            && self.syntax == Toggle::Disabled
            && self.inline_diff == InlineDiff::Off
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AnalysisSnapshotKey {
    pub revision: RevisionKey,
    pub options: AnalysisOptions,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalysis {
    pub path: RelativePath,
    pub semantic: AnalysisFeature<SemanticResult>,
    pub syntax: AnalysisFeature<FilePresentation>,
    pub word_diff: AnalysisFeature<Vec<CharacterDiffRow>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "_tag")]
pub enum AnalysisFeature<T> {
    Disabled,
    Skipped { reason: String },
    Complete { value: T },
}

impl<T: Clone> AnalysisFeature<T> {
    fn from_lookup(toggle: Toggle, value: Option<&T>, skipped: &str) -> Self {
        match (toggle, value) {
            (Toggle::Disabled, _) => Self::Disabled,
            (Toggle::Enabled, Some(value)) => Self::Complete {
                value: value.clone(),
            },
            (Toggle::Enabled, None) => Self::Skipped {
                reason: skipped.to_owned(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSnapshot {
    pub files: Vec<FileAnalysis>,
    pub moves: Vec<MovedBlock>,
}

pub type AnalysisCache = SingleFlightCache<AnalysisSnapshotKey, AnalysisSnapshot>;

pub fn cache() -> AnalysisCache {
    SingleFlightCache::new(SNAPSHOT_CACHE_SIZE)
}

/// Results of the syntax forest, already restricted to what each option asks
/// for.
#[derive(Default)]
struct SyntaxResults {
    semantic: HashMap<RelativePath, SemanticResult>,
    presentations: HashMap<RelativePath, FilePresentation>,
    moves: Vec<MovedBlock>,
}

pub async fn build(
    local: &Local,
    github: &GitHub,
    revision: Arc<RevisionSnapshot>,
    options: AnalysisOptions,
) -> AppResult<AnalysisSnapshot> {
    let (syntax, words) = if options.requests_nothing() {
        (SyntaxResults::default(), HashMap::new())
    } else {
        let pairs = revision.file_pairs(local, github).await?;
        tokio::try_join!(
            syntax_analysis(local, github, &revision, options),
            word_analysis(pairs, options),
        )?
    };
    let inline_toggle = match options.inline_diff {
        InlineDiff::Off => Toggle::Disabled,
        InlineDiff::Token | InlineDiff::Character => Toggle::Enabled,
    };
    Ok(AnalysisSnapshot {
        files: revision
            .files
            .iter()
            .map(|file| {
                let lines = diff::patch_lines(&file.patch);
                let visible = syntax
                    .presentations
                    .get(&file.path)
                    .map(|presentation| presentation.restrict_to_lines(&lines.old, &lines.new));
                FileAnalysis {
                    semantic: AnalysisFeature::from_lookup(
                        options.semantic,
                        syntax.semantic.get(&file.path),
                        "This file has no analyzable textual hunk.",
                    ),
                    syntax: AnalysisFeature::from_lookup(
                        options.syntax,
                        visible.as_ref(),
                        "This file has no presentable textual hunk.",
                    ),
                    word_diff: AnalysisFeature::from_lookup(
                        inline_toggle,
                        words.get(&file.path),
                        "This file has no textual hunk to compare.",
                    ),
                    path: file.path.clone(),
                }
            })
            .collect(),
        moves: syntax.moves,
    })
}

async fn syntax_analysis(
    local: &Local,
    github: &GitHub,
    revision: &RevisionSnapshot,
    options: AnalysisOptions,
) -> AppResult<SyntaxResults> {
    if options.semantic == Toggle::Disabled && options.syntax == Toggle::Disabled {
        return Ok(SyntaxResults::default());
    }
    let prepared = revision.prepared(local, github).await?;
    tokio::task::spawn_blocking(move || match (options.semantic, options.syntax) {
        (Toggle::Enabled, syntax) => SyntaxResults {
            semantic: prepared.file_results().into_iter().collect(),
            presentations: presentations(&prepared, syntax),
            moves: prepared.moves(),
        },
        (Toggle::Disabled, syntax) => SyntaxResults {
            presentations: presentations(&prepared, syntax),
            ..SyntaxResults::default()
        },
    })
    .await
    .map_err(|error| AppError::internal(format!("Syntax analysis stopped: {error}")))
}

fn presentations(
    prepared: &crate::semantic::PreparedReview,
    syntax: Toggle,
) -> HashMap<RelativePath, FilePresentation> {
    match syntax {
        Toggle::Enabled => prepared.file_presentations().into_iter().collect(),
        Toggle::Disabled => HashMap::new(),
    }
}

async fn word_analysis(
    pairs: Arc<Vec<FilePair>>,
    options: AnalysisOptions,
) -> AppResult<HashMap<RelativePath, Vec<CharacterDiffRow>>> {
    let Some(granularity) = character_diff::Granularity::for_inline(options.inline_diff) else {
        return Ok(HashMap::new());
    };
    stream::iter(0..pairs.len())
        .map(|index| {
            let pairs = Arc::clone(&pairs);
            async move {
                let pair = &pairs[index];
                character_diff::analyze(
                    pair.path.as_str(),
                    &pair.old_text,
                    &pair.new_text,
                    options.whitespace,
                    granularity,
                )
                .await
                .map(|rows| (pair.path.clone(), rows))
            }
        })
        .buffered(FILE_ANALYSIS_CONCURRENCY)
        .try_collect()
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analysis_options_decode_as_closed_types() {
        assert_eq!(
            serde_json::from_str::<WhitespaceMode>(r#""ignore""#).unwrap(),
            WhitespaceMode::Ignore
        );
        assert!(serde_json::from_str::<WhitespaceMode>(r#""trim""#).is_err());
        assert_eq!(
            serde_json::from_str::<InlineDiff>(r#""token""#).unwrap(),
            InlineDiff::Token
        );
        assert!(serde_json::from_str::<InlineDiff>(r#""line""#).is_err());
        assert_eq!(
            serde_json::from_str::<Toggle>(r#""enabled""#).unwrap(),
            Toggle::Enabled
        );
        assert!(serde_json::from_str::<Toggle>("true").is_err());
    }
}
