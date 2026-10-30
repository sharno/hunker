use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::LazyLock,
};

use regex::Regex;
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

/// Changed words on one line, in characters from the line start.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LineWords {
    pub line: usize,
    pub ranges: Vec<CharacterRange>,
}

/// Inline changes per side. A line is listed only when it also keeps some
/// unchanged words: a wholly added or removed line has nothing to contrast
/// its words with, so marking them would only repeat the line's own color.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct WordChanges {
    pub old: Vec<LineWords>,
    pub new: Vec<LineWords>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side {
    Old,
    New,
}

/// One `--word-diff=porcelain` run: words both sides share, or words only
/// one side has.
#[derive(Debug, Clone, Copy)]
enum Run<'a> {
    Common(&'a str),
    Removed(&'a str),
    Added(&'a str),
}

impl<'a> Run<'a> {
    fn parse(line: &'a str) -> Option<Self> {
        match line.split_at_checked(1)? {
            (" ", text) => Some(Self::Common(text)),
            ("-", text) => Some(Self::Removed(text)),
            ("+", text) => Some(Self::Added(text)),
            _ => None,
        }
    }

    fn text(self) -> &'a str {
        match self {
            Self::Common(text) | Self::Removed(text) | Self::Added(text) => text,
        }
    }

    fn sides(self) -> &'static [Side] {
        match self {
            Self::Common(_) => &[Side::Old, Side::New],
            Self::Removed(_) => &[Side::Old],
            Self::Added(_) => &[Side::New],
        }
    }

    /// What one segment of this run says about the line it lands on.
    fn mark(self, segment: &str, whitespace: WhitespaceMode) -> Mark {
        let blank = segment.trim().is_empty();
        match (self, whitespace) {
            (Self::Common(_), _) if blank => Mark::Neither,
            (Self::Common(_), _) => Mark::Kept,
            (Self::Removed(text) | Self::Added(text), WhitespaceMode::Ignore)
                if text.trim().is_empty() =>
            {
                Mark::Neither
            }
            (Self::Removed(_) | Self::Added(_), _) => Mark::Changed,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mark {
    Kept,
    Changed,
    Neither,
}

/// One located run segment, in bytes of its side's text.
struct Piece {
    side: Side,
    start: usize,
    end: usize,
    mark: Mark,
}

/// A side's text with its line starts, to turn byte offsets into lines.
struct SideText<'a> {
    text: &'a str,
    line_starts: Vec<usize>,
}

impl<'a> SideText<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            text,
            line_starts: std::iter::once(0)
                .chain(text.match_indices('\n').map(|(index, _)| index + 1))
                .collect(),
        }
    }

    /// Where a hunk side begins. Git names the line before an insertion
    /// when that side's count is zero.
    fn hunk_start(&self, start: usize, count: usize) -> usize {
        let line = if count == 0 { start + 1 } else { start };
        self.line_starts
            .get(line.saturating_sub(1))
            .copied()
            .unwrap_or(self.text.len())
    }

    /// The 1-based line and character column of a byte offset.
    fn position(&self, byte: usize) -> (usize, usize) {
        let index = self
            .line_starts
            .partition_point(|start| *start <= byte)
            .saturating_sub(1);
        let line_start = self.line_starts.get(index).copied().unwrap_or(0);
        (
            index + 1,
            self.text
                .get(line_start..byte)
                .map_or(0, |prefix| prefix.chars().count()),
        )
    }

    fn characters(&self, piece: &Piece) -> usize {
        self.text
            .get(piece.start..piece.end)
            .map_or(0, |segment| segment.chars().count())
    }
}

static SEGMENTS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s+|\S+").expect("segment expression is valid"));

/// Splits porcelain output into hunks of runs. Git's `~` newline markers
/// are skipped: they describe only the side it printed, so lines are counted
/// in each side's own text instead.
fn hunks(output: &str) -> Vec<(HunkHeader, Vec<Run<'_>>)> {
    output.lines().fold(Vec::new(), |mut hunks, line| {
        match (HunkHeader::parse(line), hunks.last_mut()) {
            (Some(header), _) => hunks.push((header, Vec::new())),
            (None, Some((_, runs))) => runs.extend(Run::parse(line)),
            (None, None) => {}
        }
        hunks
    })
}

/// Finds `segment` at `at`. Git ignores the whitespace between words, so a
/// word may follow any whitespace; whitespace itself matches only exactly.
fn locate(text: &str, at: usize, segment: &str) -> Option<usize> {
    let rest = text.get(at..)?;
    let start = if segment.starts_with(char::is_whitespace) {
        at
    } else {
        at + rest.len() - rest.trim_start().len()
    };
    text.get(start..)?.starts_with(segment).then_some(start)
}

