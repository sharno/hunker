use std::path::Path;

use fff_search::{
    FFFMode, FilePicker, FilePickerOptions, FuzzySearchOptions, PaginationArgs, QueryParser,
    SharedFilePicker, SharedFrecency,
};
use regex::Regex;
use serde::Deserialize;
use walkdir::WalkDir;

use crate::{
    command,
    error::{AppError, AppResult},
    types::RepositorySlug,
};

use super::{Local, RepositoryFile, RepositorySearchMatch, SearchResults};

impl Local {
    pub async fn search(
        &self,
        repository: &RepositorySlug,
        query: &str,
        mode: &str,
    ) -> AppResult<SearchResults> {
        let root = self.repository_path(repository).await?;
        if query.trim().is_empty() {
            return Err(AppError::bad_request("Enter a search query."));
        }
        if mode == "fuzzy" {
            let picker = self.fuzzy_index(&root).await?;
            return fuzzy_search(&root, query, picker).await;
        }
        text_search(&root, query, mode).await
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

pub(super) async fn text_search(root: &Path, query: &str, mode: &str) -> AppResult<SearchResults> {
    let expression = if mode == "regex" {
        Regex::new(query).map_err(|error| AppError::bad_request(error.to_string()))?
    } else {
        Regex::new(&regex::escape(query))
            .map_err(|error| AppError::bad_request(error.to_string()))?
    };
    let all_files = command::checked(
        "rg",
        &["--files", "--hidden", "--glob", "!.git"],
        Some(root),
    )
    .await?;
    let mut files = Vec::new();
    for path in all_files
        .lines()
        .filter(|path| expression.is_match(path))
        .take(24)
    {
        let size = tokio::fs::metadata(root.join(path))
            .await
            .map_or(0, |metadata| metadata.len());
        files.push(RepositoryFile {
            path: path.to_owned(),
            size,
            git_status: "clean".to_owned(),
        });
    }
    let mut arguments = vec![
        "--json",
        "--line-number",
        "--column",
        "--max-count",
        "4",
        "--max-filesize",
        "2M",
        "--hidden",
        "--glob",
        "!.git",
        "--smart-case",
    ];
    if mode == "literal" {
        arguments.push("--fixed-strings");
    }
    arguments.extend(["--", query, "."]);
    let result = command::output("rg", &arguments, Some(root)).await?;
    if !result.status.success() && result.status.code() != Some(1) {
        return Err(if mode == "regex" {
            AppError::bad_request(String::from_utf8_lossy(&result.stderr).trim().to_owned())
        } else {
            AppError::upstream("ripgrep could not search this repository.")
        });
    }
    let raw = String::from_utf8_lossy(&result.stdout);
    let mut matches = Vec::new();
    for line in raw.lines().take(100) {
        let Ok(record) = serde_json::from_str::<RipgrepRecord>(line) else {
            continue;
        };
        if record.kind != "match" {
            continue;
        }
        let path = record
            .data
            .path
            .text
            .strip_prefix("./")
            .unwrap_or(&record.data.path.text)
            .to_owned();
        let line_content = record
            .data
            .lines
            .text
            .trim_end_matches(['\r', '\n'])
            .to_owned();
        let source = tokio::fs::read_to_string(root.join(&path))
            .await
            .unwrap_or_default();
        let source_lines = source.lines().map(str::to_owned).collect::<Vec<_>>();
        let index = record.data.line_number.saturating_sub(1);
        let ranges = record
            .data
            .submatches
            .into_iter()
            .map(|part| {
                [
                    byte_to_character(&line_content, part.start),
                    byte_to_character(&line_content, part.end),
                ]
            })
            .collect::<Vec<_>>();
        matches.push(RepositorySearchMatch {
            path,
            line: record.data.line_number,
            column: ranges.first().map_or(1, |range| range[0] + 1),
            line_content,
            context_before: source_lines[index.saturating_sub(2)..index.min(source_lines.len())]
                .to_vec(),
            context_after: source_lines
                .get(index + 1..(index + 3).min(source_lines.len()))
                .unwrap_or(&[])
                .to_vec(),
            ranges,
            definition: false,
        });
    }
    Ok(SearchResults { files, matches })
}

pub(super) async fn fuzzy_search(
    root: &Path,
    query: &str,
    picker: SharedFilePicker,
) -> AppResult<SearchResults> {
    let query_lower = query.to_lowercase();
    let picker_query = query.to_owned();
    let ranked = tokio::task::spawn_blocking(move || -> AppResult<Vec<String>> {
        use std::time::Duration;
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
                    limit: 24,
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
    let mut matches = Vec::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| entry.file_name() != ".git")
        .flatten()
        .filter(|entry| entry.file_type().is_file())
        .take(20_000)
    {
        let Ok(relative) = entry.path().strip_prefix(root) else {
            continue;
        };
        let path = relative.to_string_lossy().into_owned();
        if matches.len() < 36 {
            let content = tokio::fs::read_to_string(entry.path())
                .await
                .unwrap_or_default();
            let source_lines = content.lines().map(str::to_owned).collect::<Vec<_>>();
            for (index, line) in source_lines
                .iter()
                .enumerate()
                .filter(|(_, line)| line.to_lowercase().contains(&query_lower))
                .take(4)
            {
                let start = line.to_lowercase().find(&query_lower).unwrap_or(0);
                matches.push(RepositorySearchMatch {
                    path: path.clone(),
                    line: index + 1,
                    column: start + 1,
                    line_content: line.clone(),
                    context_before: source_lines[index.saturating_sub(2)..index].to_vec(),
                    context_after: source_lines
                        .get(index + 1..(index + 3).min(source_lines.len()))
                        .unwrap_or(&[])
                        .to_vec(),
                    ranges: vec![[start, start + query.chars().count()]],
                    definition: false,
                });
            }
        }
    }
    Ok(SearchResults {
        files: ranked
            .into_iter()
            .map(|path| RepositoryFile {
                size: std::fs::metadata(root.join(&path)).map_or(0, |metadata| metadata.len()),
                path,
                git_status: "clean".to_owned(),
            })
            .collect(),
        matches,
    })
}

fn byte_to_character(value: &str, byte: usize) -> usize {
    value.get(..byte).unwrap_or(value).chars().count()
}

#[derive(Deserialize)]
struct RipgrepText {
    text: String,
}

#[derive(Deserialize)]
struct RipgrepSubmatch {
    start: usize,
    end: usize,
}

#[derive(Deserialize)]
struct RipgrepData {
    path: RipgrepText,
    lines: RipgrepText,
    line_number: usize,
    submatches: Vec<RipgrepSubmatch>,
}

#[derive(Deserialize)]
struct RipgrepRecord {
    #[serde(rename = "type")]
    kind: String,
    data: RipgrepData,
}
