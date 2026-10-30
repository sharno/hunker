use std::{collections::HashSet, sync::Arc};

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
    types::{FileChange, FilePair, Oid, PairRead, RelativePath, RepositorySlug},
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

/// Where a revision's objects can be read. Only the objects are immutable;
/// whether a local clone has them can change at any time, so this is resolved
/// per request and never cached.
#[derive(Clone, Copy)]
pub struct Backing<'a> {
    pub local: &'a Local,
    pub github: &'a GitHub,
    pub pull: Option<PullNumber>,
}

/// The text file pairs of a revision, and the changed files that are not text.
#[derive(Debug, Default)]
pub struct FilePairs {
    pub text: Vec<FilePair>,
    pub not_text: HashSet<RelativePath>,
}

impl FromIterator<PairRead> for FilePairs {
    fn from_iter<I: IntoIterator<Item = PairRead>>(reads: I) -> Self {
        reads.into_iter().fold(Self::default(), |mut pairs, read| {
            match read {
                PairRead::Text(pair) => pairs.text.push(pair),
                PairRead::NotText(path) => {
                    pairs.not_text.insert(path);
                }
            }
            pairs
        })
    }
}

/// The immutable material of one review revision. File pairs and the parsed
/// syntax forest load lazily, once, and are shared by every analysis option.
#[derive(Debug)]
pub struct RevisionSnapshot {
    pub key: RevisionKey,
    pub files: Arc<Vec<FileChange>>,
    pairs: OnceCell<Arc<FilePairs>>,
    prepared: OnceCell<Arc<PreparedReview>>,
}

impl RevisionSnapshot {
    pub async fn file_pairs(&self, backing: Backing<'_>) -> AppResult<Arc<FilePairs>> {
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
                let local = backing
                    .local
                    .materialize(repository, base_oid, head_oid, backing.pull)
                    .await?;
                let reads = match local {
                    Some(found) => {
                        backing
                            .local
                            .load_file_pairs_at(&found, base_oid, head_oid, &analyzable)
                            .await?
                    }
                    None => {
                        stream::iter(analyzable)
                            .map(|file| async move {
                                backing
                                    .github
                                    .file_pair(repository, base_oid, head_oid, &file)
                                    .await
                            })
                            .buffered(FILE_LOAD_CONCURRENCY)
                            .try_collect::<Vec<_>>()
                            .await?
                    }
                };
                AppResult::Ok(Arc::new(reads.into_iter().collect()))
            })
            .await?;
        Ok(Arc::clone(pairs))
    }

    pub async fn prepared(&self, backing: Backing<'_>) -> AppResult<Arc<PreparedReview>> {
        let prepared = self
            .prepared
            .get_or_try_init(|| async {
                let pairs = self.file_pairs(backing).await?;
                tokio::task::spawn_blocking(move || Arc::new(PreparedReview::new(&pairs.text)))
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
pub async fn load(backing: Backing<'_>, key: RevisionKey) -> AppResult<RevisionSnapshot> {
    let local_diff = backing
        .local
        .load_diff(&key.repository, &key.base_oid, &key.head_oid, backing.pull)
        .await?;
    let diff_text = match local_diff {
        Some(text) => text,
        None => {
            backing
                .github
                .revision_diff(&key.repository, &key.base_oid, &key.head_oid)
                .await?
        }
    };
    Ok(RevisionSnapshot {
        files: Arc::new(diff::parse_git_diff(&diff_text)?),
        key,
        pairs: OnceCell::new(),
        prepared: OnceCell::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Contents, FileStatus};

    #[test]
    fn keeps_files_that_are_not_text_out_of_the_text_pairs() {
        let change = |path: &str| FileChange {
            path: RelativePath::parse(path).unwrap(),
            status: FileStatus::Modified,
            additions: 1,
            deletions: 1,
            patch: "@@ -1 +1 @@\n-a\n+b".to_owned(),
        };
        let pairs = [
            PairRead::new(
                &change("src/a.rs"),
                Contents::Text("a".to_owned()),
                Contents::Text("b".to_owned()),
            ),
            PairRead::new(&change("logo.png"), Contents::NotText, Contents::NotText),
        ]
        .into_iter()
        .collect::<FilePairs>();
        assert_eq!(
            pairs
                .text
                .iter()
                .map(|pair| pair.path.as_str())
                .collect::<Vec<_>>(),
            vec!["src/a.rs"]
        );
        assert!(
            pairs
                .not_text
                .contains(&RelativePath::parse("logo.png").unwrap())
        );
    }
}
