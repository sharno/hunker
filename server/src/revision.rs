use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};
use serde::Serialize;
use tokio::sync::OnceCell;

use crate::{
    cache::SingleFlightCache,
    diff,
    error::{AppError, AppResult},
    github::{GitHub, PullNumber},
    local::Local,
    semantic::PreparedReview,
    types::{FileChange, FilePair, LocalGitRepository, Oid, RepositorySlug},
};

const REVISION_CACHE_SIZE: usize = 8;
const FILE_LOAD_CONCURRENCY: usize = 6;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionKey {
    pub repository: RepositorySlug,
    pub base_oid: Oid,
    pub head_oid: Oid,
}

#[derive(Debug)]
enum RevisionSource {
    Local(LocalGitRepository),
    GitHub,
}

/// The immutable material of one review revision. File pairs and the parsed
/// syntax forest load lazily, once, and are shared by every analysis option.
#[derive(Debug)]
pub struct RevisionSnapshot {
    pub key: RevisionKey,
    pub files: Arc<Vec<FileChange>>,
    source: RevisionSource,
    pairs: OnceCell<Arc<Vec<FilePair>>>,
    prepared: OnceCell<Arc<PreparedReview>>,
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
                    .filter(|file| !file.patch.is_empty())
                    .cloned()
                    .collect::<Vec<_>>();
                let RevisionKey {
                    repository,
                    base_oid,
                    head_oid,
                } = &self.key;
                let pairs = match &self.source {
                    RevisionSource::Local(found) => {
                        local
                            .load_file_pairs_at(found, base_oid, head_oid, &analyzable)
                            .await?
                    }
                    RevisionSource::GitHub => {
                        stream::iter(analyzable)
                            .map(|file| async move {
                                github
                                    .file_pair(repository, base_oid, head_oid, &file)
                                    .await
                            })
                            .buffered(FILE_LOAD_CONCURRENCY)
                            .try_collect()
                            .await?
                    }
                };
                AppResult::Ok(Arc::new(pairs))
            })
            .await?;
        Ok(Arc::clone(pairs))
    }

    pub async fn prepared(&self, local: &Local, github: &GitHub) -> AppResult<Arc<PreparedReview>> {
        let prepared = self
            .prepared
            .get_or_try_init(|| async {
                let pairs = self.file_pairs(local, github).await?;
                tokio::task::spawn_blocking(move || Arc::new(PreparedReview::new(&pairs)))
                    .await
                    .map_err(|error| {
                        AppError::internal(format!("Syntax tree preparation stopped: {error}"))
                    })
            })
            .await?;
        Ok(Arc::clone(prepared))
    }
}

pub type RevisionCache = SingleFlightCache<RevisionKey, RevisionSnapshot>;

pub fn cache() -> RevisionCache {
    SingleFlightCache::new(REVISION_CACHE_SIZE)
}

/// Loads a revision's diff from the local clone when one exists, and from
/// GitHub only when there is none.
pub async fn load(
    local: &Local,
    github: &GitHub,
    key: RevisionKey,
    pull: Option<PullNumber>,
) -> AppResult<RevisionSnapshot> {
    let local_diff = local
        .load_diff(&key.repository, &key.base_oid, &key.head_oid, pull)
        .await?;
    let (diff_text, source) = match local_diff {
        Some((repository, text)) => (text, RevisionSource::Local(repository)),
        None => (
            github
                .revision_diff(&key.repository, &key.base_oid, &key.head_oid)
                .await?,
            RevisionSource::GitHub,
        ),
    };
    Ok(RevisionSnapshot {
        files: Arc::new(diff::parse_git_diff(&diff_text)?),
        key,
        source,
        pairs: OnceCell::new(),
        prepared: OnceCell::new(),
    })
}
