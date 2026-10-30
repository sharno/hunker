use percent_encoding::{NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
use serde::Deserialize;
use std::fmt;
use url::Url;

use crate::{
    error::{AppError, AppResult},
    types::{CommitId, RepositorySlug},
};

mod repository;
mod review_source;
pub mod reviews;
mod transport;

pub use repository::{
    PullRequestState, PullRequestStatus, PullsPage, RepositoryPullRequest, RepositoryPullsPage,
};
pub(crate) use reviews::{CommentAnchor, CommentSide};
pub use reviews::{InlineComment, ReviewComment, ReviewSubmission};
pub use transport::GitHub;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PullNumber(u32);

impl PullNumber {
    fn parse(value: &str) -> AppResult<Self> {
        value
            .parse::<u32>()
            .ok()
            .filter(|number| *number > 0)
            .map(Self)
            .ok_or_else(|| AppError::bad_request("Choose a valid GitHub pull request number."))
    }

    pub fn as_u32(self) -> u32 {
        self.0
    }
}

impl fmt::Display for PullNumber {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// A GitHub `base...head` comparison.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompareRange {
    pub base: String,
    pub head: String,
}

impl fmt::Display for CompareRange {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}...{}", self.base, self.head)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitHubChange {
    Pull(PullNumber),
    Compare(CompareRange),
    Commit(CommitId),
}

/// A pasted GitHub location, decoded once at the HTTP boundary.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(try_from = "String")]
pub struct GitHubTarget {
    pub repository: RepositorySlug,
    pub change: GitHubChange,
}

/// A pull request location. Review collaboration endpoints accept only this
/// type, so compare and commit URLs are rejected while decoding the request.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(try_from = "String")]
pub struct PullTarget {
    pub repository: RepositorySlug,
    pub number: PullNumber,
}

impl GitHubTarget {
    pub fn pull(&self) -> Option<PullTarget> {
        match &self.change {
            GitHubChange::Pull(number) => Some(PullTarget {
                repository: self.repository.clone(),
                number: *number,
            }),
            GitHubChange::Compare(_) | GitHubChange::Commit(_) => None,
        }
    }

    pub(super) fn api_url(&self) -> String {
        let repository = &self.repository;
        match &self.change {
            GitHubChange::Pull(number) => {
                format!("https://api.github.com/repos/{repository}/pulls/{number}")
            }
            GitHubChange::Compare(range) => format!(
                "https://api.github.com/repos/{repository}/compare/{}",
                encode(&range.to_string())
            ),
            GitHubChange::Commit(sha) => {
                format!("https://api.github.com/repos/{repository}/commits/{sha}")
            }
        }
    }
}

impl From<PullTarget> for GitHubTarget {
    fn from(value: PullTarget) -> Self {
        Self {
            repository: value.repository,
            change: GitHubChange::Pull(value.number),
        }
    }
}

impl TryFrom<String> for GitHubTarget {
    type Error = AppError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        parse_url(&value)
    }
}

impl TryFrom<String> for PullTarget {
    type Error = AppError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        parse_url(&value)?.pull().ok_or_else(|| {
            AppError::bad_request(
                "GitHub reviews are available for pull requests, not compare or commit URLs.",
            )
        })
    }
}

pub fn parse_url(input: &str) -> AppResult<GitHubTarget> {
    let url = Url::parse(input).map_err(|_| {
        AppError::bad_request("Paste a GitHub pull request, compare, or commit URL.")
    })?;
    if url.host_str() != Some("github.com") {
        return Err(AppError::bad_request(
            "Hunker currently accepts github.com URLs.",
        ));
    }
    let segments = url
        .path_segments()
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    let [owner, repo, resource, id, ..] = segments.as_slice() else {
        return Err(AppError::bad_request(
            "Paste a complete GitHub pull request or compare URL.",
        ));
    };
    let repository = RepositorySlug::new(owner, repo).map_err(AppError::bad_request)?;
    let change = match *resource {
        "pull" => GitHubChange::Pull(PullNumber::parse(id)?),
        "compare" => {
            let decoded = percent_decode_str(id).decode_utf8_lossy();
            let (base, head) = decoded
                .split_once("...")
                .filter(|(base, head)| !base.is_empty() && !head.is_empty())
                .ok_or_else(|| {
                    AppError::bad_request("Paste a GitHub compare URL in base...head form.")
                })?;
            GitHubChange::Compare(CompareRange {
                base: base.to_owned(),
                head: head.to_owned(),
            })
        }
        "commit" => GitHubChange::Commit(CommitId::parse(*id).map_err(AppError::bad_request)?),
        _ => {
            return Err(AppError::bad_request(
                "Paste a GitHub pull request, compare, or commit URL.",
            ));
        }
    };
    Ok(GitHubTarget { repository, change })
}

pub(super) fn encode(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_github_locations() {
        assert!(matches!(
            parse_url("https://github.com/acme/demo/pull/42").unwrap().change,
            GitHubChange::Pull(number) if number.as_u32() == 42
        ));
        assert!(matches!(
            parse_url("https://github.com/acme/demo/commit/abcdef1")
                .unwrap()
                .change,
            GitHubChange::Commit(_)
        ));
        assert!(matches!(
            parse_url("https://github.com/acme/demo/compare/main...feature%2Fx")
                .unwrap()
                .change,
            GitHubChange::Compare(CompareRange { head, .. }) if head == "feature/x"
        ));
        assert!(parse_url("https://example.com/acme/demo/pull/42").is_err());
        assert!(parse_url("https://github.com/acme/demo/pull/0").is_err());
        assert!(parse_url("https://github.com/acme/demo/compare/main").is_err());
    }

    #[test]
    fn collaboration_targets_decode_only_from_pull_request_urls() {
        assert!(
            serde_json::from_str::<PullTarget>(r#""https://github.com/acme/demo/pull/7""#).is_ok()
        );
        assert!(
            serde_json::from_str::<PullTarget>(r#""https://github.com/acme/demo/commit/abcdef1""#)
                .is_err()
        );
    }
}
