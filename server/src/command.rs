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
        String::from_utf8(result.stdout)
            .map_err(|_| AppError::upstream(format!("{program} returned invalid UTF-8.")))
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr).trim().to_owned();
        let stdout = String::from_utf8_lossy(&result.stdout).trim().to_owned();
        Err(AppError::upstream(if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("{program} exited with status {}.", result.status)
        }))
    }
}

pub async fn git(cwd: &Path, args: &[&str]) -> AppResult<String> {
    checked("git", args, Some(cwd)).await
}
