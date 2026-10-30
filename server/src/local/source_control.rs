use std::{collections::BTreeSet, path::Path};

use crate::{
    command::Git,
    error::{AppError, AppResult},
    types::{BranchName, RepositorySlug},
};

use super::{
    Branch, BranchPresence, Checkout, Local, PullResult, RemoteState, SourceControlStatus,
    WorkingTreeChanges, mutations, now_ms,
};

impl Local {
    pub async fn source_control(
        &self,
        repository: &RepositorySlug,
    ) -> AppResult<SourceControlStatus> {
        let root = self.repository_path(repository).await?;
        let lock = self.repository_lock(&root).await;
        let _guard = lock.lock().await;
        inspect(&root, refresh_remote(&root).await?).await
    }

    pub async fn switch_branch(
        &self,
        repository: &RepositorySlug,
        branch: &BranchName,
    ) -> AppResult<SourceControlStatus> {
        let root = self.repository_path(repository).await?;
        let lock = self.repository_lock(&root).await;
        let _guard = lock.lock().await;
        mutations::switch_branch(&root, branch).await
    }

    pub async fn pull(&self, repository: &RepositorySlug) -> AppResult<PullResult> {
        let root = self.repository_path(repository).await?;
        let lock = self.repository_lock(&root).await;
        let _guard = lock.lock().await;
        mutations::pull(&root).await
    }
}

/// Fetches `origin` and reports whether the remote could be reached.
pub(super) async fn refresh_remote(root: &Path) -> AppResult<RemoteState> {
    let git = Git::at(root);
    let checked_at = now_ms();
    let fetch = git.run(&["fetch", "--prune", "--quiet", "origin"]).await?;
    let list = git.run(&["ls-remote", "--heads", "origin"]).await?;
    Ok(if fetch.status.success() && list.status.success() {
        RemoteState::RemoteCurrent { checked_at }
    } else {
        RemoteState::RemoteUnavailable {
            checked_at,
            error: [&fetch, &list]
                .into_iter()
                .filter(|run| !run.status.success())
                .map(|run| run.message("git"))
                .collect::<Vec<_>>()
                .join("\n"),
        }
    })
}

/// Reads the checkout. `remote` is the result of the caller's most recent
/// [`refresh_remote`], so a status never claims a check that did not happen.
pub(super) async fn inspect(root: &Path, remote: RemoteState) -> AppResult<SourceControlStatus> {
    let git = Git::at(root);
    let local_names = ref_names(git, "--format=%(refname:short)", "refs/heads").await?;
    let remote_names = ref_names(git, "--format=%(refname:lstrip=3)", "refs/remotes/origin")
        .await?
        .into_iter()
        .filter(|name| name != "HEAD")
        .collect::<BTreeSet<_>>();
    let branches = local_names
        .union(&remote_names)
        .map(|name| {
            let presence = match (local_names.contains(name), remote_names.contains(name)) {
                (true, true) => BranchPresence::Both,
                (true, false) => BranchPresence::Local,
                (false, _) => BranchPresence::Remote,
            };
            BranchName::parse(name.as_str())
                .map(|name| Branch { name, presence })
                .map_err(AppError::upstream)
        })
        .collect::<AppResult<Vec<_>>>()?;
    let checkout = checkout(git).await?;
    let changes = WorkingTreeChanges {
        staged: count_paths(git, &["diff", "--cached", "--name-only", "-z"]).await?,
        unstaged: count_paths(git, &["diff", "--name-only", "-z"]).await?,
        untracked: count_paths(git, &["ls-files", "--others", "--exclude-standard", "-z"]).await?,
    };
    Ok(SourceControlStatus {
        path: root.to_string_lossy().into_owned(),
        checkout,
        branches,
        changes,
        remote,
    })
}

async fn ref_names(git: Git<'_>, format: &str, prefix: &str) -> AppResult<BTreeSet<String>> {
    Ok(git
        .ok(&["for-each-ref", format, prefix])
        .await?
        .lines()
        .map(str::to_owned)
        .collect())
}

async fn checkout(git: Git<'_>) -> AppResult<Checkout> {
    let oid = git.head().await?;
    let Some(symbolic) = git
        .optional(&["symbolic-ref", "--quiet", "--short", "HEAD"])
        .await?
    else {
        return Ok(Checkout::DetachedHead { oid });
    };
    let name = BranchName::parse(symbolic.trim()).map_err(AppError::upstream)?;
    let upstream = git
        .ok(&[
            "for-each-ref",
            "--format=%(upstream:short)",
            &format!("refs/heads/{name}"),
        ])
        .await?
        .trim()
        .to_owned();
    if upstream.is_empty() {
        return Ok(Checkout::UntrackedBranch { name, oid });
    }
    let counts = git
        .ok(&["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
        .await?;
    let (ahead, behind) = parse_ahead_behind(&counts)?;
    Ok(Checkout::TrackingBranch {
        name,
        oid,
        upstream,
        ahead,
        behind,
    })
}

async fn count_paths(git: Git<'_>, args: &[&str]) -> AppResult<usize> {
    Ok(git
        .ok(args)
        .await?
        .split('\0')
        .filter(|value| !value.is_empty())
        .count())
}

fn parse_ahead_behind(raw: &str) -> AppResult<(usize, usize)> {
    let [ahead, behind] = raw.split_whitespace().collect::<Vec<_>>()[..] else {
        return Err(AppError::upstream(
            "Git returned an invalid ahead/behind count.",
        ));
    };
    let count = |value: &str| {
        value
            .parse()
            .map_err(|_| AppError::upstream("Git returned an invalid ahead/behind count."))
    };
    Ok((count(ahead)?, count(behind)?))
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
