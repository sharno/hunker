use std::{
    collections::{HashMap, VecDeque},
    future::Future,
    sync::Arc,
};

use futures::{StreamExt, stream};
use tokio::sync::{Mutex, OnceCell};

use crate::{
    diff,
    error::AppResult,
    github::{GitHub, GitHubTarget},
    local::Local,
    semantic::PreparedReview,
    types::{FileChange, FilePair, LocalGitRepository, Oid, RepositorySlug},
};

const REVISION_CACHE_SIZE: usize = 8;
const FILE_LOAD_CONCURRENCY: usize = 6;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RevisionKey {
    pub repository: RepositorySlug,
    pub base_oid: Oid,
    pub head_oid: Oid,
}

impl RevisionKey {
    pub fn new(repository: RepositorySlug, base_oid: Oid, head_oid: Oid) -> Self {
        Self {
            repository,
            base_oid,
            head_oid,
        }
    }
}

#[derive(Debug)]
enum RevisionSource {
    Local(LocalGitRepository),
    GitHub,
}

#[derive(Debug)]
pub struct RevisionSnapshot {
    pub key: RevisionKey,
    pub files: Arc<Vec<FileChange>>,
    target: GitHubTarget,
    source: RevisionSource,
    pairs: OnceCell<Arc<Vec<FilePair>>>,
    semantic: OnceCell<Arc<PreparedReview>>,
}

impl RevisionSnapshot {
    pub fn local_repository(&self) -> Option<&LocalGitRepository> {
        match &self.source {
            RevisionSource::Local(repository) => Some(repository),
            RevisionSource::GitHub => None,
        }
    }

    pub async fn file_pairs(
        &self,
        local: &Local,
        github: &GitHub,
    ) -> AppResult<Arc<Vec<FilePair>>> {
        let pairs = self
            .pairs
            .get_or_try_init(|| async {
                let analyzable = self
                    .files
                    .iter()
                    .filter(|file| file.patch.lines().any(|line| line.starts_with("@@")))
                    .cloned()
                    .collect::<Vec<_>>();
                let pairs = match &self.source {
                    RevisionSource::Local(repository) => {
                        local
                            .load_file_pairs_at(
                                repository,
                                self.key.base_oid.as_str(),
                                self.key.head_oid.as_str(),
                                &analyzable,
                            )
                            .await?
                    }
                    RevisionSource::GitHub => {
                        load_github_pairs(
                            github,
                            &self.target,
                            self.key.base_oid.as_str(),
                            self.key.head_oid.as_str(),
                            &analyzable,
                        )
                        .await?
                    }
                };
                AppResult::Ok(Arc::new(pairs))
            })
            .await?;
        Ok(Arc::clone(pairs))
    }

    pub async fn semantic_forest(
        &self,
        pairs: Arc<Vec<FilePair>>,
    ) -> AppResult<Arc<PreparedReview>> {
        let prepared = self
            .semantic
            .get_or_try_init(|| async move {
                tokio::task::spawn_blocking(move || Arc::new(PreparedReview::new(&pairs)))
                    .await
                    .map_err(|error| {
                        crate::error::AppError::internal(format!(
                            "Syntax tree preparation stopped: {error}"
                        ))
                    })
            })
            .await?;
        Ok(Arc::clone(prepared))
    }
}

type RevisionCell = Arc<OnceCell<Arc<RevisionSnapshot>>>;

#[derive(Default)]
struct CacheState {
    entries: HashMap<RevisionKey, RevisionCell>,
    insertion_order: VecDeque<RevisionKey>,
}

#[derive(Clone, Default)]
pub struct RevisionCache {
    state: Arc<Mutex<CacheState>>,
}

impl RevisionCache {
    pub async fn get_or_build<F, Fut>(
        &self,
        key: RevisionKey,
        build: F,
    ) -> AppResult<Arc<RevisionSnapshot>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = AppResult<RevisionSnapshot>>,
    {
        let cell = self.cell(key).await;
        let snapshot = cell
            .get_or_try_init(|| async { build().await.map(Arc::new) })
            .await?;
        Ok(Arc::clone(snapshot))
    }

