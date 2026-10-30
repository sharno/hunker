//! Rust-generated JSON payloads that Elm decoder tests consume, so the wire
//! format cannot drift between the two languages unnoticed.

use std::{fs, path::PathBuf, sync::Arc};

use serde::Serialize;

use crate::{
    analysis::{AnalysisFeature, AnalysisSnapshot, FileAnalysis},
    api::{
        repository::SourceControlResponse,
        review::{CommentsResponse, CommitsResponse, HeadFreshness, RevisionResponse},
    },
    character_diff::{CharacterDiffRow, CharacterRange},
    error::{AppError, AppResult},
    github::{
        CommentAnchor, CommentSide, PullRequestState, PullRequestStatus, PullsPage,
        RepositoryPullRequest, RepositoryPullsPage, ReviewComment,
    },
    local::{
        Branch, BranchPresence, Checkout, History, RemoteState, RepositoryCommit,
        RepositoryCommits, SourceControlStatus, WorkingTreeChanges,
    },
    semantic::{MoveMatch, MovedBlock, SemanticChange, SemanticResult},
    source_presentation::{FilePresentation, SourcePresentationResult},
    types::{
        BranchName, FileChange, FileStatus, Oid, PullCommit, RelativePath, ReviewDocument,
        ReviewRevision, ReviewSource, SourceRange,
    },
};

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../elm/src/Hunker/Generated/ContractFixtures.elm")
}

pub fn write() -> AppResult<()> {
    let path = fixture_path();
    fs::write(&path, render()?)
        .map_err(|error| AppError::internal(format!("Could not write contract fixtures: {error}")))
}

pub fn check() -> AppResult<()> {
    let path = fixture_path();
    let actual = fs::read_to_string(&path).map_err(|error| {
        AppError::internal(format!(
            "Could not read {}: {error}. Run bun run contracts:write.",
            path.display()
        ))
    })?;
    if actual == render()? {
        Ok(())
    } else {
        Err(AppError::internal(
            "Rust/Elm contract fixtures are stale. Run bun run contracts:write.",
        ))
    }
}

