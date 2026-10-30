use std::{
    collections::{BTreeMap, HashMap},
    path::Path,
    time::Duration,
};

use fff_search::{
    FFFMode, FilePicker, FilePickerOptions, FuzzySearchOptions, PaginationArgs, QueryParser,
    SharedFilePicker, SharedFrecency,
};
use regex::{Regex, RegexBuilder};

use crate::{
    command::Git,
    error::{AppError, AppResult},
    types::{Oid, RepositorySlug, SearchMode},
};

use super::{Local, RepositoryFile, RepositorySearchMatch, SearchResults, catalog::tree_files};

const MAX_FILE_RESULTS: usize = 24;
const MAX_CONTENT_RESULTS: usize = 100;
const MATCHES_PER_FILE: &str = "--max-count=4";
const CONTEXT_LINES: usize = 2;

impl Local {
    /// Searches the immutable tree at `oid`, never the working copy, so
    /// uncommitted and untracked files cannot appear in the results.
    pub async fn search(
        &self,
        repository: &RepositorySlug,
        oid: &Oid,
        query: &str,
        mode: SearchMode,
    ) -> AppResult<SearchResults> {
        if query.trim().is_empty() {
            return Err(AppError::bad_request("Enter a search query."));
        }
        let root = self.repository_path(repository).await?;
        let matcher = Matcher::new(query, mode)?;
        let tree = tree_files(&root, oid).await?;
        let files = async {
            match mode {
                SearchMode::Fuzzy => fuzzy_files(query, self.fuzzy_index(&root).await?, tree).await,
                SearchMode::Literal | SearchMode::Regex => Ok(tree
                    .into_iter()
                    .filter(|file| matcher.expression.is_match(&file.path))
                    .take(MAX_FILE_RESULTS)
                    .collect()),
            }
        };
        let (files, content) = tokio::try_join!(files, content_matches(&root, oid, &matcher))?;
        Ok(SearchResults {
            files,
            matches: content,
        })
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

/// One query, interpreted the same way for file names, `git grep`, and
/// highlight ranges. Literal and regex searches are smart-case.
struct Matcher {
    expression: Regex,
    grep_flags: &'static [&'static str],
    mode: SearchMode,
}

impl Matcher {
    fn new(query: &str, mode: SearchMode) -> AppResult<Self> {
        let smart_case_insensitive = !query.chars().any(char::is_uppercase);
        let (pattern, ignore_case, grep_flags): (String, bool, &'static [&'static str]) =
            match (mode, smart_case_insensitive) {
                (SearchMode::Literal, true) | (SearchMode::Fuzzy, _) => {
                    (regex::escape(query), true, &["-F", "-i"])
                }
                (SearchMode::Literal, false) => (regex::escape(query), false, &["-F"]),
                // PCRE is the Git regex dialect closest to Rust's syntax.
                (SearchMode::Regex, true) => (query.to_owned(), true, &["-P", "-i"]),
                (SearchMode::Regex, false) => (query.to_owned(), false, &["-P"]),
            };
        let expression = RegexBuilder::new(&pattern)
            .case_insensitive(ignore_case)
            .build()
            .map_err(|error| AppError::bad_request(error.to_string()))?;
        Ok(Self {
            expression,
            grep_flags,
            mode,
        })
    }

    /// Character ranges of every match in `line`.
    fn ranges(&self, line: &str) -> Vec<[usize; 2]> {
        self.expression
            .find_iter(line)
            .map(|found| {
                [
                    byte_to_character(line, found.start()),
                    byte_to_character(line, found.end()),
                ]
            })
            .collect()
    }
}

