use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::Arc,
};

use tokio::sync::Mutex;

use crate::{
    command,
    error::{AppError, AppResult},
    types::{BranchName, RepositorySlug},
};

use super::{
    Branch, Checkout, Local, PullResult, RemoteState, SourceControlStatus, WorkingTreeChanges,
    git_result, mutations, now_ms,
};
impl Local {
    async fn lock_for(&self, repository: &RepositorySlug) -> AppResult<(PathBuf, Arc<Mutex<()>>)> {
        let root = self.repository_path(repository).await?;
        let lock = {
            let mut locks = self.repository_locks.lock().await;
            locks
                .entry(root.clone())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        Ok((root, lock))
    }

    pub async fn source_control(
        &self,
        repository: &RepositorySlug,
    ) -> AppResult<SourceControlStatus> {
        let (root, lock) = self.lock_for(repository).await?;
        let _guard = lock.lock().await;
        inspect(&root, true).await
    }

    pub async fn switch_branch(
        &self,
        repository: &RepositorySlug,
        branch: &BranchName,
    ) -> AppResult<SourceControlStatus> {
        let (root, lock) = self.lock_for(repository).await?;
        let _guard = lock.lock().await;
        mutations::switch_branch(&root, branch).await
    }

    pub async fn pull(&self, repository: &RepositorySlug) -> AppResult<PullResult> {
        let (root, lock) = self.lock_for(repository).await?;
        let _guard = lock.lock().await;
        mutations::pull(&root).await
    }
}

pub(super) async fn inspect(root: &Path, refresh: bool) -> AppResult<SourceControlStatus> {
    let checked_at = now_ms();
    let remote = if refresh {
        let fetch = git_result(root, &["fetch", "--prune", "--quiet", "origin"]).await?;
        let list = git_result(root, &["ls-remote", "--heads", "origin"]).await?;
        if fetch.0 && list.0 {
            RemoteState::RemoteCurrent { checked_at }
        } else {
            RemoteState::RemoteUnavailable {
                checked_at,
                error: [fetch.1, list.1]
                    .into_iter()
                    .filter(|value| !value.trim().is_empty())
                    .collect::<Vec<_>>()
                    .join("\n"),
            }
        }
    } else {
        RemoteState::RemoteCurrent { checked_at }
    };
    let local_raw = command::git(
        root,
        &[
            "for-each-ref",
            "--format=%(refname:short)%00%(objectname)",
            "refs/heads",
        ],
    )
    .await?;
    let local_names = local_raw
        .lines()
        .filter_map(|line| line.split_once('\0').map(|(name, _)| name.to_owned()))
        .collect::<BTreeSet<_>>();
    let remote_raw = command::git(
        root,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/remotes/origin",
        ],
    )
    .await?;
    let remote_names = remote_raw
        .lines()
        .filter_map(|line| line.strip_prefix("origin/"))
        .filter(|name| *name != "HEAD")
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
    let branches = local_names
        .union(&remote_names)
        .map(|name| Branch {
            name: name.clone(),
            local: local_names.contains(name),
            remote: remote_names.contains(name),
        })
        .collect();
    let oid = command::git(root, &["rev-parse", "HEAD"])
        .await?
        .trim()
        .to_owned();
    let symbolic = git_result(root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).await?;
    let checkout = if symbolic.0 {
        let name = symbolic.1.trim().to_owned();
        let upstream = command::git(
            root,
            &[
                "for-each-ref",
                "--format=%(upstream:short)",
                &format!("refs/heads/{name}"),
            ],
        )
        .await?
        .trim()
        .to_owned();
        if upstream.is_empty() {
            Checkout::UntrackedBranch { name, oid }
        } else {
            let counts = command::git(
                root,
                &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
            )
            .await?;
            let (ahead, behind) = parse_ahead_behind(&counts)?;
            Checkout::TrackingBranch {
                name,
                oid,
                upstream,
                ahead,
                behind,
            }
        }
    } else {
        Checkout::DetachedHead { oid }
    };
    let staged = command::git(root, &["diff", "--cached", "--name-only", "-z"])
        .await?
        .split('\0')
        .filter(|value| !value.is_empty())
        .count();
    let unstaged = command::git(root, &["diff", "--name-only", "-z"])
        .await?
        .split('\0')
        .filter(|value| !value.is_empty())
        .count();
    let untracked = command::git(root, &["ls-files", "--others", "--exclude-standard", "-z"])
        .await?
        .split('\0')
        .filter(|value| !value.is_empty())
        .count();
    Ok(SourceControlStatus {
        path: root.to_string_lossy().into_owned(),
        checkout,
        branches,
        changes: WorkingTreeChanges {
            staged,
            unstaged,
            untracked,
        },
        remote,
    })
}

fn parse_ahead_behind(raw: &str) -> AppResult<(usize, usize)> {
    let values = raw.split_whitespace().collect::<Vec<_>>();
    let [ahead, behind] = values.as_slice() else {
        return Err(AppError::upstream(
            "Git returned an invalid ahead/behind count.",
        ));
    };
    let ahead = ahead
        .parse()
        .map_err(|_| AppError::upstream("Git returned an invalid ahead count."))?;
    let behind = behind
        .parse()
        .map_err(|_| AppError::upstream("Git returned an invalid behind count."))?;
    Ok((ahead, behind))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_or_malformed_ahead_behind_counts() {
        assert!(parse_ahead_behind("1").is_err());
        assert!(parse_ahead_behind("one two").is_err());
        assert_eq!(parse_ahead_behind("3 5").unwrap(), (3, 5));
    }
}