    async fn cell(&self, key: RevisionKey) -> RevisionCell {
        let mut state = self.state.lock().await;
        if let Some(cell) = state.entries.get(&key) {
            return Arc::clone(cell);
        }
        let cell = Arc::new(OnceCell::new());
        state.entries.insert(key.clone(), Arc::clone(&cell));
        state.insertion_order.push_back(key.clone());
        while state.entries.len() > REVISION_CACHE_SIZE {
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

pub async fn load(
    local: &Local,
    github: &GitHub,
    target: GitHubTarget,
    key: RevisionKey,
) -> AppResult<RevisionSnapshot> {
    let local_diff = local
        .load_diff(&target, key.base_oid.as_str(), key.head_oid.as_str())
        .await?;
    let (diff_text, source) = match local_diff {
        Some((repository, text)) => (text, RevisionSource::Local(repository)),
        None => (
            github
                .revision_diff(&target, key.base_oid.as_str(), key.head_oid.as_str())
                .await?,
            RevisionSource::GitHub,
        ),
    };
    Ok(RevisionSnapshot {
        key,
        files: Arc::new(diff::parse_git_diff(&diff_text)),
        target,
        source,
        pairs: OnceCell::new(),
        semantic: OnceCell::new(),
    })
}

async fn load_github_pairs(
    github: &GitHub,
    target: &GitHubTarget,
    base_oid: &str,
    head_oid: &str,
    files: &[FileChange],
) -> AppResult<Vec<FilePair>> {
    stream::iter(files.iter().cloned())
        .map(|file| async move {
            github
                .file_pair(
                    target,
                    base_oid,
                    head_oid,
                    &file.path,
                    file.previous_path.as_deref().unwrap_or(""),
                    file.status,
                )
                .await
        })
        .buffered(FILE_LOAD_CONCURRENCY)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .collect()
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::types::FileStatus;

    fn key() -> RevisionKey {
        RevisionKey::new(
            RepositorySlug {
                owner: "acme".to_owned(),
                name: "demo".to_owned(),
            },
            Oid::parse("1".repeat(40)).unwrap(),
            Oid::parse("2".repeat(40)).unwrap(),
        )
    }

    fn snapshot(key: RevisionKey) -> RevisionSnapshot {
        RevisionSnapshot {
            key,
            files: Arc::new(Vec::new()),
            target: GitHubTarget::Commit {
                owner: "acme".to_owned(),
                repo: "demo".to_owned(),
                sha: "2".repeat(40),
            },
            source: RevisionSource::GitHub,
            pairs: OnceCell::new(),
            semantic: OnceCell::new(),
        }
    }

    #[tokio::test]
    async fn concurrent_callers_share_one_revision_snapshot() {
        let cache = RevisionCache::default();
        let key = key();
        let builds = Arc::new(AtomicUsize::new(0));
        let first_builds = Arc::clone(&builds);
        let first_key = key.clone();
        let first = cache.get_or_build(key.clone(), || async move {
            first_builds.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            Ok(snapshot(first_key))
        });
        let second_builds = Arc::clone(&builds);
        let second_key = key.clone();
        let second = cache.get_or_build(key, || async move {
            second_builds.fetch_add(1, Ordering::SeqCst);
            Ok(snapshot(second_key))
        });
        let (first, second) = tokio::join!(first, second);
        assert!(Arc::ptr_eq(&first.unwrap(), &second.unwrap()));
        assert_eq!(builds.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn one_prepared_ast_forest_serves_every_analysis_option() {
        let revision = snapshot(key());
        let pairs = Arc::new(vec![FilePair {
            path: "src/example.rs".to_owned(),
            previous_path: None,
            status: FileStatus::Modified,
            old_text: "fn before() {}".to_owned(),
            new_text: "fn after() {}".to_owned(),
        }]);
        let first = revision.semantic_forest(Arc::clone(&pairs)).await.unwrap();
        let second = revision.semantic_forest(pairs).await.unwrap();
        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(first.file_results().len(), 1);
    }
}
