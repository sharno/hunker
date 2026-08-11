use std::path::{Path, PathBuf};

use crate::{
    command,
    error::{AppError, AppResult},
    settings,
    types::{BranchName, CloneDestination, RepositorySlug},
};

use super::{Checkout, Local, PullResult, SourceControlStatus, source_control, valid_segment};

impl Local {
    pub async fn clone_repository(
        &self,
        repository: &RepositorySlug,
        destination: CloneDestination,
    ) -> AppResult<PathBuf> {
        if !valid_segment(&repository.owner) || !valid_segment(&repository.name) {
            return Err(AppError::bad_request("That repository name is not valid."));
        }
        let settings = settings::load().await?.settings;
        let root = match destination {
            CloneDestination::Configured => settings::resolve_path(&settings.repositories_root),
            CloneDestination::Temporary => settings::resolve_path(&settings.cache_root),
        };
        let target = match destination {
            CloneDestination::Configured => root.join(&repository.name),
            CloneDestination::Temporary => root.join(&repository.owner).join(&repository.name),
        };
        if target.exists() {
            return Ok(target);
        }
        tokio::fs::create_dir_all(target.parent().unwrap_or(&root))
            .await
            .map_err(|error| {
                AppError::internal(format!("Could not create clone directory: {error}"))
            })?;
        let target_text = target.to_string_lossy();
        command::checked(
            "gh",
            &[
                "repo",
                "clone",
                &format!("{}/{}", repository.owner, repository.name),
                &target_text,
                "--",
                "--depth=1",
                "--single-branch",
                "--filter=blob:none",
                "--no-tags",
            ],
            target.parent(),
        )
        .await?;
        Ok(target)
    }
}

pub(super) async fn switch_branch(
    root: &Path,
    branch: &BranchName,
) -> AppResult<SourceControlStatus> {
    let branch = branch.as_str();
    action(root, &["check-ref-format", "--branch", branch]).await?;
    let current = source_control::inspect(root, true).await?;
    let target = current
        .branches
        .iter()
        .find(|candidate| candidate.name == branch)
        .cloned()
        .ok_or_else(|| AppError::not_found(format!("Branch {branch} was not found.")))?;
    if target.local {
        action(root, &["switch", "--", branch]).await?;
    } else {
        let refspec = format!("+refs/heads/{branch}:refs/remotes/origin/{branch}");
        let configured = command::git_config(root, &["--get-all", "remote.origin.fetch"])
            .await?
            .unwrap_or_default();
        if !configured.lines().any(|line| line == refspec) {
            action(root, &["config", "--add", "remote.origin.fetch", &refspec]).await?;
        }
        let remote_ref = format!("refs/heads/{branch}:refs/remotes/origin/{branch}");
        action(root, &["fetch", "origin", &remote_ref, "--depth=1"]).await?;
        let origin = format!("origin/{branch}");
        action(root, &["switch", "--track", "-c", branch, "--", &origin]).await?;
    }
    source_control::inspect(root, false).await
}

pub(super) async fn pull(root: &Path) -> AppResult<PullResult> {
    let current = source_control::inspect(root, true).await?;
    let (behind, before) = match &current.checkout {
        Checkout::DetachedHead { .. } => {
            return Err(AppError::conflict(
                "Cannot pull while HEAD is detached. Switch to a branch first.",
            ));
        }
        Checkout::UntrackedBranch { name, .. } => {
            return Err(AppError::conflict(format!(
                "Branch {name} does not track a remote branch."
            )));
        }
        Checkout::TrackingBranch { behind, oid, .. } => (*behind, oid.clone()),
    };
    if behind == 0 {
        return Ok(PullResult { pulled_commits: 0 });
    }
    action(root, &["pull", "--ff-only"]).await?;
    let after = command::git(root, &["rev-parse", "HEAD"])
        .await?
        .trim()
        .to_owned();
    let pulled_commits = command::git(
        root,
        &["rev-list", "--count", &format!("{before}..{after}")],
    )
    .await?
    .trim()
    .parse()
    .map_err(|_| AppError::upstream("Git returned an invalid pulled commit count."))?;
    Ok(PullResult { pulled_commits })
}

async fn action(path: &Path, args: &[&str]) -> AppResult<String> {
    let output = command::output("git", args, Some(path)).await?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    if output.status.success() {
        Ok(text)
    } else {
        let exit_code = output.status.code().unwrap_or(-1);
        Err(AppError::conflict(if text.trim().is_empty() {
            format!(
                "Git {} refused the operation with status {exit_code}.",
                args.first().copied().unwrap_or("command")
            )
        } else {
            text.trim().to_owned()
        }))
    }
}
