use std::{
    collections::{HashMap, VecDeque},
    future::Future,
    sync::Arc,
};

use futures::{StreamExt, stream};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, OnceCell};

use crate::{
    character_diff::{self, CharacterDiffResult, DiffMode},
    diff,
    error::{AppError, AppResult},
    github::GitHub,
    local::Local,
    revision::RevisionSnapshot,
    semantic::{MovedBlock, SemanticResult},
    source_presentation::FilePresentation,
    types::{FilePair, RepositorySlug},
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

impl InlineDiff {
    fn mode(self) -> Option<DiffMode> {
        match self {
            Self::Off => None,
            Self::Token => Some(DiffMode::Token),
            Self::Character => Some(DiffMode::Character),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WhitespaceMode {
    Ignore,
    Show,
}

impl WhitespaceMode {
    pub fn ignore(self) -> bool {
        matches!(self, Self::Ignore)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisOptions {
    pub ignore_whitespace: bool,
    pub semantic: bool,
    pub syntax: bool,
    pub inline_diff: InlineDiff,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSnapshotKey {
    pub repository: String,
    pub base_oid: String,
    pub head_oid: String,
    pub options: AnalysisOptions,
}

impl AnalysisSnapshotKey {
    pub fn new(
        repository: &RepositorySlug,
        base_oid: String,
        head_oid: String,
        options: AnalysisOptions,
    ) -> Self {
        Self {
            repository: format!("{}/{}", repository.owner, repository.name),
            base_oid,
            head_oid,
            options,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileAnalysis {
    pub path: String,
    pub semantic: AnalysisFeature<SemanticResult>,
    pub syntax: AnalysisFeature<FilePresentation>,
    pub word_diff: Option<CharacterDiffResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "_tag")]
pub enum AnalysisFeature<T> {
    Disabled,
    Skipped { reason: String },
    Complete { value: T },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSnapshot {
    pub key: AnalysisSnapshotKey,
    pub files: Vec<FileAnalysis>,
    pub moves: Vec<MovedBlock>,
}

type SnapshotCell = Arc<OnceCell<Arc<AnalysisSnapshot>>>;

#[derive(Default)]
struct CacheState {
    entries: HashMap<AnalysisSnapshotKey, SnapshotCell>,
    insertion_order: VecDeque<AnalysisSnapshotKey>,
}

#[derive(Clone, Default)]
pub struct AnalysisCache {
    state: Arc<Mutex<CacheState>>,
}

impl AnalysisCache {
    pub async fn get_or_build<F, Fut>(
        &self,
        key: AnalysisSnapshotKey,
        build: F,
    ) -> AppResult<Arc<AnalysisSnapshot>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = AppResult<AnalysisSnapshot>>,
    {
        let cell = self.cell(key).await;
        let snapshot = cell
            .get_or_try_init(|| async { build().await.map(Arc::new) })
            .await?;
        Ok(Arc::clone(snapshot))
    }

    async fn cell(&self, key: AnalysisSnapshotKey) -> SnapshotCell {
        let mut state = self.state.lock().await;
        if let Some(cell) = state.entries.get(&key) {
            return Arc::clone(cell);
        }
        let cell = Arc::new(OnceCell::new());
        state.entries.insert(key.clone(), Arc::clone(&cell));
        state.insertion_order.push_back(key.clone());
        while state.entries.len() > SNAPSHOT_CACHE_SIZE {
            let Some(oldest) = state.insertion_order.pop_front() else {
                break;
            };
            if oldest != key {
                state.entries.remove(&oldest);
            }
        }
        cell
    }
}

pub async fn build(
    local: &Local,
    github: &GitHub,
    revision: Arc<RevisionSnapshot>,
    key: AnalysisSnapshotKey,
) -> AppResult<AnalysisSnapshot> {
    let files = Arc::clone(&revision.files);
    if !key.options.semantic && !key.options.syntax && key.options.inline_diff == InlineDiff::Off {
        return Ok(AnalysisSnapshot {
            key,
            files: files
                .iter()
                .map(|file| FileAnalysis {
                    path: file.path.clone(),
                    semantic: AnalysisFeature::Disabled,
                    syntax: AnalysisFeature::Disabled,
                    word_diff: None,
                })
                .collect(),
            moves: Vec::new(),
        });
    }
    let pairs = revision.file_pairs(local, github).await?;
    let syntax = syntax_analysis(
        Arc::clone(&revision),
        Arc::clone(&pairs),
        key.options.semantic,
        key.options.syntax,
    );
    let word_diffs = word_analysis(
        Arc::clone(&pairs),
        key.options.ignore_whitespace,
        key.options.inline_diff,
    );
    let ((semantic_results, presentation_results, moves), word_results) =
        tokio::try_join!(syntax, word_diffs)?;
    let semantic_by_path = semantic_results
        .into_iter()
        .map(|result| (semantic_path(&result).to_owned(), result))
        .collect::<HashMap<_, _>>();
    let word_by_path = word_results
        .into_iter()
        .map(|result| (result.path.clone(), result))
        .collect::<HashMap<_, _>>();
    let raw_presentations = presentation_results.into_iter().collect::<HashMap<_, _>>();
    let presentation_by_path = files
        .iter()
        .filter_map(|file| {
            let presentation = raw_presentations.get(&file.path)?;
            let lines = diff::patch_lines(&file.patch);
            Some((
                file.path.clone(),
                presentation.restrict_to_lines(&lines.old, &lines.new),
            ))
        })
        .collect::<HashMap<_, _>>();
    let semantic_enabled = key.options.semantic;
    let syntax_enabled = key.options.syntax;
    Ok(AnalysisSnapshot {
        key,
        files: files
            .iter()
            .map(|file| FileAnalysis {
                semantic: if semantic_enabled {
                    semantic_by_path.get(&file.path).cloned().map_or_else(
                        || AnalysisFeature::Skipped {
                            reason: "This file has no analyzable textual hunk.".to_owned(),
                        },
                        |value| AnalysisFeature::Complete { value },
                    )
                } else {
                    AnalysisFeature::Disabled
                },
                syntax: if syntax_enabled {
                    presentation_by_path.get(&file.path).cloned().map_or_else(
                        || AnalysisFeature::Skipped {
                            reason: "This file has no presentable textual hunk.".to_owned(),
                        },
                        |value| AnalysisFeature::Complete { value },
                    )
                } else {
                    AnalysisFeature::Disabled
                },
                word_diff: word_by_path.get(&file.path).cloned(),
                path: file.path.clone(),
            })
            .collect(),
        moves,
    })
}

async fn syntax_analysis(
    revision: Arc<RevisionSnapshot>,
    pairs: Arc<Vec<FilePair>>,
    semantic_enabled: bool,
    syntax_enabled: bool,
) -> AppResult<(
    Vec<SemanticResult>,
    Vec<(String, FilePresentation)>,
    Vec<MovedBlock>,
)> {
    if !semantic_enabled && !syntax_enabled {
        return Ok((Vec::new(), Vec::new(), Vec::new()));
    }
    let prepared = revision.parsed_forest(pairs).await?;
    tokio::task::spawn_blocking(move || {
        (
            if semantic_enabled {
                prepared.file_results()
            } else {
                Vec::new()
            },
            if syntax_enabled {
                prepared.file_presentations()
            } else {
                Vec::new()
            },
            if semantic_enabled {
                prepared.moves()
            } else {
                Vec::new()
            },
        )
    })
    .await
    .map_err(|error| AppError::internal(format!("Syntax analysis stopped: {error}")))
}

async fn word_analysis(
    pairs: Arc<Vec<FilePair>>,
    ignore_whitespace: bool,
    inline_diff: InlineDiff,
) -> AppResult<Vec<CharacterDiffResult>> {
    let Some(mode) = inline_diff.mode() else {
        return Ok(Vec::new());
    };
    stream::iter(0..pairs.len())
        .map(|index| {
            let pairs = Arc::clone(&pairs);
            async move {
                let pair = &pairs[index];
                character_diff::analyze(
                    &pair.path,
                    &pair.old_text,
                    &pair.new_text,
                    ignore_whitespace,
                    mode,
                )
                .await
            }
        })
        .buffered(FILE_ANALYSIS_CONCURRENCY)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .collect()
}

fn semantic_path(result: &SemanticResult) -> &str {
    match result {
        SemanticResult::Parsed { path, .. }
        | SemanticResult::Unsupported { path, .. }
        | SemanticResult::ParseFailed { path, .. } => path,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

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
    }

    #[tokio::test]
    async fn concurrent_callers_share_one_immutable_snapshot() {
        let cache = AnalysisCache::default();
        let key = AnalysisSnapshotKey::new(
            &RepositorySlug {
                owner: "acme".to_owned(),
                name: "demo".to_owned(),
            },
            "1".repeat(40),
            "2".repeat(40),
            AnalysisOptions {
                ignore_whitespace: true,
                semantic: true,
                syntax: true,
                inline_diff: InlineDiff::Token,
            },
        );
        let builds = Arc::new(AtomicUsize::new(0));
        let first_builds = Arc::clone(&builds);
        let first_key = key.clone();
        let first = cache.get_or_build(key.clone(), || async move {
            first_builds.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            Ok(AnalysisSnapshot {
                key: first_key,
                files: Vec::new(),
                moves: Vec::new(),
            })
        });
        let second_builds = Arc::clone(&builds);
        let second_key = key.clone();
        let second = cache.get_or_build(key.clone(), || async move {
            second_builds.fetch_add(1, Ordering::SeqCst);
            Ok(AnalysisSnapshot {
                key: second_key,
                files: Vec::new(),
                moves: Vec::new(),
            })
        });
        let (first, second) = tokio::join!(first, second);
        assert!(Arc::ptr_eq(&first.unwrap(), &second.unwrap()));
        assert_eq!(builds.load(Ordering::SeqCst), 1);
    }
}
