use std::{path::Path, process::Stdio};

use tokio::{io::AsyncWriteExt, process::Command};

use crate::{
    error::{AppError, AppResult},
    types::Side,
};

/// Git renders a submodule bump as `±Subproject commit <oid>` instead of blob
/// content, so the revision text comes from the superproject patch itself.
pub(super) fn gitlink_text(patch: &str, side: Side) -> Option<String> {
    let prefix = match side {
        Side::Old => "-Subproject commit ",
        Side::New => "+Subproject commit ",
    };
    patch
        .lines()
        .find_map(|line| line.strip_prefix(prefix))
        .map(|oid| format!("Subproject commit {oid}\n"))
}

pub(super) async fn cat_file_batch(
    repository: &Path,
    objects: Vec<String>,
) -> AppResult<Vec<String>> {
    if objects.is_empty() {
        return Ok(Vec::new());
    }
    let mut child = Command::new("git")
        .args(["cat-file", "--batch"])
        .current_dir(repository)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| AppError::upstream(format!("Could not start git cat-file: {error}")))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::internal("git cat-file did not expose stdin."))?;
    let request = objects.iter().fold(String::new(), |mut request, object| {
        request.push_str(object);
        request.push('\n');
        request
    });
    // Requests and responses must flow concurrently: once git's stdout pipe
    // fills, it stops reading stdin, so writing everything first deadlocks.
    let write = async move {
        stdin
            .write_all(request.as_bytes())
            .await
            .map_err(|error| AppError::upstream(format!("Could not query Git objects: {error}")))
        // Dropping stdin here closes the pipe so git can exit.
    };
    let read = async {
        child
            .wait_with_output()
            .await
            .map_err(|error| AppError::upstream(format!("Could not read Git objects: {error}")))
    };
    let ((), output) = tokio::try_join!(write, read)?;
    if !output.status.success() {
        return Err(AppError::upstream(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    parse_cat_file_batch(&output.stdout, &objects)
}

fn parse_cat_file_batch(output: &[u8], objects: &[String]) -> AppResult<Vec<String>> {
    objects
        .iter()
        .try_fold(
            (Vec::with_capacity(objects.len()), 0),
            |(mut values, cursor), object| {
                let (value, next) = parse_object(output, cursor, object)?;
                values.push(value);
                Ok((values, next))
            },
        )
        .map(|(values, _)| values)
}

/// Parses one `<oid> <type> <size>\n<content>\n` record starting at `cursor`.
fn parse_object(output: &[u8], cursor: usize, object: &str) -> AppResult<(String, usize)> {
    let remaining = output
        .get(cursor..)
        .ok_or_else(|| AppError::upstream("git cat-file returned an incomplete response."))?;
    let header_end = remaining
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
        .filter(|end| output.get(*end) == Some(&b'\n'))
        .ok_or_else(|| AppError::upstream("git cat-file returned an incomplete object."))?;
    let content = String::from_utf8(output[content_start..content_end].to_vec())
        .map_err(|_| AppError::upstream("Git returned a non-text file."))?;
    Ok((content, content_end + 1))
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
        assert!(parse_cat_file_batch(b"1111 blob 9\nshort\n", &objects[..1]).is_err());
    }

    #[test]
    fn reads_gitlink_revisions_from_the_superproject_patch() {
        assert_eq!(
            gitlink_text(
                "@@ -1 +0,0 @@\n-Subproject commit de2a9a69099993087e57c64df58537c765ac0224",
                Side::Old
            ),
            Some("Subproject commit de2a9a69099993087e57c64df58537c765ac0224\n".to_owned())
        );
    }
}
