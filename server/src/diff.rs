use regex::Regex;

use crate::types::{FileChange, FileStatus};

pub fn parse_git_diff(diff: &str) -> Vec<FileChange> {
    let header = Regex::new(r"(?m)^a/(.+?) b/(.+)$").expect("valid diff header");
    let rename_from = Regex::new(r"(?m)^rename from (.+)$").expect("valid rename header");
    let rename_to = Regex::new(r"(?m)^rename to (.+)$").expect("valid rename header");
    diff.split("diff --git ")
        .filter(|chunk| !chunk.is_empty())
        .map(|chunk| {
            let fallback = header
                .captures(chunk)
                .and_then(|captures| captures.get(2))
                .map_or_else(|| "unknown".to_owned(), |value| value.as_str().to_owned());
            let previous_path = rename_from
                .captures(chunk)
                .and_then(|captures| captures.get(1))
                .map_or_else(String::new, |value| value.as_str().to_owned());
            let path = rename_to
                .captures(chunk)
                .and_then(|captures| captures.get(1))
                .map_or(fallback, |value| value.as_str().to_owned());
            let status = if chunk.contains("new file mode") {
                FileStatus::Added
            } else if chunk.contains("deleted file mode") {
                FileStatus::Deleted
            } else if previous_path.is_empty() {
                FileStatus::Modified
            } else {
                FileStatus::Renamed
            };
            let file_patch = chunk
                .find("@@")
                .map_or_else(|| chunk.to_owned(), |index| chunk[index..].to_owned());
            let additions = file_patch
                .lines()
                .filter(|line| line.starts_with('+') && !line.starts_with("+++"))
                .count();
            let deletions = file_patch
                .lines()
                .filter(|line| line.starts_with('-') && !line.starts_with("---"))
                .count();
            FileChange {
                path,
                previous_path,
                status,
                additions,
                deletions,
                patch: file_patch,
            }
        })
        .collect()
}

pub fn generated(path: &str) -> bool {
    matches!(
        path.rsplit('/')
            .next()
            .unwrap_or(path)
            .to_ascii_lowercase()
            .as_str(),
        "bun.lock"
            | "cargo.lock"
            | "composer.lock"
            | "go.sum"
            | "package-lock.json"
            | "pnpm-lock.yaml"
            | "yarn.lock"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_file_changes() {
        let files = parse_git_diff(
            "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n",
        );
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].additions, 1);
    }
}
