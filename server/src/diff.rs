use std::{collections::BTreeSet, sync::LazyLock};

use regex::Regex;

use crate::{
    error::{AppError, AppResult},
    types::{FileChange, FileStatus, RelativePath},
};

static FILE_BOUNDARY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^diff --git ").expect("valid diff boundary"));

/// A parsed `@@ -old,count +new,count @@` header. Counts default to 1, as
/// Git omits them for single-line ranges.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HunkHeader {
    pub old_start: usize,
    pub old_count: usize,
    pub new_start: usize,
    pub new_count: usize,
}

static HUNK_HEADER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@").expect("valid hunk header")
});

impl HunkHeader {
    pub fn parse(line: &str) -> Option<Self> {
        let captures = HUNK_HEADER.captures(line)?;
        let number = |index: usize, default: Option<usize>| {
            captures
                .get(index)
                .map_or(default, |value| value.as_str().parse().ok())
        };
        Some(Self {
            old_start: number(1, None)?,
            old_count: number(2, Some(1))?,
            new_start: number(3, None)?,
            new_count: number(4, Some(1))?,
        })
    }
}

/// Splits a Git patch into file changes. File boundaries are only line-start
/// `diff --git` headers, and status metadata is only read before the first
/// hunk, because changed source can contain diff headers itself.
pub fn parse_git_diff(diff: &str) -> AppResult<Vec<FileChange>> {
    FILE_BOUNDARY
        .split(diff)
        .filter(|chunk| !chunk.is_empty())
        .map(parse_file)
        .collect()
}

fn parse_file(chunk: &str) -> AppResult<FileChange> {
    let header_lines = chunk
        .split_inclusive('\n')
        .take_while(|line| !line.starts_with("@@"))
        .map(|line| line.trim_end_matches(['\r', '\n']))
        .collect::<Vec<_>>();
    let patch = hunk_text(chunk, &header_lines);
    let metadata = |prefix: &str| {
        header_lines
            .iter()
            .find_map(|line| line.strip_prefix(prefix))
    };
    let parse_path = |value: &str| {
        RelativePath::parse(value).map_err(|_| {
            AppError::upstream(format!("Git returned an unreadable diff path: {value}"))
        })
    };
    let new_path = metadata("rename to ")
        .or_else(|| metadata("+++ b/"))
        .or_else(|| metadata("--- a/"))
        .or_else(|| {
            header_lines
                .first()
                .and_then(|line| symmetric_header_path(line))
        })
        .ok_or_else(|| AppError::upstream("Git returned a diff without a file path."))?;
    let status = if metadata("new file mode ").is_some() {
        FileStatus::Added
    } else if metadata("deleted file mode ").is_some() {
        FileStatus::Deleted
    } else if let Some(previous) = metadata("rename from ") {
        FileStatus::Renamed {
            previous_path: parse_path(previous)?,
        }
    } else {
        FileStatus::Modified
    };
    let (additions, deletions) = count_changes(&patch);
    Ok(FileChange {
        path: parse_path(new_path)?,
        status,
        additions,
        deletions,
        patch,
    })
}

/// The patch text from the first line-start hunk header, without the final
/// newline. Chunks without hunks (renames, mode changes, binaries) have none.
fn hunk_text(chunk: &str, header_lines: &[&str]) -> String {
    let offset = chunk
        .split_inclusive('\n')
        .take(header_lines.len())
        .map(str::len)
        .sum::<usize>();
    chunk
        .get(offset..)
        .filter(|rest| rest.starts_with("@@"))
        .map_or_else(String::new, |rest| rest.trim_end_matches('\n').to_owned())
}

/// `a/P b/P` for a file whose name did not change. Both halves have the same
/// length, which disambiguates paths that contain ` b/`.
fn symmetric_header_path(header: &str) -> Option<&str> {
    let rest = header.strip_prefix("a/")?;
    let length = rest.len().checked_sub(3)? / 2;
    let (old, new) = (rest.get(..length)?, rest.get(length..)?);
    let new = new.strip_prefix(" b/")?;
    (old == new).then_some(new)
}

