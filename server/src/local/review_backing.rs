use futures::{StreamExt, stream};

use crate::{
    command::Git,
    error::{AppError, AppResult},
    github::{PullNumber, PullTarget},
    types::{
        FileChange, FilePair, LocalGitRepository, Oid, PullCommit, RepositorySlug, ReviewRevision,
        Side,
    },
};

use super::{DEEPEN_STEPS, FETCH_INTERVAL_MS, Local, PullRevision, now_ms, objects};

/// Whether a pull-request ref fetch may reuse a recent fetch.
#[derive(Clone, Copy)]
enum FetchPolicy {
    Force,
    Throttled,
}

/// One side of a file pair before the batched object read.
enum Blob {
    Absent,
    Inline(String),
    Object(String),
}

impl Blob {
    fn select(file: &FileChange, side: Side, revision: &Oid) -> Self {
        match file.path_on(side) {
            None => Self::Absent,
            Some(path) => objects::gitlink_text(&file.patch, side)
                .map_or_else(|| Self::Object(format!("{revision}:{path}")), Self::Inline),
        }
    }

    fn object(&self) -> Option<&str> {
        match self {
            Self::Object(spec) => Some(spec),
            Self::Absent | Self::Inline(_) => None,
        }
    }
}

impl Local {
    async fn fetch_pull(
        &self,
        repository: &LocalGitRepository,
        number: PullNumber,
        policy: FetchPolicy,
    ) -> AppResult<u64> {
        let key = (repository.path.clone(), number);
        let last = self.fetches.lock().await.get(&key).copied();
        let now = now_ms();
        if let (FetchPolicy::Throttled, Some(fetched_at)) = (policy, last)
            && now.saturating_sub(fetched_at) < FETCH_INTERVAL_MS
        {
            return Ok(fetched_at);
        }
        // Serialize with checkout mutations instead of holding the global
        // fetch table across a network call.
        let lock = self.repository_lock(&repository.path).await;
        let _guard = lock.lock().await;
        let git = Git::at(&repository.path);
        let refspec = pull_refspec(number);
        let depth = if git.is_shallow().await? {
            Some("--depth=1")
        } else {
            None
        };
        let args = ["fetch", "--no-tags"]
            .into_iter()
            .chain(depth)
            .chain(["origin", refspec.as_str()])
            .collect::<Vec<_>>();
        git.ok(&args).await?;
        self.fetches.lock().await.insert(key, now);
        Ok(now)
    }

    /// Makes `revision` readable from the local clone, fetching missing
    /// commits. `None` means there is no local clone; every other failure is
    /// returned so it is not hidden behind a GitHub fallback.
    async fn prepare(
        &self,
        repository: &RepositorySlug,
        base: &Oid,
        head: &Oid,
        pull: Option<PullNumber>,
    ) -> AppResult<Option<LocalGitRepository>> {
        let Some(found) = self.find(repository).await? else {
            return Ok(None);
        };
        let git = Git::at(&found.path);
        let missing = missing_commits(git, [base, head]).await?;
        let missing = match pull {
            Some(number) if !missing.is_empty() => {
                self.fetch_pull(&found, number, FetchPolicy::Force).await?;
                missing_commits(git, missing).await?
            }
            Some(_) | None => missing,
        };
        let shallow = git.is_shallow().await?;
        for oid in &missing {
            let depth = shallow.then_some("--depth=1");
            let args = ["fetch", "--no-tags"]
                .into_iter()
                .chain(depth)
                .chain(["origin", oid.as_str()])
                .collect::<Vec<_>>();
            git.ok(&args).await?;
        }
        if missing_commits(git, missing).await?.is_empty() {
            Ok(Some(found))
        } else {
            Err(AppError::upstream(
                "Local Git could not materialize the requested immutable revision.",
            ))
        }
    }

    pub async fn load_diff(
        &self,
        repository: &RepositorySlug,
        base: &Oid,
        head: &Oid,
        pull: Option<PullNumber>,
    ) -> AppResult<Option<(LocalGitRepository, String)>> {
        let Some(found) = self.prepare(repository, base, head, pull).await? else {
            return Ok(None);
        };
        let diff = Git::at(&found.path)
            .ok(&[
                "-c",
                "core.quotePath=false",
                "diff",
                "--find-renames",
                "--no-ext-diff",
                "--no-color",
                "--full-index",
                base.as_str(),
                head.as_str(),
                "--",
            ])
            .await?;
        Ok(Some((found, diff)))
    }

