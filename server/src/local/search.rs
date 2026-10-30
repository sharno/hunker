use std::{collections::BTreeMap, path::Path, time::Duration};

use fff_search::{
    FFFMode, FilePicker, FilePickerOptions, FuzzySearchOptions, PaginationArgs, QueryParser,
    SharedFilePicker, SharedFrecency,
};
use futures::{StreamExt, stream};
use regex::RegexBuilder;
use serde::Deserialize;

use crate::{
    command::{self, Git},
    error::{AppError, AppResult},
    types::{Oid, RepositorySlug, SearchMode},
};

use super::{Local, RepositoryFile, RepositorySearchMatch, SearchResults};

const MAX_FILE_RESULTS: usize = 24;
const MAX_CONTENT_RESULTS: usize = 100;
const CONTEXT_LINES: usize = 2;

impl Local {
    pub async fn search(
        &self,
        repository: &RepositorySlug,
        oid: &Oid,
        query: &str,
        mode: SearchMode,
    ) -> AppResult<SearchResults> {
        let root = self.repository_path(repository).await?;
        if Git::at(&root).head().await? != *oid {
            return Err(AppError::conflict(
                "The repository changed while this search was loading. Refresh and try again.",
            ));
        }
        if query.trim().is_empty() {
            return Err(AppError::bad_request("Enter a search query."));
        }
        let files = async {
            match mode {
                SearchMode::Fuzzy => {
                    fuzzy_files(&root, query, self.fuzzy_index(&root).await?).await
                }
                SearchMode::Literal | SearchMode::Regex => matching_files(&root, query, mode).await,
            }
        };
        let (files, matches) = tokio::try_join!(files, content_matches(&root, query, mode))?;
        Ok(SearchResults { files, matches })
    }

    async fn fuzzy_index(&self, root: &Path) -> AppResult<SharedFilePicker> {
        let mut indexes = self.fuzzy_indexes.lock().await;
        if let Some(picker) = indexes.get(root) {
            return Ok(picker.clone());
        }
        let picker = SharedFilePicker::default();
        FilePicker::new_with_shared_state(
            picker.clone(),
            SharedFrecency::default(),
            FilePickerOptions {
                base_path: root.to_string_lossy().into_owned(),
                mode: FFFMode::Ai,
                watch: true,
                ..FilePickerOptions::default()
            },
        )
        .map_err(|error| {
            AppError::internal(format!("FFF could not index the repository: {error}"))
        })?;
        indexes.insert(root.to_path_buf(), picker.clone());
        Ok(picker)
    }
}

/// File paths whose name matches the query, using ripgrep's smart-case rule.
async fn matching_files(
    root: &Path,
    query: &str,
    mode: SearchMode,
) -> AppResult<Vec<RepositoryFile>> {
    let pattern = match mode {
        SearchMode::Regex => query.to_owned(),
        SearchMode::Literal | SearchMode::Fuzzy => regex::escape(query),
    };
    let expression = RegexBuilder::new(&pattern)
        .case_insensitive(!query.chars().any(char::is_uppercase))
        .build()
        .map_err(|error| AppError::bad_request(error.to_string()))?;
    let all_files = command::checked(
        "rg",
        &["--files", "--hidden", "--glob", "!.git"],
        Some(root),
    )
    .await?;
    let paths = all_files
        .lines()
        .filter(|path| expression.is_match(path))
        .take(MAX_FILE_RESULTS)
        .map(str::to_owned)
        .collect();
    Ok(sized_files(root, paths).await)
}

async fn fuzzy_files(
    root: &Path,
    query: &str,
    picker: SharedFilePicker,
) -> AppResult<Vec<RepositoryFile>> {
    let picker_query = query.to_owned();
    let ranked = tokio::task::spawn_blocking(move || -> AppResult<Vec<String>> {
        if !picker.wait_for_scan(Duration::from_secs(15)) {
            return Err(AppError::internal(
                "FFF did not finish indexing the repository.",
            ));
        }
        let guard = picker
            .read()
            .map_err(|error| AppError::internal(format!("FFF index unavailable: {error}")))?;
        let picker = guard
            .as_ref()
            .ok_or_else(|| AppError::internal("FFF index unavailable."))?;
        let parsed = QueryParser::default().parse(&picker_query);
        let result = picker.fuzzy_search(
            &parsed,
            None,
            FuzzySearchOptions {
                pagination: PaginationArgs {
                    offset: 0,
                    limit: MAX_FILE_RESULTS,
                },
                ..FuzzySearchOptions::default()
            },
        );
        Ok(result
            .items
            .into_iter()
            .map(|item| item.relative_path(picker))
            .collect())
    })
    .await
    .map_err(|error| AppError::internal(format!("FFF search task failed: {error}")))??;
    Ok(sized_files(root, ranked).await)
}

/// Pairs each path with its size; a path deleted since it was listed is
/// dropped rather than reported with a made-up size.
async fn sized_files(root: &Path, paths: Vec<String>) -> Vec<RepositoryFile> {
    stream::iter(paths)
        .then(|path| async move {
            let metadata = tokio::fs::metadata(root.join(&path)).await.ok()?;
            Some(RepositoryFile {
                path,
                size: metadata.len(),
            })
        })
        .filter_map(futures::future::ready)
        .collect()
        .await
}

