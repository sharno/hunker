use std::{
    collections::{HashMap, VecDeque},
    future::Future,
    sync::Arc,
};

use futures::{StreamExt, stream};
use serde::Serialize;
use tokio::sync::{Mutex, OnceCell};

use crate::{
    character_diff::{self, CharacterDiffResult, DiffMode},
    diff,
    error::{AppError, AppResult},
    github::{GitHub, GitHubTarget},
    local::Local,
    semantic::{self, MovedBlock, SemanticResult},
    types::{FilePair, RepositoryId},
};

const SNAPSHOT_CACHE_SIZE: usize = 16;
const FILE_ANALYSIS_CONCURRENCY: usize = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InlineDiff {
    Off,
    Token,
    Character,
}

impl InlineDiff {
    pub fn from_query(value: &str) -> AppResult<Self> {
        match value {
            "off" => Ok(Self::Off),
            "token" => Ok(Self::Token),
            "character" => Ok(Self::Character),
            _ => Err(AppError::bad_request(
                "Inline diff mode must be off, token, or character.",
            )),
        }
    }

    fn mode(self) -> Option<DiffMode> {
        match self {
            Self::Off => None,
            Self::Token => Some(DiffMode::Token),
            Self::Character => Some(DiffMode::Character),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisOptions {
    pub ignore_whitespace: bool,
    pub semantic: bool,
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
        repository: &RepositoryId,
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
    pub semantic: Option<SemanticResult>,
    pub word_diff: Option<CharacterDiffResult>,
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
    target: &GitHubTarget,
    key: AnalysisSnapshotKey,
) -> AppResult<AnalysisSnapshot> {
    let local_diff = local
        .load_diff(target, &key.base_oid, &key.head_oid)
        .await?;
    let (diff_text, local_repository) = match local_diff {
        Some((repository, text)) => (text, Some(repository)),
        None => (
            github
                .revision_diff(target, &key.base_oid, &key.head_oid)
                .await?,
            None,
        ),
    };
    let files = diff::parse_git_diff(&diff_text);
    if !key.options.semantic && key.options.inline_diff == InlineDiff::Off {
        return Ok(AnalysisSnapshot {
            key,
            files: files
                .into_iter()
                .map(|file| FileAnalysis {
                    path: file.path,
                    semantic: None,
                    word_diff: None,
                })
                .collect(),
            moves: Vec::new(),
        });
    }
    let analyzable_files = files
        .iter()
        .filter(|file| file.patch.lines().any(|line| line.starts_with("@@")))
        .cloned()
        .collect::<Vec<_>>();
    let pairs = if let Some(repository) = local_repository {
        local
            .load_file_pairs_at(&repository, &key.base_oid, &key.head_oid, &analyzable_files)
            .await?
    } else {
        load_github_pairs(github, target, &key, &analyzable_files).await?
    };
    let pairs = Arc::new(pairs);
    let semantic = semantic_analysis(Arc::clone(&pairs), key.options.semantic);
    let word_diffs = word_analysis(
        Arc::clone(&pairs),
        key.options.ignore_whitespace,
        key.options.inline_diff,
    );
    let ((semantic_results, moves), word_results) = tokio::try_join!(semantic, word_diffs)?;
    let semantic_by_path = semantic_results
        .into_iter()
        .map(|result| (semantic_path(&result).to_owned(), result))
        .collect::<HashMap<_, _>>();
    let word_by_path = word_results
        .into_iter()
        .map(|result| (result.path.clone(), result))
        .collect::<HashMap<_, _>>();
    Ok(AnalysisSnapshot {
        key,
        files: files
            .into_iter()
            .map(|file| FileAnalysis {
                semantic: semantic_by_path.get(&file.path).cloned(),
                word_diff: word_by_path.get(&file.path).cloned(),
                path: file.path,
            })
            .collect(),
        moves,
    })
}

async fn load_github_pairs(
    github: &GitHub,
    target: &GitHubTarget,
    key: &AnalysisSnapshotKey,
    files: &[crate::types::FileChange],
) -> AppResult<Vec<FilePair>> {
    stream::iter(files.iter().cloned())
        .map(|file| async move {
            github
                .file_pair(
                    target,
                    &key.base_oid,
                    &key.head_oid,
                    &file.path,
                    file.previous_path.as_deref().unwrap_or(""),
                    file.status,
                )
                .await
        })
        .buffered(FILE_ANALYSIS_CONCURRENCY)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .collect()
}

async fn semantic_analysis(
    pairs: Arc<Vec<FilePair>>,
    enabled: bool,
) -> AppResult<(Vec<SemanticResult>, Vec<MovedBlock>)> {
    if !enabled {
        return Ok((Vec::new(), Vec::new()));
    }
    tokio::task::spawn_blocking(move || {
        let results = pairs.iter().map(semantic::analyze_file).collect();
        let moves = semantic::analyze_review(&pairs);
        (results, moves)
    })
    .await
    .map_err(|error| AppError::internal(format!("Semantic analysis stopped: {error}")))
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

    #[tokio::test]
    async fn concurrent_callers_share_one_immutable_snapshot() {
        let cache = AnalysisCache::default();
        let key = AnalysisSnapshotKey::new(
            &RepositoryId {
                owner: "acme".to_owned(),
                name: "demo".to_owned(),
            },
            "1".repeat(40),
            "2".repeat(40),
            AnalysisOptions {
                ignore_whitespace: true,
                semantic: true,
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
