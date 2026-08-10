use percent_encoding::{NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
use url::Url;

use crate::{
    error::{AppError, AppResult},
    types::RepositorySlug,
};

mod repository;
mod review_source;
mod reviews;
mod transport;

pub use repository::{PullRequestState, RepositoryPullsPage};
pub use review_source::ReviewMetadata;
pub use reviews::{InlineCommentInput, ReviewAction, ReviewComment};
pub use transport::GitHub;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitHubTarget {
    Pull {
        owner: String,
        repo: String,
        number: String,
    },
    Compare {
        owner: String,
        repo: String,
        range: String,
    },
    Commit {
        owner: String,
        repo: String,
        sha: String,
    },
}

impl GitHubTarget {
    pub fn owner(&self) -> &str {
        match self {
            Self::Pull { owner, .. } | Self::Compare { owner, .. } | Self::Commit { owner, .. } => {
                owner
            }
        }
    }

    pub fn repo(&self) -> &str {
        match self {
            Self::Pull { repo, .. } | Self::Compare { repo, .. } | Self::Commit { repo, .. } => {
                repo
            }
        }
    }

    pub fn repository(&self) -> RepositorySlug {
        RepositorySlug {
            owner: self.owner().to_owned(),
            name: self.repo().to_owned(),
        }
    }

    pub fn pull_number(&self) -> Option<&str> {
        match self {
            Self::Pull { number, .. } => Some(number),
            _ => None,
        }
    }

    pub(super) fn api_url(&self) -> String {
        match self {
            Self::Pull {
                owner,
                repo,
                number,
            } => format!("https://api.github.com/repos/{owner}/{repo}/pulls/{number}"),
            Self::Compare { owner, repo, range } => format!(
                "https://api.github.com/repos/{owner}/{repo}/compare/{}",
                encode(range)
            ),
            Self::Commit { owner, repo, sha } => {
                format!("https://api.github.com/repos/{owner}/{repo}/commits/{sha}")
            }
        }
    }

    pub fn web_url(&self) -> String {
        match self {
            Self::Pull {
                owner,
                repo,
                number,
            } => format!("https://github.com/{owner}/{repo}/pull/{number}"),
            Self::Compare { owner, repo, range } => {
                format!("https://github.com/{owner}/{repo}/compare/{range}")
            }
            Self::Commit { owner, repo, sha } => {
                format!("https://github.com/{owner}/{repo}/commit/{sha}")
            }
        }
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
    let decoded = percent_decode_str(id).decode_utf8_lossy().into_owned();
    match *resource {
        "pull" if id.chars().all(|value| value.is_ascii_digit()) => Ok(GitHubTarget::Pull {
            owner: (*owner).to_owned(),
            repo: (*repo).to_owned(),
            number: (*id).to_owned(),
        }),
        "compare" if id.len() > 2 => Ok(GitHubTarget::Compare {
            owner: (*owner).to_owned(),
            repo: (*repo).to_owned(),
            range: decoded,
        }),
        "commit"
            if (7..=64).contains(&id.len())
                && id.chars().all(|value| value.is_ascii_hexdigit()) =>
        {
            Ok(GitHubTarget::Commit {
                owner: (*owner).to_owned(),
                repo: (*repo).to_owned(),
                sha: (*id).to_owned(),
            })
        }
        _ => Err(AppError::bad_request(
            "Paste a GitHub pull request, compare, or commit URL.",
        )),
    }
}

pub(super) fn encode(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_github_locations() {
        assert!(
            matches!(parse_url("https://github.com/acme/demo/pull/42").unwrap(), GitHubTarget::Pull { number, .. } if number == "42")
        );
        assert!(matches!(
            parse_url("https://github.com/acme/demo/commit/abcdef1").unwrap(),
            GitHubTarget::Commit { .. }
        ));
        assert!(parse_url("https://example.com/acme/demo/pull/42").is_err());
    }
}