async fn content_matches(
    root: &Path,
    query: &str,
    mode: SearchMode,
) -> AppResult<Vec<RepositorySearchMatch>> {
    let mode_flags: &[&str] = match mode {
        SearchMode::Literal => &["--fixed-strings", "--smart-case"],
        SearchMode::Regex => &["--smart-case"],
        SearchMode::Fuzzy => &["--fixed-strings", "--ignore-case"],
    };
    let context = CONTEXT_LINES.to_string();
    let arguments = [
        "--json",
        "--line-number",
        "--max-count",
        "4",
        "--context",
        &context,
        "--max-filesize",
        "2M",
        "--hidden",
        "--glob",
        "!.git",
    ]
    .into_iter()
    .chain(mode_flags.iter().copied())
    .chain(["--", query, "."])
    .collect::<Vec<_>>();
    let result = command::run("rg", &arguments, Some(root)).await?;
    match (result.status.code(), mode) {
        (Some(0 | 1), _) => {}
        (_, SearchMode::Regex) => return Err(AppError::bad_request(result.message("ripgrep"))),
        (_, SearchMode::Literal | SearchMode::Fuzzy) => {
            return Err(AppError::upstream(
                "ripgrep could not search this repository.",
            ));
        }
    }
    let records = result
        .stdout
        .lines()
        .map(|line| {
            serde_json::from_str::<RipgrepRecord>(line).map_err(|error| {
                AppError::upstream(format!("ripgrep returned malformed output: {error}"))
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    Ok(search_hits(records))
}

/// Rebuilds each match with its surrounding lines from ripgrep's own context
/// records, so results describe exactly what ripgrep read.
fn search_hits(records: Vec<RipgrepRecord>) -> Vec<RepositorySearchMatch> {
    let (lines, hits) = records.into_iter().fold(
        (BTreeMap::<(String, usize), String>::new(), Vec::new()),
        |(mut lines, mut hits), record| {
            match record {
                RipgrepRecord::Match { data } => {
                    if let Some(text) = data.lines.text.as_deref() {
                        let path = normalize(&data.path);
                        lines.insert(
                            (path.clone(), data.line_number),
                            trim_newline(text).to_owned(),
                        );
                        hits.push((path, data.line_number, data.submatches));
                    }
                }
                RipgrepRecord::Context { data } => {
                    if let Some(text) = data.lines.text.as_deref() {
                        lines.insert(
                            (normalize(&data.path), data.line_number),
                            trim_newline(text).to_owned(),
                        );
                    }
                }
                RipgrepRecord::Other => {}
            }
            (lines, hits)
        },
    );
    let line_at = |path: &str, number: usize| lines.get(&(path.to_owned(), number)).cloned();
    hits.into_iter()
        .take(MAX_CONTENT_RESULTS)
        .filter_map(|(path, line, submatches)| {
            let line_content = line_at(&path, line)?;
            let ranges = submatches
                .iter()
                .map(|part| {
                    [
                        byte_to_character(&line_content, part.start),
                        byte_to_character(&line_content, part.end),
                    ]
                })
                .collect::<Vec<_>>();
            Some(RepositorySearchMatch {
                column: ranges.first().map_or(1, |range| range[0] + 1),
                context_before: (line.saturating_sub(CONTEXT_LINES).max(1)..line)
                    .filter_map(|number| line_at(&path, number))
                    .collect(),
                context_after: (line + 1..=line + CONTEXT_LINES)
                    .filter_map(|number| line_at(&path, number))
                    .collect(),
                path,
                line,
                line_content,
                ranges,
            })
        })
        .collect()
}

fn normalize(path: &RipgrepText) -> String {
    let text = path.text.as_deref().unwrap_or_default();
    text.strip_prefix("./").unwrap_or(text).to_owned()
}

fn trim_newline(text: &str) -> &str {
    text.trim_end_matches(['\r', '\n'])
}

fn byte_to_character(value: &str, byte: usize) -> usize {
    value.get(..byte).unwrap_or(value).chars().count()
}

#[derive(Deserialize)]
struct RipgrepText {
    /// Absent when ripgrep reports non-UTF-8 content as base64 `bytes`.
    text: Option<String>,
}

#[derive(Deserialize)]
struct RipgrepSubmatch {
    start: usize,
    end: usize,
}

#[derive(Deserialize)]
struct RipgrepLine {
    path: RipgrepText,
    lines: RipgrepText,
    line_number: usize,
    #[serde(default)]
    submatches: Vec<RipgrepSubmatch>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum RipgrepRecord {
    Match {
        data: RipgrepLine,
    },
    Context {
        data: RipgrepLine,
    },
    #[serde(other)]
    Other,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rebuilds_matches_with_ripgrep_context_and_character_offsets() {
        let output = [
            r#"{"type":"begin","data":{"path":{"text":"./src/a.rs"}}}"#,
            r#"{"type":"context","data":{"path":{"text":"./src/a.rs"},"lines":{"text":"fn main() {\n"},"line_number":1,"absolute_offset":0,"submatches":[]}}"#,
            r#"{"type":"match","data":{"path":{"text":"./src/a.rs"},"lines":{"text":"    let café = needle;\n"},"line_number":2,"absolute_offset":12,"submatches":[{"match":{"text":"needle"},"start":16,"end":22}]}}"#,
            r#"{"type":"end","data":{"path":{"text":"./src/a.rs"}}}"#,
        ];
        let records = output
            .iter()
            .map(|line| serde_json::from_str::<RipgrepRecord>(line).unwrap())
            .collect();
        let hits = search_hits(records);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "src/a.rs");
        assert_eq!(hits[0].context_before, vec!["fn main() {".to_owned()]);
        assert_eq!(hits[0].context_after, Vec::<String>::new());
        assert_eq!(hits[0].ranges, vec![[15, 21]]);
    }
}
