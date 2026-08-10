use std::{path::Path, process::Output};

use tokio::process::Command;

use crate::error::{AppError, AppResult};

pub async fn output(program: &str, args: &[&str], cwd: Option<&Path>) -> AppResult<Output> {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(directory) = cwd {
        command.current_dir(directory);
    }
    command
        .output()
        .await
        .map_err(|error| AppError::upstream(format!("Could not run {program}: {error}")))
}

pub async fn checked(program: &str, args: &[&str], cwd: Option<&Path>) -> AppResult<String> {
    let result = output(program, args, cwd).await?;
    if result.status.success() {
        stdout(program, result)
    } else {
        Err(failure(program, &result))
    }
}

pub async fn git(cwd: &Path, args: &[&str]) -> AppResult<String> {
    checked("git", args, Some(cwd)).await
}

/// Reads a Git configuration value while preserving the distinction between an
/// absent key (Git's documented exit status 1) and a command failure.
pub async fn git_config(cwd: &Path, args: &[&str]) -> AppResult<Option<String>> {
    let mut config_args = Vec::with_capacity(args.len() + 1);
    config_args.push("config");
    config_args.extend_from_slice(args);
    let result = output("git", &config_args, Some(cwd)).await?;
    if result.status.success() {
        stdout("git", result).map(Some)
    } else if result.status.code() == Some(1)
        && result.stdout.is_empty()
        && result.stderr.is_empty()
    {
        Ok(None)
    } else {
        Err(failure("git", &result))
    }
}

fn stdout(program: &str, result: Output) -> AppResult<String> {
    String::from_utf8(result.stdout)
        .map_err(|_| AppError::upstream(format!("{program} returned invalid UTF-8.")))
}

fn failure(program: &str, result: &Output) -> AppError {
    let stderr = String::from_utf8_lossy(&result.stderr).trim().to_owned();
    let stdout = String::from_utf8_lossy(&result.stdout).trim().to_owned();
    AppError::upstream(if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("{program} exited with status {}.", result.status)
    })
}
