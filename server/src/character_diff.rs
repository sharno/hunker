use std::path::Path;

use serde::Serialize;
use tempfile::tempdir;
use tokio::process::Command;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffMode {
    Token,
    Character,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterDiffResult {
    pub path: String,
    pub ignore_whitespace: bool,
    pub mode: &'static str,
    pub rows: Vec<CharacterDiffRow>,
}

#[derive(Default)]
struct Builder {
    old_present: bool,
    new_present: bool,
    old_offset: usize,
    new_offset: usize,
    old_ranges: Vec<CharacterRange>,
    new_ranges: Vec<CharacterRange>,
}

struct Parser {
    rows: Vec<CharacterDiffRow>,
    old_line: usize,
    new_line: usize,
    old_remaining: usize,
    new_remaining: usize,
    in_hunk: bool,
    builder: Builder,
}

impl Parser {
    fn flush(&mut self) {
        if !self.in_hunk {
            return;
        }
        let old_present =
            self.builder.old_present || (!self.builder.new_present && self.old_remaining > 0);
        let new_present =
            self.builder.new_present || (!self.builder.old_present && self.new_remaining > 0);
        if !old_present && !new_present {
            return;
        }
        let builder = std::mem::take(&mut self.builder);
        self.rows.push(CharacterDiffRow {
            old_line: old_present.then_some(self.old_line),
            new_line: new_present.then_some(self.new_line),
            old_ranges: builder.old_ranges,
            new_ranges: builder.new_ranges,
        });
        if old_present {
            self.old_line += 1;
            self.old_remaining = self.old_remaining.saturating_sub(1);
        }
        if new_present {
            self.new_line += 1;
            self.new_remaining = self.new_remaining.saturating_sub(1);
        }
    }
}

pub fn parse(output: &str, ignore_whitespace: bool) -> Vec<CharacterDiffRow> {
    let header = regex::Regex::new(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
        .expect("valid hunk regex");
    let mut parser = Parser {
        rows: Vec::new(),
        old_line: 0,
        new_line: 0,
        old_remaining: 0,
        new_remaining: 0,
        in_hunk: false,
        builder: Builder::default(),
    };
    for line in output.lines() {
        if let Some(captures) = header.captures(line) {
            parser.flush();
            parser.old_line = captures[1].parse().unwrap_or(0);
            parser.new_line = captures[3].parse().unwrap_or(0);
            parser.old_remaining = captures
                .get(2)
                .map_or(1, |value| value.as_str().parse().unwrap_or(1));
            parser.new_remaining = captures
                .get(4)
                .map_or(1, |value| value.as_str().parse().unwrap_or(1));
            parser.in_hunk = true;
            parser.builder = Builder::default();
            continue;
        }
        if !parser.in_hunk {
            continue;
        }
        if line == "~" {
            parser.flush();
            continue;
        }
        let Some(marker) = line.chars().next() else {
            continue;
        };
        if !matches!(marker, ' ' | '+' | '-') {
            continue;
        }
        let value = &line[marker.len_utf8()..];
        let mark = !ignore_whitespace || !value.trim().is_empty();
        if matches!(marker, ' ' | '-') {
            parser.builder.old_present = true;
            if marker == '-' && mark && !value.is_empty() {
                parser.builder.old_ranges.push(CharacterRange {
                    start: parser.builder.old_offset,
                    end: parser.builder.old_offset + value.chars().count(),
                });
            }
            parser.builder.old_offset += value.chars().count();
        }
        if matches!(marker, ' ' | '+') {
            parser.builder.new_present = true;
            if marker == '+' && mark && !value.is_empty() {
                parser.builder.new_ranges.push(CharacterRange {
                    start: parser.builder.new_offset,
                    end: parser.builder.new_offset + value.chars().count(),
                });
            }
            parser.builder.new_offset += value.chars().count();
        }
    }
    parser.flush();
    parser.rows
}

pub async fn analyze(
    path: &str,
    old_text: &str,
    new_text: &str,
    ignore_whitespace: bool,
    mode: DiffMode,
) -> AppResult<CharacterDiffResult> {
    let directory = tempdir().map_err(|error| {
        AppError::internal(format!(
            "Could not create character diff directory: {error}"
        ))
    })?;
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let old_path = directory.path().join(format!("old.{extension}"));
    let new_path = directory.path().join(format!("new.{extension}"));
    tokio::fs::write(&old_path, old_text)
        .await
        .map_err(|error| {
            AppError::internal(format!("Could not write character diff input: {error}"))
        })?;
    tokio::fs::write(&new_path, new_text)
        .await
        .map_err(|error| {
            AppError::internal(format!("Could not write character diff input: {error}"))
        })?;
    let regex = match mode {
        DiffMode::Character => ".",
        DiffMode::Token => "[[:alnum:]_]+|[^[:space:]]",
    };
    let mut command = Command::new("git");
    command.args([
        "diff",
        "--no-index",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--text",
        "--unified=0",
        "--diff-algorithm=histogram",
        "--word-diff=porcelain",
        &format!("--word-diff-regex={regex}"),
    ]);
    if ignore_whitespace {
        command.arg("--ignore-all-space");
    }
    let output = command
        .arg("--")
        .arg(&old_path)
        .arg(&new_path)
        .output()
        .await
        .map_err(|error| {
            AppError::upstream(format!("Could not run Git character diff: {error}"))
        })?;
    if !matches!(output.status.code(), Some(0 | 1)) {
        return Err(AppError::upstream(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    let stdout = String::from_utf8(output.stdout)
        .map_err(|_| AppError::upstream("Git character diff returned invalid UTF-8."))?;
    Ok(CharacterDiffResult {
        path: path.to_owned(),
        ignore_whitespace,
        mode: match mode {
            DiffMode::Token => "token",
            DiffMode::Character => "character",
        },
        rows: parse(&stdout, ignore_whitespace),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn aligns_native_git_word_changes() {
        let result = analyze(
            "value.ts",
            "const oldName = 1;\n",
            "const newName = 1;\n",
            false,
            DiffMode::Token,
        )
        .await
        .unwrap();
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0].old_line, Some(1));
        assert_eq!(result.rows[0].new_line, Some(1));
    }
}
