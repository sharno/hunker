use serde::{Deserialize, Serialize};

use crate::{error::AppResult, types::RepositorySlug};

use super::GitHub;

impl GitHub {
    pub async fn repository_pulls(
        &self,
        repository: &RepositorySlug,
        state: PullRequestState,
        page: usize,
    ) -> AppResult<RepositoryPullsPage> {
        let items: Vec<PullListItem> = self.json(&format!(
            "https://api.github.com/repos/{}/{}/pulls?state={}&sort=updated&direction=desc&per_page=50&page={page}",
            repository.owner, repository.name, state.as_str()
        )).await?;
        Ok(RepositoryPullsPage {
            state,
            page,
            has_more: items.len() == 50,
            pull_requests: items.into_iter().map(RepositoryPullRequest::from).collect(),
        })
    }
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PullRequestState {
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
struct PullListItem {
    number: usize,
    title: String,
    state: String,
    draft: bool,
    user: Option<PullUser>,
    updated_at: String,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryPullRequest {
    number: usize,
    title: String,
    author: String,
    avatar_url: String,
    state: String,
    draft: bool,
    updated_at: String,
    base: String,
    head: String,
    labels: Vec<String>,
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
            avatar_url: value
                .user
                .and_then(|user| user.avatar_url)
                .unwrap_or_default(),
            state: if value.merged_at.is_some() {
                "merged".to_owned()
            } else {
                value.state
            },
            draft: value.draft,
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
    pub page: usize,
    pub has_more: bool,
    pub pull_requests: Vec<RepositoryPullRequest>,
}

pub(crate) fn contract_fixture() -> RepositoryPullsPage {
    RepositoryPullsPage {
        state: PullRequestState::Open,
        page: 1,
        has_more: false,
        pull_requests: vec![RepositoryPullRequest {
            number: 42,
            title: "Keep contracts typed".to_owned(),
            author: "agent".to_owned(),
            avatar_url: "https://avatars.example/agent".to_owned(),
            state: "open".to_owned(),
            draft: false,
            updated_at: "2026-08-10T12:00:00Z".to_owned(),
            base: "main".to_owned(),
            head: "agent:typed-contracts".to_owned(),
            labels: vec!["rust".to_owned(), "elm".to_owned()],
        }],
    }
}
