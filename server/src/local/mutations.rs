use std::path::{Path, PathBuf};

use crate::{
    command::{self, Git},
    error::{AppError, AppResult},
    types::{BranchName, Oid, RepositoryRoot, RepositorySlug},
};

use super::{
    BranchPresence, Checkout, Local, PullResult, SourceControlStatus,
    source_control::{inspect, refresh_remote},
};

impl Local {
    pub async fn clone_repository(
        &self,
        repository: &RepositorySlug,
        root: RepositoryRoot,
    ) -> AppResult<PathBuf> {
        let roots = self.settings.roots().await?;
        let target = roots.clone_target(repository, root);
        let lock = self.repository_lock(&target).await;
        let _guard = lock.lock().await;
        if let Some(existing) = self.find(repository).await? {
            return Ok(existing.path);
        }
        let parent = target.parent().unwrap_or_else(|| roots.path(root));
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            AppError::internal(format!("Could not create clone directory: {error}"))
        })?;
        command::checked(
            "gh",
            &[
                "repo",
                "clone",
                &repository.to_string(),
                &target.to_string_lossy(),
                "--",
                "--depth=1",
                "--single-branch",
                "--filter=blob:none",
                "--no-tags",
            ],
            Some(parent),
        )
        .await?;
        Ok(target)
    }
}

pub(super) async fn switch_branch(
    root: &Path,
    branch: &BranchName,
) -> AppResult<SourceControlStatus> {
    let git = Git::at(root);
    let name = branch.as_str();
    if !git
        .run(&["check-ref-format", "--branch", name])
        .await?
        .status
        .success()
    {
        return Err(AppError::bad_request(format!(
            "{name} is not a valid branch name."
        )));
    }
    let remote = refresh_remote(root).await?;
    let current = inspect(root, remote.clone()).await?;
    let presence = current
        .branches
        .iter()
        .find(|candidate| candidate.name == *branch)
        .map(|candidate| candidate.presence)
        .ok_or_else(|| AppError::not_found(format!("Branch {name} was not found.")))?;
    match presence {
        BranchPresence::Local | BranchPresence::Both => {
            refusable(git, &["switch", "--", name]).await?;
        }
        BranchPresence::Remote => {
            let refspec = format!("+refs/heads/{name}:refs/remotes/origin/{name}");
            let configured = git
                .config(&["--get-all", "remote.origin.fetch"])
                .await?
                .unwrap_or_default();
            if !configured.lines().any(|line| line == refspec) {
                refusable(git, &["config", "--add", "remote.origin.fetch", &refspec]).await?;
            }
            refusable(
                git,
                &[
                    "fetch",
                    "origin",
                    &format!("refs/heads/{name}:refs/remotes/origin/{name}"),
                    "--depth=1",
                ],
            )
            .await?;
            refusable(
                git,
                &[
                    "switch",
                    "--track",
                    "-c",
                    name,
                    "--",
                    &format!("origin/{name}"),
                ],
            )
            .await?;
        }
    }
    inspect(root, remote).await
}

pub(super) async fn pull(root: &Path) -> AppResult<PullResult> {
    let git = Git::at(root);
    let current = inspect(root, refresh_remote(root).await?).await?;
    let (behind, before) = tracking(current.checkout)?;
    if behind == 0 {
        return Ok(PullResult { pulled_commits: 0 });
    }
    refusable(git, &["pull", "--ff-only"]).await?;
    let after = git.head().await?;
    let pulled_commits = git
        .ok(&["rev-list", "--count", &format!("{before}..{after}")])
        .await?
        .trim()
        .parse()
        .map_err(|_| AppError::upstream("Git returned an invalid pulled commit count."))?;
    Ok(PullResult { pulled_commits })
}

/// Only a branch with an upstream can be fast-forwarded.
fn tracking(checkout: Checkout) -> AppResult<(usize, Oid)> {
    match checkout {
        Checkout::TrackingBranch { behind, oid, .. } => Ok((behind, oid)),
        Checkout::DetachedHead { .. } => Err(AppError::conflict(
            "Cannot pull while HEAD is detached. Switch to a branch first.",
        )),
        Checkout::UntrackedBranch { name, .. } => Err(AppError::conflict(format!(
            "Branch {name} does not track a remote branch."
        ))),
    }
}

/// Runs a checkout mutation. Git is the authority on whether it is safe, so
/// its refusal is surfaced verbatim as a conflict.
async fn refusable(git: Git<'_>, args: &[&str]) -> AppResult<String> {
    let result = git.run(args).await?;
    if result.status.success() {
        Ok(result.stdout)
    } else {
        Err(AppError::conflict(result.message("git")))
    }
}
