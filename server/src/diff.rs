use std::collections::BTreeSet;

use regex::Regex;

use crate::types::{FileChange, FileStatus};

pub fn parse_git_diff(diff: &str) -> Vec<FileChange> {
    let boundary = Regex::new(r"(?m)^diff --git ").expect("valid diff boundary");
    let rename_from = Regex::new(r"(?m)^rename from (.+)$").expect("valid rename header");
    let rename_to = Regex::new(r"(?m)^rename to (.+)$").expect("valid rename header");
    boundary
        .split(diff)
        .filter(|chunk| !chunk.is_empty())
        .map(|chunk| {
            let metadata = chunk
                .lines()
                .take_while(|line| !line.starts_with("@@"))
                .collect::<Vec<_>>()
                .join("\n");
            let fallback = chunk
                .lines()
                .next()
                .and_then(|line| line.split_once(" b/"))
                .map_or_else(|| "unknown".to_owned(), |(_, path)| path.to_owned());
            let previous_path = rename_from
                .captures(&metadata)
                .and_then(|captures| captures.get(1))
                .map(|value| value.as_str().to_owned());
            let path = rename_to
                .captures(&metadata)
                .and_then(|captures| captures.get(1))
                .map_or(fallback, |value| value.as_str().to_owned());
            let status = if metadata.contains("new file mode") {
                FileStatus::Added
            } else if metadata.contains("deleted file mode") {
                FileStatus::Deleted
            } else if previous_path.is_none() {
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

#[derive(Debug, Default, PartialEq, Eq)]
pub struct PatchLines {
    pub old: BTreeSet<usize>,
    pub new: BTreeSet<usize>,
}

pub fn patch_lines(patch: &str) -> PatchLines {
    let header = Regex::new(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@")
        .expect("valid hunk-header expression");
    let mut result = PatchLines::default();
    let mut old_line = 0;
    let mut new_line = 0;
    let mut inside_hunk = false;
    for line in patch.lines() {
        if let Some(captures) = header.captures(line) {
            old_line = captures
                .get(1)
                .and_then(|value| value.as_str().parse().ok())
                .unwrap_or(0);
            new_line = captures
                .get(2)
                .and_then(|value| value.as_str().parse().ok())
                .unwrap_or(0);
            inside_hunk = true;
            continue;
        }
        if !inside_hunk {
            continue;
        }
        match line.as_bytes().first() {
            Some(b' ') => {
                result.old.insert(old_line);
                result.new.insert(new_line);
                old_line += 1;
                new_line += 1;
            }
            Some(b'-') => {
                result.old.insert(old_line);
                old_line += 1;
            }
            Some(b'+') => {
                result.new.insert(new_line);
                new_line += 1;
            }
            Some(b'\\') => {}
            _ => inside_hunk = false,
        }
    }
    result
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

    #[test]
    fn does_not_split_a_diff_header_inside_changed_source() {
        let files = parse_git_diff(
            "diff --git a/test.rs b/test.rs\n--- a/test.rs\n+++ b/test.rs\n@@ -1 +1 @@\n-let fixture = \"diff --git a/a b/a\";\n+let fixture = \"new file mode\";\n",
        );
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "test.rs");
        assert_eq!(files[0].status, FileStatus::Modified);
    }

    #[test]
    fn indexes_visible_patch_lines_by_side() {
        let lines = patch_lines("@@ -4,3 +8,4 @@\n context\n-old\n+new\n+extra\n context");
        assert_eq!(lines.old, BTreeSet::from([4, 5, 6]));
        assert_eq!(lines.new, BTreeSet::from([8, 9, 10, 11]));
    }
}