/// Locates every segment of a hunk's runs in both texts, or `None` when the
/// output cannot be aligned with them; that hunk then shows no inline marks.
fn hunk_pieces(
    header: &HunkHeader,
    runs: &[Run<'_>],
    old: &SideText<'_>,
    new: &SideText<'_>,
    whitespace: WhitespaceMode,
) -> Option<Vec<Piece>> {
    let start = (
        old.hunk_start(header.old_start, header.old_count),
        new.hunk_start(header.new_start, header.new_count),
    );
    runs.iter()
        .flat_map(|run| {
            SEGMENTS
                .find_iter(run.text())
                .map(move |segment| (*run, segment.as_str()))
        })
        .try_fold(
            (start, Vec::new()),
            |((old_at, new_at), mut pieces), (run, segment)| {
                let mark = run.mark(segment, whitespace);
                let cursors =
                    run.sides()
                        .iter()
                        .try_fold((old_at, new_at), |(old_at, new_at), side| {
                            let (text, at) = match side {
                                Side::Old => (old.text, old_at),
                                Side::New => (new.text, new_at),
                            };
                            match locate(text, at, segment) {
                                Some(found) => {
                                    let end = found + segment.len();
                                    pieces.push(Piece {
                                        side: *side,
                                        start: found,
                                        end,
                                        mark,
                                    });
                                    Some(match side {
                                        Side::Old => (end, new_at),
                                        Side::New => (old_at, end),
                                    })
                                }
                                // Whitespace that differs between the sides is
                                // not part of Git's comparison.
                                None if segment.trim().is_empty() => Some((old_at, new_at)),
                                None => None,
                            }
                        })?;
                Some((cursors, pieces))
            },
        )
        .map(|(_, pieces)| pieces)
}

fn side_words(pieces: &[Piece], side: Side, text: &SideText<'_>) -> Vec<LineWords> {
    let on_side = || pieces.iter().filter(move |piece| piece.side == side);
    let kept = on_side()
        .filter(|piece| piece.mark == Mark::Kept)
        .map(|piece| text.position(piece.start).0)
        .collect::<BTreeSet<_>>();
    on_side()
        .filter(|piece| piece.mark == Mark::Changed)
        .fold(
            BTreeMap::<usize, Vec<CharacterRange>>::new(),
            |mut lines, piece| {
                let (line, start) = text.position(piece.start);
                let end = start + text.characters(piece);
                let ranges = lines.entry(line).or_default();
                match ranges.last_mut() {
                    Some(last) if last.end == start => last.end = end,
                    _ => ranges.push(CharacterRange { start, end }),
                }
                lines
            },
        )
        .into_iter()
        .filter(|(line, _)| kept.contains(line))
        .map(|(line, ranges)| LineWords { line, ranges })
        .collect()
}

/// Turns `git diff --word-diff=porcelain` output into changed character
/// ranges, each located in its own side's text.
pub fn parse(
    output: &str,
    old_text: &str,
    new_text: &str,
    whitespace: WhitespaceMode,
) -> WordChanges {
    let old = SideText::new(old_text);
    let new = SideText::new(new_text);
    let pieces = hunks(output)
        .iter()
        .flat_map(|(header, runs)| {
            hunk_pieces(header, runs, &old, &new, whitespace).unwrap_or_default()
        })
        .collect::<Vec<_>>();
    WordChanges {
        old: side_words(&pieces, Side::Old, &old),
        new: side_words(&pieces, Side::New, &new),
    }
}

pub async fn analyze(
    path: &str,
    old_text: &str,
    new_text: &str,
    whitespace: WhitespaceMode,
    granularity: Granularity,
) -> AppResult<WordChanges> {
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
    Ok(parse(&output.stdout, old_text, new_text, whitespace))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(line: usize, ranges: &[(usize, usize)]) -> LineWords {
        LineWords {
            line,
            ranges: ranges
                .iter()
                .map(|&(start, end)| CharacterRange { start, end })
                .collect(),
        }
    }

    async fn token_changes(old: &str, new: &str) -> WordChanges {
        analyze(
            "value.ts",
            old,
            new,
            WhitespaceMode::Show,
            Granularity::Token,
        )
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn aligns_native_git_word_changes() {
        let changes = token_changes("const oldName = 1;\n", "const newName = 1;\n").await;
        assert_eq!(changes.old, vec![words(1, &[(6, 13)])]);
        assert_eq!(changes.new, vec![words(1, &[(6, 13)])]);
    }

    #[tokio::test]
    async fn counts_lines_in_each_side_when_git_aligns_words_across_lines() {
        // Git matches the old line's words with two new lines, so its `~`
        // markers cannot be used to count old lines.
        let changes = token_changes(
            "first;\nconst value = 1;\n",
            "first;\nconst added = true;\nconst value = 2;\n",
        )
        .await;
        assert_eq!(changes.old, vec![words(2, &[(14, 15)])]);
        assert_eq!(
            changes.new.iter().map(|line| line.line).collect::<Vec<_>>(),
            vec![2, 3]
        );
    }

    #[tokio::test]
    async fn leaves_wholly_added_lines_unmarked() {
        let changes = token_changes("a();\nb();\n", "a();\nnew_call();\nb();\n").await;
        assert_eq!(changes, WordChanges::default());
    }

    #[test]
    fn gives_up_on_a_hunk_it_cannot_align() {
        let output = "@@ -1 +1 @@\n-missing\n+other\n~\n";
        assert_eq!(
            parse(output, "present\n", "other\n", WhitespaceMode::Show),
            WordChanges::default()
        );
    }
}