/// Every `+` or `-` line after the first hunk header is a change; file
/// headers were already removed, so `+++`/`---` here are changed content.
fn count_changes(patch: &str) -> (usize, usize) {
    patch.lines().fold((0, 0), |(additions, deletions), line| {
        match line.as_bytes().first() {
            Some(b'+') => (additions + 1, deletions),
            Some(b'-') => (additions, deletions + 1),
            _ => (additions, deletions),
        }
    })
}

pub fn generated(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    matches!(
        name.as_str(),
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

/// Indexes which old and new line numbers a patch shows.
pub fn patch_lines(patch: &str) -> PatchLines {
    enum Cursor {
        Outside,
        Inside { old: usize, new: usize },
    }
    patch
        .lines()
        .fold(
            (PatchLines::default(), Cursor::Outside),
            |(mut lines, cursor), line| {
                if let Some(header) = HunkHeader::parse(line) {
                    return (
                        lines,
                        Cursor::Inside {
                            old: header.old_start,
                            new: header.new_start,
                        },
                    );
                }
                let Cursor::Inside { old, new } = cursor else {
                    return (lines, Cursor::Outside);
                };
                let next = match line.as_bytes().first() {
                    Some(b' ') => {
                        lines.old.insert(old);
                        lines.new.insert(new);
                        Cursor::Inside {
                            old: old + 1,
                            new: new + 1,
                        }
                    }
                    Some(b'-') => {
                        lines.old.insert(old);
                        Cursor::Inside { old: old + 1, new }
                    }
                    Some(b'+') => {
                        lines.new.insert(new);
                        Cursor::Inside { old, new: new + 1 }
                    }
                    Some(b'\\') => Cursor::Inside { old, new },
                    _ => Cursor::Outside,
                };
                (lines, next)
            },
        )
        .0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_file_changes() {
        let files = parse_git_diff(
            "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n",
        )
        .unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].additions, 1);
        assert_eq!(files[0].patch, "@@ -1 +1 @@\n-a\n+b");
    }

    #[test]
    fn counts_changed_lines_that_look_like_file_headers() {
        let files = parse_git_diff(
            "diff --git a/q.sql b/q.sql\n--- a/q.sql\n+++ b/q.sql\n@@ -1 +1 @@\n--- old comment\n+++i;\n",
        )
        .unwrap();
        assert_eq!((files[0].additions, files[0].deletions), (1, 1));
    }

    #[test]
    fn does_not_split_a_diff_header_inside_changed_source() {
        let files = parse_git_diff(
            "diff --git a/test.rs b/test.rs\n--- a/test.rs\n+++ b/test.rs\n@@ -1 +1 @@\n-let fixture = \"diff --git a/a b/a\";\n+let fixture = \"new file mode\";\n",
        )
        .unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path.as_str(), "test.rs");
        assert_eq!(files[0].status, FileStatus::Modified);
    }

    #[test]
    fn reads_rename_only_and_ambiguous_paths_from_headers() {
        let files = parse_git_diff(
            "diff --git a/old name.rs b/new name.rs\nsimilarity index 100%\nrename from old name.rs\nrename to new name.rs\ndiff --git a/a b/c.bin b/a b/c.bin\nindex 1..2\nBinary files differ\n",
        )
        .unwrap();
        assert_eq!(files[0].path.as_str(), "new name.rs");
        assert!(matches!(
            &files[0].status,
            FileStatus::Renamed { previous_path } if previous_path.as_str() == "old name.rs"
        ));
        assert_eq!(files[0].patch, "");
        assert_eq!(files[1].path.as_str(), "a b/c.bin");
    }

    #[test]
    fn indexes_visible_patch_lines_by_side() {
        let lines = patch_lines("@@ -4,3 +8,4 @@\n context\n-old\n+new\n+extra\n context");
        assert_eq!(lines.old, BTreeSet::from([4, 5, 6]));
        assert_eq!(lines.new, BTreeSet::from([8, 9, 10, 11]));
    }

    #[test]
    fn parses_hunk_headers_with_default_counts() {
        assert_eq!(
            HunkHeader::parse("@@ -3 +4,0 @@ fn main"),
            Some(HunkHeader {
                old_start: 3,
                old_count: 1,
                new_start: 4,
                new_count: 0
            })
        );
    }
}