type Fixture = (&'static str, fn() -> AppResult<String>);

const FIXTURES: &[Fixture] = &[
    ("analysisSnapshot", || json(&analysis_snapshot())),
    ("pullCommits", || json(&pull_commits())),
    ("repositoryCommits", || json(&repository_commits())),
    ("repositoryPulls", || json(&repository_pulls())),
    ("reviewComments", || json(&review_comments())),
    ("reviewDocument", || json(&review_document())),
    ("revisionBehind", || json(&revision_behind())),
    ("sourceControl", || json(&source_control())),
];

fn render() -> AppResult<String> {
    let exposing = FIXTURES
        .iter()
        .map(|(name, _)| *name)
        .collect::<Vec<_>>()
        .join(", ");
    let definitions = FIXTURES
        .iter()
        .map(|(name, fixture)| {
            let literal = serde_json::to_string(&fixture()?).map_err(|error| {
                AppError::internal(format!("Could not serialize contract fixture: {error}"))
            })?;
            Ok(format!("{name} : String\n{name} =\n    {literal}\n"))
        })
        .collect::<AppResult<Vec<_>>>()?;
    Ok(format!(
        "module Hunker.Generated.ContractFixtures exposing ({exposing})\n\n\n{}",
        definitions.join("\n\n")
    ))
}

fn json<T: Serialize>(value: &T) -> AppResult<String> {
    serde_json::to_string(value).map_err(|error| {
        AppError::internal(format!("Could not serialize contract fixture: {error}"))
    })
}

fn oid(digit: char) -> Oid {
    Oid::parse(digit.to_string().repeat(40)).expect("fixture OID is valid")
}

fn path(value: &str) -> RelativePath {
    RelativePath::parse(value).expect("fixture path is valid")
}

fn branch(value: &str) -> BranchName {
    BranchName::parse(value).expect("fixture branch is valid")
}

fn range(start_line: usize, end_line: usize) -> SourceRange {
    SourceRange {
        start_line,
        end_line,
        start_column: 1,
        end_column: 2,
    }
}

fn review_document() -> ReviewDocument {
    ReviewDocument {
        title: "Keep Rust and Elm contracts aligned".to_owned(),
        author: "agent".to_owned(),
        base: "main".to_owned(),
        head: "typed-contracts".to_owned(),
        files: Arc::new(vec![
            FileChange {
                path: path("src/main.rs"),
                status: FileStatus::Modified,
                additions: 1,
                deletions: 1,
                patch: "@@ -1 +1 @@\n-old\n+new".to_owned(),
            },
            FileChange {
                path: path("src/new.rs"),
                status: FileStatus::Renamed {
                    previous_path: path("src/old.rs"),
                },
                additions: 0,
                deletions: 0,
                patch: String::new(),
            },
        ]),
        revision: ReviewRevision {
            base_oid: oid('1'),
            head_oid: oid('2'),
            head_ref: "typed-contracts".to_owned(),
        },
        source: ReviewSource::Local {
            path: "/Users/example/src/hunker".to_owned(),
        },
    }
}

fn repository_pulls() -> RepositoryPullsPage {
    RepositoryPullsPage {
        state: PullRequestState::Open,
        page: PullsPage::default(),
        has_more: false,
        pull_requests: vec![
            RepositoryPullRequest {
                number: 42,
                title: "Keep contracts typed".to_owned(),
                author: "agent".to_owned(),
                avatar_url: Some("https://avatars.example/agent".to_owned()),
                status: PullRequestStatus::Draft,
                updated_at: "2026-08-10T12:00:00Z".to_owned(),
                base: "main".to_owned(),
                head: "agent:typed-contracts".to_owned(),
                labels: vec!["rust".to_owned(), "elm".to_owned()],
            },
            RepositoryPullRequest {
                number: 41,
                title: "Merged earlier".to_owned(),
                author: "ghost".to_owned(),
                avatar_url: None,
                status: PullRequestStatus::Merged,
                updated_at: "2026-08-09T12:00:00Z".to_owned(),
                base: "main".to_owned(),
                head: "ghost:older".to_owned(),
                labels: Vec::new(),
            },
        ],
    }
}

fn source_control() -> SourceControlResponse {
    SourceControlResponse {
        status: SourceControlStatus {
            path: "/Users/example/src/hunker".to_owned(),
            checkout: Checkout::TrackingBranch {
                name: branch("main"),
                oid: oid('2'),
                upstream: "origin/main".to_owned(),
                ahead: 1,
                behind: 2,
            },
            branches: vec![
                Branch {
                    name: branch("main"),
                    presence: BranchPresence::Both,
                },
                Branch {
                    name: branch("feature/remote-only"),
                    presence: BranchPresence::Remote,
                },
            ],
            changes: WorkingTreeChanges {
                staged: 1,
                unstaged: 2,
                untracked: 3,
            },
            remote: RemoteState::RemoteUnavailable {
                checked_at: 1_786_363_200_000,
                error: "Could not resolve host".to_owned(),
            },
        },
    }
}

fn review_comments() -> CommentsResponse {
    let comment = |id: &str, anchor: CommentAnchor, resolved: bool| ReviewComment {
        id: serde_json::from_str(id).expect("fixture comment ID is valid"),
        root_id: serde_json::from_str(id).expect("fixture comment ID is valid"),
        path: "src/main.rs".to_owned(),
        body: "Please keep this typed.".to_owned(),
        author: "reviewer".to_owned(),
        html_url: format!("https://github.com/acme/hunker/pull/42#discussion_r{id}"),
        created_at: "2026-08-10T12:00:00Z".to_owned(),
        anchor,
        resolved,
    };
    CommentsResponse {
        comments: vec![
            comment(
                "7",
                CommentAnchor::Current {
                    line: 12,
                    side: CommentSide::Right,
                },
                true,
            ),
            comment(
                "8",
                CommentAnchor::Outdated {
                    original_line: 3,
                    original_side: CommentSide::Left,
                },
                false,
            ),
            comment("9", CommentAnchor::File, false),
        ],
    }
}

fn revision_behind() -> RevisionResponse {
    RevisionResponse::Local {
        path: "/Users/example/src/hunker".to_owned(),
        checked_at: 1_786_363_200_000,
        head: HeadFreshness::Behind {
            latest_head_oid: oid('3'),
        },
    }
}

fn pull_commits() -> CommitsResponse {
    CommitsResponse {
        commits: vec![PullCommit {
            sha: oid('4'),
            message: "Type the boundary".to_owned(),
            author: "agent".to_owned(),
            avatar_url: None,
            authored_at: Some("2026-08-10T12:00:00Z".to_owned()),
            html_url:
                "https://github.com/acme/hunker/commit/4444444444444444444444444444444444444444"
                    .to_owned(),
        }],
    }
}

fn repository_commits() -> RepositoryCommits {
    RepositoryCommits {
        reference: oid('2'),
        history: History::Shallow,
        commits: vec![RepositoryCommit {
            sha: oid('2'),
            parents: vec![oid('1')],
            author_name: "Ada".to_owned(),
            author_email: "ada@example.com".to_owned(),
            authored_at: "2026-08-10T12:00:00Z".to_owned(),
            subject: "Keep history typed".to_owned(),
        }],
    }
}

fn analysis_snapshot() -> AnalysisSnapshot {
    AnalysisSnapshot {
        files: vec![FileAnalysis {
            path: path("src/main.rs"),
            semantic: AnalysisFeature::Complete {
                value: SemanticResult::Parsed {
                    language: "Rust".to_owned(),
                    semantic_equal: false,
                    changes: vec![SemanticChange::Renamed {
                        kind: "function_item".to_owned(),
                        old_label: "before".to_owned(),
                        new_label: "after".to_owned(),
                        old_range: range(1, 3),
                        new_range: range(1, 3),
                    }],
                },
            },
            syntax: AnalysisFeature::Complete {
                value: FilePresentation {
                    old: SourcePresentationResult::Unsupported {
                        reason: "Syntax highlighting is unavailable for this language.".to_owned(),
                    },
                    new: SourcePresentationResult::Unsupported {
                        reason: "Syntax highlighting is unavailable for this language.".to_owned(),
                    },
                },
            },
            word_diff: AnalysisFeature::Complete {
                value: vec![CharacterDiffRow {
                    old_line: Some(1),
                    new_line: Some(1),
                    old_ranges: vec![CharacterRange { start: 0, end: 3 }],
                    new_ranges: vec![CharacterRange { start: 0, end: 3 }],
                }],
            },
        }],
        moves: vec![MovedBlock {
            from_path: path("src/a.rs"),
            to_path: path("src/b.rs"),
            from_line: 1,
            to_line: 4,
            from_line_count: 3,
            to_line_count: 3,
            preview: "fn moved() {".to_owned(),
            kind: "function_item".to_owned(),
            label: "moved".to_owned(),
            matched: MoveMatch::Exact,
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_an_elm_module_from_rust_domain_values() {
        let source = render().unwrap();
        assert!(
            source.starts_with(
                "module Hunker.Generated.ContractFixtures exposing (analysisSnapshot, "
            )
        );
        assert!(source.contains("reviewDocument : String"));
        assert!(source.contains("\\\"status\\\":\\\"renamed\\\""));
        assert!(source.ends_with("\"\n"));
    }
}