    pub async fn load_file_pairs_at(
        &self,
        repository: &LocalGitRepository,
        base: &Oid,
        head: &Oid,
        files: &[FileChange],
    ) -> AppResult<Vec<FilePair>> {
        let blobs = files
            .iter()
            .map(|file| {
                (
                    Blob::select(file, Side::Old, base),
                    Blob::select(file, Side::New, head),
                )
            })
            .collect::<Vec<_>>();
        let requests = blobs
            .iter()
            .flat_map(|(old, new)| [old.object(), new.object()])
            .flatten()
            .map(str::to_owned)
            .collect();
        let mut contents = objects::cat_file_batch(&repository.path, requests)
            .await?
            .into_iter();
        let mut read = |blob: Blob| match blob {
            Blob::Absent => Ok(String::new()),
            Blob::Inline(text) => Ok(text),
            Blob::Object(spec) => contents
                .next()
                .ok_or_else(|| AppError::upstream(format!("Git did not return {spec}."))),
        };
        files
            .iter()
            .zip(blobs)
            .map(|(file, (old, new))| {
                Ok(FilePair {
                    path: file.path.clone(),
                    status: file.status.clone(),
                    old_text: read(old)?,
                    new_text: read(new)?,
                })
            })
            .collect()
    }

    pub async fn load_pull_commits(
        &self,
        target: &PullTarget,
        revision: &ReviewRevision,
    ) -> AppResult<Option<Vec<PullCommit>>> {
        let Some(found) = self
            .prepare(
                &target.repository,
                &revision.base_oid,
                &revision.head_oid,
                Some(target.number),
            )
            .await?
        else {
            return Ok(None);
        };
        let git = Git::at(&found.path);
        connect_history(git, target.number, &revision.base_oid, &revision.head_oid).await?;
        let range = format!("{}..{}", revision.base_oid, revision.head_oid);
        let raw = git
            .ok(&[
                "log",
                "--reverse",
                "--format=%H%x1f%B%x1f%an%x1f%aI%x1e",
                &range,
                "--",
            ])
            .await?;
        raw.split('\x1e')
            .map(str::trim)
            .filter(|record| !record.is_empty())
            .map(|record| parse_pull_commit(&target.repository, record))
            .collect::<AppResult<Vec<_>>>()
            .map(Some)
    }

    pub async fn revision(&self, target: &PullTarget) -> AppResult<Option<PullRevision>> {
        let Some(repository) = self.find(&target.repository).await? else {
            return Ok(None);
        };
        let checked_at = self
            .fetch_pull(&repository, target.number, FetchPolicy::Throttled)
            .await?;
        let latest_head_oid = Git::at(&repository.path)
            .oid(&format!(
                "refs/hunker/pull/{}/head^{{commit}}",
                target.number
            ))
            .await?;
        Ok(Some(PullRevision {
            repository,
            latest_head_oid,
            checked_at,
        }))
    }
}

fn pull_refspec(number: PullNumber) -> String {
    format!("+refs/pull/{number}/head:refs/hunker/pull/{number}/head")
}

async fn missing_commits<'a>(
    git: Git<'_>,
    oids: impl IntoIterator<Item = &'a Oid>,
) -> AppResult<Vec<&'a Oid>> {
    let checks = stream::iter(oids)
        .then(|oid| async move { git.has_commit(oid).await.map(|present| (oid, present)) })
        .collect::<Vec<_>>()
        .await;
    checks
        .into_iter()
        .filter_map(|check| match check {
            Ok((_, true)) => None,
            Ok((oid, false)) => Some(Ok(oid)),
            Err(error) => Some(Err(error)),
        })
        .collect()
}

/// Shallow clones only hold the tips of a review. Listing its commits needs
/// the history between them, so deepen the pull ref until base is reachable.
async fn connect_history(
    git: Git<'_>,
    number: PullNumber,
    base: &Oid,
    head: &Oid,
) -> AppResult<()> {
    let refspec = pull_refspec(number);
    for deepen in DEEPEN_STEPS {
        if git.has_merge_base(base, head).await? {
            return Ok(());
        }
        if !git.is_shallow().await? {
            break;
        }
        git.ok(&[
            "fetch",
            "--no-tags",
            &format!("--deepen={deepen}"),
            "origin",
            &refspec,
        ])
        .await?;
    }
    if git.has_merge_base(base, head).await? {
        Ok(())
    } else {
        Err(AppError::upstream(
            "Local history does not connect this pull request's base and head.",
        ))
    }
}

fn parse_pull_commit(repository: &RepositorySlug, record: &str) -> AppResult<PullCommit> {
    let [sha, message, author, authored_at] = record.split('\x1f').collect::<Vec<_>>()[..] else {
        return Err(AppError::upstream(
            "Git returned a malformed commit record.",
        ));
    };
    let sha = Oid::parse(sha).map_err(AppError::upstream)?;
    Ok(PullCommit {
        html_url: format!("https://github.com/{repository}/commit/{sha}"),
        sha,
        message: message.trim_end().to_owned(),
        author: author.to_owned(),
        avatar_url: None,
        authored_at: Some(authored_at.to_owned()),
    })
}
