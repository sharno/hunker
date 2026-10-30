use std::path::Path;

use serde::Serialize;
use tempfile::tempdir;

use crate::{
    analysis::{InlineDiff, WhitespaceMode},
    command,
    diff::HunkHeader,
    error::{AppError, AppResult},
};

/// What Git treats as one word when aligning inline changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Granularity {
    Token,
    Character,
}

impl Granularity {
    pub fn for_inline(inline: InlineDiff) -> Option<Self> {
        match inline {
            InlineDiff::Off => None,
            InlineDiff::Token => Some(Self::Token),
            InlineDiff::Character => Some(Self::Character),
        }
    }

    fn word_regex(self) -> &'static str {
        match self {
            Self::Character => ".",
            Self::Token => "[[:alnum:]_]+|[^[:space:]]",
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CharacterRange {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CharacterDiffRow {
    pub old_line: Option<usize>,
    pub new_line: Option<usize>,
    pub old_ranges: Vec<CharacterRange>,
    pub new_ranges: Vec<CharacterRange>,
}

/// The words seen so far for one aligned old/new line pair.
#[derive(Default)]
struct RowBuilder {
    old_present: bool,
    new_present: bool,
    old_offset: usize,
    new_offset: usize,
    old_ranges: Vec<CharacterRange>,
    new_ranges: Vec<CharacterRange>,
}

struct HunkCursor {
    old_line: usize,
    new_line: usize,
    old_remaining: usize,
    new_remaining: usize,
    row: RowBuilder,
}

impl HunkCursor {
    fn start(header: HunkHeader) -> Self {
        Self {
            old_line: header.old_start,
            new_line: header.new_start,
            old_remaining: header.old_count,
            new_remaining: header.new_count,
            row: RowBuilder::default(),
        }
    }

    /// Ends the current line pair. A line pair with no words still occupies
    /// whichever side has lines remaining in the hunk.
    fn flush(self) -> (Option<CharacterDiffRow>, Self) {
        let Self {
            old_line,
            new_line,
            old_remaining,
            new_remaining,
            row,
        } = self;
        let old_present = row.old_present || (!row.new_present && old_remaining > 0);
        let new_present = row.new_present || (!row.old_present && new_remaining > 0);
        let flushed = (old_present || new_present).then(|| CharacterDiffRow {
            old_line: old_present.then_some(old_line),
            new_line: new_present.then_some(new_line),
            old_ranges: row.old_ranges,
            new_ranges: row.new_ranges,
        });
        (
            flushed,
            Self {
                old_line: old_line + usize::from(old_present),
                new_line: new_line + usize::from(new_present),
                old_remaining: old_remaining.saturating_sub(usize::from(old_present)),
                new_remaining: new_remaining.saturating_sub(usize::from(new_present)),
                row: RowBuilder::default(),
            },
        )
    }

    fn word(mut self, marker: char, value: &str, whitespace: WhitespaceMode) -> Self {
        let length = value.chars().count();
        let highlighted = !value.is_empty()
            && match whitespace {
                WhitespaceMode::Show => true,
                WhitespaceMode::Ignore => !value.trim().is_empty(),
            };
        let row = &mut self.row;
        if matches!(marker, ' ' | '-') {
            row.old_present = true;
            if marker == '-' && highlighted {
                row.old_ranges.push(CharacterRange {
                    start: row.old_offset,
                    end: row.old_offset + length,
                });
            }
            row.old_offset += length;
        }
        if matches!(marker, ' ' | '+') {
            row.new_present = true;
            if marker == '+' && highlighted {
                row.new_ranges.push(CharacterRange {
                    start: row.new_offset,
                    end: row.new_offset + length,
                });
            }
            row.new_offset += length;
        }
        self
    }
}

/// Parses `git diff --word-diff=porcelain` into aligned rows with changed
/// character ranges per side.
pub fn parse(output: &str, whitespace: WhitespaceMode) -> Vec<CharacterDiffRow> {
    fn flush(rows: &mut Vec<CharacterDiffRow>, cursor: Option<HunkCursor>) -> Option<HunkCursor> {
        cursor.map(|cursor| {
            let (row, next) = cursor.flush();
            rows.extend(row);
            next
        })
    }
    let (mut rows, cursor) = output.lines().fold(
        (Vec::new(), None::<HunkCursor>),
        |(mut rows, cursor), line| {
            if let Some(header) = HunkHeader::parse(line) {
                flush(&mut rows, cursor);
                return (rows, Some(HunkCursor::start(header)));
            }
            let next = match (cursor, line.chars().next()) {
                (None, _) => None,
                (Some(cursor), _) if line == "~" => flush(&mut rows, Some(cursor)),
                (Some(cursor), Some(marker @ (' ' | '+' | '-'))) => {
                    Some(cursor.word(marker, &line[marker.len_utf8()..], whitespace))
                }
                (Some(cursor), _) => Some(cursor),
            };
            (rows, next)
        },
    );
    flush(&mut rows, cursor);
    rows
}

pub async fn analyze(
    path: &str,
    old_text: &str,
    new_text: &str,
    whitespace: WhitespaceMode,
    granularity: Granularity,
) -> AppResult<Vec<CharacterDiffRow>> {
    let directory = tempdir().map_err(|error| {
        AppError::internal(format!(
            "Could not create character diff directory: {error}"
        ))
    })?;
    // Keep the extension so Git's diff drivers and word regexes see the
    // same file type as in the repository.
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let old_path = directory.path().join(format!("old.{extension}"));
    let new_path = directory.path().join(format!("new.{extension}"));
    let write_error = |error: std::io::Error| {
        AppError::internal(format!("Could not write character diff input: {error}"))
    };
    tokio::fs::write(&old_path, old_text)
        .await
        .map_err(write_error)?;
    tokio::fs::write(&new_path, new_text)
        .await
        .map_err(write_error)?;
    let word_regex = format!("--word-diff-regex={}", granularity.word_regex());
    let old_arg = old_path.to_string_lossy();
    let new_arg = new_path.to_string_lossy();
    let whitespace_flag = match whitespace {
        WhitespaceMode::Ignore => Some("--ignore-all-space"),
        WhitespaceMode::Show => None,
    };
    let arguments = [
        "diff",
        "--no-index",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--text",
        "--unified=0",
        "--diff-algorithm=histogram",
        "--word-diff=porcelain",
        &word_regex,
    ]
    .into_iter()
    .chain(whitespace_flag)
    .chain(["--", &old_arg, &new_arg])
    .collect::<Vec<_>>();
    let output = command::run("git", &arguments, None).await?;
    // `git diff --no-index` exits 1 when the files differ.
    if !matches!(output.status.code(), Some(0 | 1)) {
        return Err(AppError::upstream(output.message("Git character diff")));
    }
    Ok(parse(&output.stdout, whitespace))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn aligns_native_git_word_changes() {
        let rows = analyze(
            "value.ts",
            "const oldName = 1;\n",
            "const newName = 1;\n",
            WhitespaceMode::Show,
            Granularity::Token,
        )
        .await
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].old_line, Some(1));
        assert_eq!(rows[0].new_line, Some(1));
        assert_eq!(
            rows[0].old_ranges,
            vec![CharacterRange { start: 6, end: 13 }]
        );
    }
}
