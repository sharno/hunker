use std::{
    path::Path,
    process::{ExitStatus, Output},
};

use tokio::process::Command;

use crate::{
    error::{AppError, AppResult},
    types::Oid,
};

/// A finished subprocess. Callers decide what a non-zero exit means.
pub struct Run {
    pub status: ExitStatus,
    pub stdout: String,
    pub stderr: String,
}

impl Run {
    fn from_output(output: &Output) -> Self {
        Self {
            status: output.status,
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        }
    }

    /// The most specific human-readable explanation of a failure.
    pub fn message(&self, program: &str) -> String {
        [self.stderr.trim(), self.stdout.trim()]
            .into_iter()
            .find(|text| !text.is_empty())
            .map_or_else(
                || format!("{program} exited with status {}.", self.status),
                str::to_owned,
            )
    }
}

pub async fn run(program: &str, args: &[&str], cwd: Option<&Path>) -> AppResult<Run> {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(directory) = cwd {
        command.current_dir(directory);
    }
    command
        .output()
        .await
        .map(|output| Run::from_output(&output))
        .map_err(|error| AppError::upstream(format!("Could not run {program}: {error}")))
}

pub async fn checked(program: &str, args: &[&str], cwd: Option<&Path>) -> AppResult<String> {
    let result = run(program, args, cwd).await?;
    if result.status.success() {
        Ok(result.stdout)
    } else {
        Err(AppError::upstream(result.message(program)))
    }
}

/// Git commands rooted at one repository, with Git's documented exit codes
/// decoded into typed results.
#[derive(Clone, Copy)]
pub struct Git<'a> {
    root: &'a Path,
}

impl<'a> Git<'a> {
    pub fn at(root: &'a Path) -> Self {
        Self { root }
    }

    pub async fn run(self, args: &[&str]) -> AppResult<Run> {
        run("git", args, Some(self.root)).await
    }

    pub async fn ok(self, args: &[&str]) -> AppResult<String> {
        checked("git", args, Some(self.root)).await
    }

    /// Runs a query whose exit status 1 means "no answer" (an absent config
    /// key, a missing object, no merge base, or a detached HEAD).
    pub async fn optional(self, args: &[&str]) -> AppResult<Option<String>> {
        let result = self.run(args).await?;
        match result.status.code() {
            Some(0) => Ok(Some(result.stdout)),
            Some(1) if result.stderr.trim().is_empty() => Ok(None),
            _ => Err(AppError::upstream(result.message("git"))),
        }
    }

    pub async fn oid(self, revision: &str) -> AppResult<Oid> {
        let raw = self.ok(&["rev-parse", "--verify", revision]).await?;
        Oid::parse(raw.trim()).map_err(AppError::upstream)
    }

    pub async fn head(self) -> AppResult<Oid> {
        self.oid("HEAD").await
    }

    pub async fn is_shallow(self) -> AppResult<bool> {
        Ok(self
            .ok(&["rev-parse", "--is-shallow-repository"])
            .await?
            .trim()
            == "true")
    }

    pub async fn has_commit(self, oid: &Oid) -> AppResult<bool> {
        Ok(self
            .optional(&[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("{oid}^{{commit}}"),
            ])
            .await?
            .is_some())
    }

    pub async fn has_merge_base(self, base: &Oid, head: &Oid) -> AppResult<bool> {
        Ok(self
            .optional(&["merge-base", base.as_str(), head.as_str()])
            .await?
            .is_some())
    }

    pub async fn config(self, args: &[&str]) -> AppResult<Option<String>> {
        let config_args = std::iter::once("config")
            .chain(args.iter().copied())
            .collect::<Vec<_>>();
        self.optional(&config_args).await
    }
}