/// FFF ranks names from the working copy because its index cannot be scoped
/// to a Git object. Results are restricted to paths in the tree at the
/// requested OID, and sizes come from that tree.
async fn fuzzy_files(
    query: &str,
    picker: SharedFilePicker,
    tree: Vec<RepositoryFile>,
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
        // Rank extra candidates: some may be untracked at the requested OID.
        let result = picker.fuzzy_search(
            &parsed,
            None,
            FuzzySearchOptions {
                pagination: PaginationArgs {
                    offset: 0,
                    limit: MAX_FILE_RESULTS * 4,
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
    let sizes = tree
        .into_iter()
        .map(|file| (file.path, file.size))
        .collect::<HashMap<_, _>>();
    Ok(ranked
        .into_iter()
        .filter_map(|path| {
            let size = *sizes.get(&path)?;
            Some(RepositoryFile { path, size })
        })
        .take(MAX_FILE_RESULTS)
        .collect())
}

async fn content_matches(
    root: &Path,
    oid: &Oid,
    matcher: &Matcher,
) -> AppResult<Vec<RepositorySearchMatch>> {
    let context = format!("--context={CONTEXT_LINES}");
    let arguments = [
        "grep",
        "-z",
        "--line-number",
        "--column",
        "-I",
        "--no-color",
        MATCHES_PER_FILE,
        &context,
    ]
    .into_iter()
    .chain(matcher.grep_flags.iter().copied())
    .chain(["-e", matcher.expression.as_str(), oid.as_str(), "--"])
    .collect::<Vec<_>>();
    let result = Git::at(root).run(&arguments).await?;
    // `git grep` exits 1 when nothing matches.
    match (result.status.code(), matcher.mode) {
        (Some(0 | 1), _) => {}
        (_, SearchMode::Regex) => return Err(AppError::bad_request(result.message("git grep"))),
        (_, SearchMode::Literal | SearchMode::Fuzzy) => {
            return Err(AppError::upstream(result.message("git grep")));
        }
    }
    let prefix = format!("{oid}:");
    let lines = result
        .stdout
        .lines()
        // Git separates non-adjacent context groups with `--`.
        .filter(|line| *line != "--")
        .map(|line| {
            line.strip_prefix(&prefix)
                .ok_or_else(|| {
                    AppError::upstream("git grep returned a line from another revision.")
                })
                .and_then(GrepLine::parse)
        })
        .collect::<AppResult<Vec<_>>>()?;
    Ok(search_hits(&lines, matcher))
}

/// One `git grep -z` output line: `path\0line\0column\0text` for a match and
/// `path\0line\0text` for context. Text never contains NUL because binary
/// files are skipped.
enum GrepLine<'a> {
    Match {
        path: &'a str,
        number: usize,
        text: &'a str,
    },
    Context {
        path: &'a str,
        number: usize,
        text: &'a str,
    },
}

impl<'a> GrepLine<'a> {
    fn parse(line: &'a str) -> AppResult<Self> {
        let number = |value: &str| {
            value
                .parse::<usize>()
                .map_err(|_| AppError::upstream("git grep returned an invalid line number."))
        };
        match line.split('\0').collect::<Vec<_>>()[..] {
            [path, line_number, _column, text] => Ok(Self::Match {
                path,
                number: number(line_number)?,
                text,
            }),
            [path, line_number, text] => Ok(Self::Context {
                path,
                number: number(line_number)?,
                text,
            }),
            _ => Err(AppError::upstream("git grep returned a malformed line.")),
        }
    }

    fn location(&self) -> ((&'a str, usize), &'a str) {
        match self {
            Self::Match { path, number, text } | Self::Context { path, number, text } => {
                ((path, *number), text)
            }
        }
    }
}

/// Rebuilds each match with its surrounding lines from Git's own context
/// output, so results describe exactly the searched revision.
fn search_hits(lines: &[GrepLine<'_>], matcher: &Matcher) -> Vec<RepositorySearchMatch> {
    let text_at = lines
        .iter()
        .map(GrepLine::location)
        .collect::<BTreeMap<_, _>>();
    let around = |path: &str, numbers: std::ops::Range<usize>| {
        numbers
            .filter_map(|number| text_at.get(&(path, number)).map(|text| (*text).to_owned()))
            .collect::<Vec<_>>()
    };
    lines
        .iter()
        .filter_map(|line| match line {
            GrepLine::Match { path, number, text } => Some((*path, *number, *text)),
            GrepLine::Context { .. } => None,
        })
        .take(MAX_CONTENT_RESULTS)
        .map(|(path, number, text)| {
            let ranges = matcher.ranges(text);
            RepositorySearchMatch {
                path: path.to_owned(),
                line: number,
                column: ranges.first().map_or(1, |range| range[0] + 1),
                line_content: text.to_owned(),
                context_before: around(path, number.saturating_sub(CONTEXT_LINES).max(1)..number),
                context_after: around(path, number + 1..number + 1 + CONTEXT_LINES),
                ranges,
            }
        })
        .collect()
}

fn byte_to_character(value: &str, byte: usize) -> usize {
    value.get(..byte).unwrap_or(value).chars().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rebuilds_matches_with_git_context_and_character_offsets() {
        let matcher = Matcher::new("needle", SearchMode::Literal).unwrap();
        let output = [
            "src/a.rs\u{0}1\u{0}fn main() {",
            "src/a.rs\u{0}2\u{0}11\u{0}    let café = needle;",
            "src/a.rs\u{0}3\u{0}}",
        ];
        let lines = output
            .iter()
            .map(|line| GrepLine::parse(line).unwrap())
            .collect::<Vec<_>>();
        let hits = search_hits(&lines, &matcher);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "src/a.rs");
        assert_eq!(hits[0].context_before, vec!["fn main() {".to_owned()]);
        assert_eq!(hits[0].context_after, vec!["}".to_owned()]);
        assert_eq!(hits[0].ranges, vec![[15, 21]]);
        assert!(GrepLine::parse("no separators").is_err());
    }

    #[test]
    fn applies_smart_case_to_literal_and_regex_queries() {
        assert!(
            Matcher::new("readme", SearchMode::Literal)
                .unwrap()
                .expression
                .is_match("README.md")
        );
        assert!(
            !Matcher::new("Readme", SearchMode::Literal)
                .unwrap()
                .expression
                .is_match("README.md")
        );
        assert!(Matcher::new("(unclosed", SearchMode::Regex).is_err());
    }

    #[tokio::test]
    async fn searches_the_committed_tree_not_the_working_copy() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let git = Git::at(root);
        for args in [
            &["init", "-q"][..],
            &["config", "user.email", "test@example.com"],
            &["config", "user.name", "Test"],
        ] {
            git.ok(args).await.unwrap();
        }
        tokio::fs::write(root.join("tracked.txt"), "committed needle\n")
            .await
            .unwrap();
        git.ok(&["add", "tracked.txt"]).await.unwrap();
        git.ok(&["commit", "-q", "-m", "seed"]).await.unwrap();
        tokio::fs::write(root.join("tracked.txt"), "edited needle\n")
            .await
            .unwrap();
        tokio::fs::write(root.join("untracked.txt"), "untracked needle\n")
            .await
            .unwrap();
        let oid = git.head().await.unwrap();
        let matcher = Matcher::new("needle", SearchMode::Literal).unwrap();
        let hits = content_matches(root, &oid, &matcher).await.unwrap();
        assert_eq!(
            hits.iter()
                .map(|hit| (hit.path.as_str(), hit.line_content.as_str()))
                .collect::<Vec<_>>(),
            vec![("tracked.txt", "committed needle")]
        );
    }
}
