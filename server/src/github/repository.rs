use serde::{Deserialize, Serialize};

use crate::{
    error::AppResult,
    types::{RepositorySlug, Timestamp},
};

use super::GitHub;

const PULLS_PAGE_SIZE: usize = 50;
const MAX_PULLS_PAGE: usize = 1_000;

/// A one-based pull-request list page within GitHub's practical paging limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "usize", into = "usize")]
pub struct PullsPage(usize);

impl TryFrom<usize> for PullsPage {
    type Error = String;

    fn try_from(value: usize) -> Result<Self, Self::Error> {
        if (1..=MAX_PULLS_PAGE).contains(&value) {
            Ok(Self(value))
        } else {
            Err(format!(
                "Pull request page must be between 1 and {MAX_PULLS_PAGE}."
            ))
        }
    }
}

impl From<PullsPage> for usize {
    fn from(value: PullsPage) -> Self {
        value.0
    }
}

impl Default for PullsPage {
    fn default() -> Self {
        Self(1)
    }
}

impl GitHub {
    pub async fn repository_pulls(
        &self,
        repository: &RepositorySlug,
        state: PullRequestState,
        page: PullsPage,
    ) -> AppResult<RepositoryPullsPage> {
        let items: Vec<PullListItem> = self.json(&format!(
            "https://api.github.com/repos/{repository}/pulls?state={}&sort=updated&direction=desc&per_page={PULLS_PAGE_SIZE}&page={}",
            state.as_str(),
            page.0
        )).await?;
        Ok(RepositoryPullsPage {
            state,
            page,
            has_more: items.len() == PULLS_PAGE_SIZE,
            pull_requests: items.into_iter().map(RepositoryPullRequest::from).collect(),
        })
    }
}

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PullRequestState {
    #[default]
    Open,
    Closed,
    All,
}

impl PullRequestState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Closed => "closed",
            Self::All => "all",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum PullListState {
    Open,
    Closed,
}

#[derive(Deserialize)]
struct PullListItem {
    number: usize,
    title: String,
    state: PullListState,
    draft: bool,
    user: Option<PullUser>,
    updated_at: Timestamp,
    merged_at: Option<String>,
    base: PullListBase,
    head: PullListHead,
    labels: Vec<PullLabel>,
}

#[derive(Deserialize)]
struct PullUser {
    login: String,
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct PullListBase {
    #[serde(rename = "ref")]
    reference: String,
}

#[derive(Deserialize)]
struct PullListHead {
    label: String,
}

#[derive(Deserialize)]
struct PullLabel {
    name: String,
}

/// GitHub reports `state`, `draft`, and `merged_at` separately; only these
/// combinations are meaningful to a reviewer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PullRequestStatus {
    Draft,
    Open,
    Merged,
    Closed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPullRequest {
    pub number: usize,
    pub title: String,
    pub author: String,
    pub avatar_url: Option<String>,
    pub status: PullRequestStatus,
    pub updated_at: Timestamp,
    pub base: String,
    pub head: String,
    pub labels: Vec<String>,
}

impl From<PullListItem> for RepositoryPullRequest {
    fn from(value: PullListItem) -> Self {
        Self {
            number: value.number,
            title: value.title,
            author: value
                .user
                .as_ref()
                .map_or_else(|| "GitHub user".to_owned(), |user| user.login.clone()),
            avatar_url: value.user.and_then(|user| user.avatar_url),
            status: match (value.state, value.merged_at, value.draft) {
                (PullListState::Open, _, true) => PullRequestStatus::Draft,
                (PullListState::Open, _, false) => PullRequestStatus::Open,
                (PullListState::Closed, Some(_), _) => PullRequestStatus::Merged,
                (PullListState::Closed, None, _) => PullRequestStatus::Closed,
            },
            updated_at: value.updated_at,
            base: value.base.reference,
            head: value.head.label,
            labels: value.labels.into_iter().map(|label| label.name).collect(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPullsPage {
    pub state: PullRequestState,
    pub page: PullsPage,
    pub has_more: bool,
    pub pull_requests: Vec<RepositoryPullRequest>,
}
