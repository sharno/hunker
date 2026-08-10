use std::path::{Component, Path};

use tokio::{io::AsyncWriteExt, process::Command};

use crate::error::{AppError, AppResult};

pub(super) fn gitlink_text(patch: &str, marker: char) -> Option<String> {
    let prefix = format!("{marker}Subproject commit ");
    patch
        .lines()
        .find_map(|line| line.strip_prefix(&prefix))
        .map(|oid| format!("Subproject commit {oid}\n"))
}

pub(super) fn validate_git_path(path: &str) -> AppResult<()> {
    if path.is_empty()
        || path.starts_with('/')
        || path.contains(['\0', '\n', '\r'])
        || Path::new(path)
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        Err(AppError::bad_request("That file path is not valid."))
    } else {
        Ok(())
    }
}

pub(super) async fn cat_file_batch(
    repository: &Path,
    objects: &[String],
) -> AppResult<Vec<String>> {
    if objects.is_empty() {
        return Ok(Vec::new());
    }
    let mut child = Command::new("git")
        .args(["cat-file", "--batch"])
        .current_dir(repository)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| AppError::upstream(format!("Could not start git cat-file: {error}")))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::internal("git cat-file did not expose stdin."))?;
    for object in objects {
        stdin
            .write_all(object.as_bytes())
            .await
            .map_err(|error| AppError::upstream(format!("Could not query Git objects: {error}")))?;
        stdin
            .write_all(b"\n")
            .await
            .map_err(|error| AppError::upstream(format!("Could not query Git objects: {error}")))?;
    }
    drop(stdin);
    let output = child
        .wait_with_output()
        .await
        .map_err(|error| AppError::upstream(format!("Could not read Git objects: {error}")))?;
    if !output.status.success() {
        return Err(AppError::upstream(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    parse_cat_file_batch(&output.stdout, objects)
}

fn parse_cat_file_batch(output: &[u8], objects: &[String]) -> AppResult<Vec<String>> {
    let mut cursor = 0;
    let mut values = Vec::with_capacity(objects.len());
    for object in objects {
        let header_end = output[cursor..]
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|position| cursor + position)
            .ok_or_else(|| AppError::upstream("git cat-file returned an incomplete header."))?;
        let header = std::str::from_utf8(&output[cursor..header_end])
            .map_err(|_| AppError::upstream("git cat-file returned an invalid header."))?;
        if header.ends_with(" missing") {
            return Err(AppError::not_found(format!(
                "Git object {object} was not found."
            )));
        }
        let size = header
            .rsplit_once(' ')
            .and_then(|(_, size)| size.parse::<usize>().ok())
            .ok_or_else(|| AppError::upstream("git cat-file returned an invalid object size."))?;
        let content_start = header_end + 1;
        let content_end = content_start
            .checked_add(size)
            .filter(|end| *end < output.len())
            .ok_or_else(|| AppError::upstream("git cat-file returned an incomplete object."))?;
        if output[content_end] != b'\n' {
            return Err(AppError::upstream(
                "git cat-file returned an invalid object boundary.",
            ));
        }
        values.push(
            String::from_utf8(output[content_start..content_end].to_vec())
                .map_err(|_| AppError::upstream("Git returned a non-text file."))?,
        );
        cursor = content_end + 1;
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_batched_git_objects_without_losing_embedded_newlines() {
        let objects = vec!["base:a.txt".to_owned(), "head:a.txt".to_owned()];
        let output = b"1111111111111111111111111111111111111111 blob 5\nhello\n2222222222222222222222222222222222222222 blob 6\nworld\n\n";
        assert_eq!(
            parse_cat_file_batch(output, &objects).unwrap(),
            vec!["hello".to_owned(), "world\n".to_owned()]
        );
    }

    #[test]
    fn reads_gitlink_revisions_from_the_superproject_patch() {
        assert_eq!(
            gitlink_text(
                "@@ -1 +0,0 @@\n-Subproject commit de2a9a69099993087e57c64df58537c765ac0224",
                '-'
            ),
            Some("Subproject commit de2a9a69099993087e57c64df58537c765ac0224\n".to_owned())
        );
    }
}
