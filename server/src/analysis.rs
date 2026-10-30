use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use futures::{StreamExt, TryStreamExt, stream};
use serde::{Deserialize, Serialize};

use crate::{
    cache::SingleFlightCache,
    character_diff::{self, CharacterDiffRow},
    diff,
    error::{AppError, AppResult},
    revision::{Backing, FilePairs, RevisionKey, RevisionSnapshot},
    semantic::{MovedBlock, SemanticResult},
    source_presentation::FilePresentation,
    types::RelativePath,
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

/// Whether a changed file's two sides could be read as text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Readability {
    Text,
    NotText,
}

impl<T: Clone> AnalysisFeature<T> {
    fn from_lookup(
        toggle: Toggle,
        readability: Readability,
        value: Option<&T>,
        skipped: &str,
    ) -> Self {
        match (toggle, readability, value) {
            (Toggle::Disabled, _, _) => Self::Disabled,
            (Toggle::Enabled, Readability::NotText, _) => Self::Skipped {
                reason: "This file is not UTF-8 text.".to_owned(),
            },
            (Toggle::Enabled, Readability::Text, Some(value)) => Self::Complete {
                value: value.clone(),
            },
            (Toggle::Enabled, Readability::Text, None) => Self::Skipped {
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
    backing: Backing<'_>,
    revision: Arc<RevisionSnapshot>,
    options: AnalysisOptions,
) -> AppResult<AnalysisSnapshot> {
    let (syntax, words, not_text) = if options.requests_nothing() {
        (SyntaxResults::default(), HashMap::new(), HashSet::new())
    } else {
        let pairs = revision.file_pairs(backing).await?;
        let (syntax, words) = tokio::try_join!(
            syntax_analysis(backing, &revision, options),
            word_analysis(Arc::clone(&pairs), options),
        )?;
        (syntax, words, pairs.not_text.clone())
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
                let readability = if not_text.contains(&file.path) {
                    Readability::NotText
                } else {
                    Readability::Text
                };
                let visible = syntax
                    .presentations
                    .get(&file.path)
                    .map(|presentation| presentation.restrict_to_lines(&lines.old, &lines.new));
                FileAnalysis {
                    semantic: AnalysisFeature::from_lookup(
                        options.semantic,
                        readability,
                        syntax.semantic.get(&file.path),
                        "This file has no analyzable textual hunk.",
                    ),
                    syntax: AnalysisFeature::from_lookup(
                        options.syntax,
                        readability,
                        visible.as_ref(),
                        "This file has no presentable textual hunk.",
                    ),
                    word_diff: AnalysisFeature::from_lookup(
                        inline_toggle,
                        readability,
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
    backing: Backing<'_>,
    revision: &RevisionSnapshot,
    options: AnalysisOptions,
) -> AppResult<SyntaxResults> {
    if options.semantic == Toggle::Disabled && options.syntax == Toggle::Disabled {
        return Ok(SyntaxResults::default());
    }
    let prepared = revision.prepared(backing).await?;
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
    pairs: Arc<FilePairs>,
    options: AnalysisOptions,
) -> AppResult<HashMap<RelativePath, Vec<CharacterDiffRow>>> {
    let Some(granularity) = character_diff::Granularity::for_inline(options.inline_diff) else {
        return Ok(HashMap::new());
    };
    stream::iter(0..pairs.text.len())
        .map(|index| {
            let pairs = Arc::clone(&pairs);
            async move {
                let pair = &pairs.text[index];
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

    #[test]
    fn skips_every_enabled_feature_of_a_file_that_is_not_text() {
        let skipped = AnalysisFeature::<usize>::from_lookup(
            Toggle::Enabled,
            Readability::NotText,
            Some(&1),
            "unused",
        );
        assert!(matches!(
            skipped,
            AnalysisFeature::Skipped { reason } if reason == "This file is not UTF-8 text."
        ));
        assert!(matches!(
            AnalysisFeature::<usize>::from_lookup(
                Toggle::Disabled,
                Readability::NotText,
                None,
                "unused"
            ),
            AnalysisFeature::Disabled
        ));
    }
}
