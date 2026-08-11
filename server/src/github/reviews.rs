use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::{GitHub, GitHubTarget, PullNumber};

const REVIEW_THREADS_QUERY: &str = "query HunkerReviewThreads($owner: String!, $repo: String!, $number: Int!, $cursor: String) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100, after: $cursor) { nodes { isResolved comments(first: 1) { nodes { fullDatabaseId } } } pageInfo { hasNextPage endCursor } } } } }";

impl GitHub {
    pub async fn review_comments(&self, target: &GitHubTarget) -> AppResult<Vec<ReviewComment>> {
        let number = require_pull(target)?;
        let values: Vec<ReviewCommentResponse> = self
            .json(&format!(
                "https://api.github.com/repos/{}/{}/pulls/{number}/comments?per_page=100",
                target.owner(),
                target.repo()
            ))
            .await?;
        let resolutions = self.resolutions(target, number).await?;
        Ok(values
            .into_iter()
            .map(|value| {
                let mut comment = ReviewComment::from(value);
                comment.resolved = resolutions.get(&comment.root_id).copied().unwrap_or(false);
                comment
            })
            .collect())
    }

    async fn resolutions(
        &self,
        target: &GitHubTarget,
        number: &PullNumber,
    ) -> AppResult<HashMap<u64, bool>> {
        let mut result = HashMap::new();
        let mut cursor: Option<String> = None;
        loop {
            let body = GraphQlRequest {
                query: REVIEW_THREADS_QUERY,
                variables: ThreadVariables {
                    owner: target.owner(),
                    repo: target.repo(),
                    number: number.as_u32(),
                    cursor: cursor.as_deref(),
                },
            };
            let page: ThreadsResponse = self
                .post("https://api.github.com/graphql", "application/json", &body)
                .await?
                .json()
                .await
                .map_err(|_| AppError::upstream("GitHub returned malformed review thread data."))?;
            let Some(threads) = page
                .data
                .repository
                .and_then(|repository| repository.pull_request)
                .map(|pull| pull.review_threads)
            else {
                break;
            };
            for thread in threads.nodes {
                if let Some(id) = thread
                    .comments
                    .nodes
                    .first()
                    .and_then(|comment| comment.full_database_id.as_ref())
                    .and_then(DatabaseId::as_u64)
                {
                    result.insert(id, thread.is_resolved);
                }
            }
            if !threads.page_info.has_next_page {
                break;
            }
            cursor = threads.page_info.end_cursor;
            if cursor.is_none() {
                break;
            }
        }
        Ok(result)
    }

    pub async fn reply(
        &self,
        target: &GitHubTarget,
        comment_id: u64,
        body: &str,
    ) -> AppResult<ReviewComment> {
        let number = require_pull(target)?;
        let value: ReviewCommentResponse = self
            .post_json(
                &format!(
                    "https://api.github.com/repos/{}/{}/pulls/{number}/comments/{comment_id}/replies",
                    target.owner(),
                    target.repo()
                ),
                &ReplyPayload { body },
            )
            .await?;
        Ok(value.into())
    }

    pub async fn create_comment(
        &self,
        target: &GitHubTarget,
        input: &InlineCommentInput,
    ) -> AppResult<ReviewComment> {
        let number = require_pull(target)?;
        let payload = InlineCommentPayload {
            body: &input.body,
            commit_id: &input.commit_id,
            path: &input.path,
            line: input.line,
            side: input.side,
        };
        let value: ReviewCommentResponse = self
            .post_json(
                &format!(
                    "https://api.github.com/repos/{}/{}/pulls/{number}/comments",
                    target.owner(),
                    target.repo()
                ),
                &payload,
            )
            .await?;
        Ok(value.into())
    }

    pub async fn submit_review(
        &self,
        target: &GitHubTarget,
        body: &str,
        event: ReviewAction,
    ) -> AppResult<()> {
        let number = require_pull(target)?;
        self.post(
            &format!(
                "https://api.github.com/repos/{}/{}/pulls/{number}/reviews",
                target.owner(),
                target.repo()
            ),
            "application/vnd.github+json",
            &SubmitReviewPayload { body, event },
        )
        .await?;
        Ok(())
    }
}

fn require_pull(target: &GitHubTarget) -> AppResult<&PullNumber> {
    target.pull_number().ok_or_else(|| {
        AppError::bad_request("GitHub reviews are available for pull requests, not compare URLs.")
    })
}

#[derive(Serialize)]
struct ReplyPayload<'a> {
    body: &'a str,
}

#[derive(Serialize)]
struct InlineCommentPayload<'a> {
    body: &'a str,
    commit_id: &'a str,
    path: &'a str,
    line: usize,
    side: CommentSide,
}

#[derive(Serialize)]
struct SubmitReviewPayload<'a> {
    body: &'a str,
    event: ReviewAction,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReviewAction {
    Comment,
    Approve,
    RequestChanges,
}

#[derive(Serialize)]
struct GraphQlRequest<'a> {
    query: &'static str,
    variables: ThreadVariables<'a>,
}

#[derive(Serialize)]
struct ThreadVariables<'a> {
    owner: &'a str,
    repo: &'a str,
    number: u32,
    cursor: Option<&'a str>,
}

#[derive(Deserialize)]
struct ReviewCommentResponse {
    id: u64,
    path: String,
    body: String,
    user: Option<CommentUser>,
    html_url: String,
    created_at: String,
    in_reply_to_id: Option<u64>,
    line: Option<usize>,
    original_line: Option<usize>,
    side: Option<String>,
    original_side: Option<String>,
}

#[derive(Deserialize)]
struct CommentUser {
    login: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewComment {
    pub id: u64,
    pub root_id: u64,
    pub path: String,
    pub body: String,
    pub author: String,
    pub html_url: String,
    pub created_at: String,
    pub line: Option<usize>,
    pub side: CommentSide,
    pub resolved: bool,
}

impl From<ReviewCommentResponse> for ReviewComment {
    fn from(value: ReviewCommentResponse) -> Self {
        let side = value
            .side
            .or(value.original_side)
            .filter(|side| side == "LEFT")
            .map_or(CommentSide::Right, |_| CommentSide::Left);
        Self {
            id: value.id,
            root_id: value.in_reply_to_id.unwrap_or(value.id),
            path: value.path,
            body: value.body,
            author: value
                .user
                .map_or_else(|| "GitHub user".to_owned(), |user| user.login),
            html_url: value.html_url,
            created_at: value.created_at,
            line: value.line.or(value.original_line),
            side,
            resolved: false,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineCommentInput {
    pub pull_url: String,
    pub commit_id: String,
    pub path: String,
    pub line: usize,
    pub side: CommentSide,
    pub body: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum CommentSide {
    Left,
    Right,
}

#[derive(Deserialize)]
struct ThreadsResponse {
    data: ThreadsData,
}

#[derive(Deserialize)]
struct ThreadsData {
    repository: Option<ThreadsRepository>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadsRepository {
    pull_request: Option<ThreadsPull>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadsPull {
    review_threads: Threads,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Threads {
    nodes: Vec<Thread>,
    page_info: PageInfo,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Thread {
    is_resolved: bool,
    comments: ThreadComments,
}

#[derive(Deserialize)]
struct ThreadComments {
    nodes: Vec<ThreadComment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadComment {
    full_database_id: Option<DatabaseId>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum DatabaseId {
    Number(u64),
    Text(String),
}

impl DatabaseId {
    fn as_u64(&self) -> Option<u64> {
        match self {
            Self::Number(value) => Some(*value),
            Self::Text(value) => value.parse().ok(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageInfo {
    has_next_page: bool,
    end_cursor: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_actions_decode_once_as_a_closed_type() {
        assert_eq!(
            serde_json::from_str::<ReviewAction>("\"APPROVE\"").unwrap(),
            ReviewAction::Approve
        );
        assert!(serde_json::from_str::<ReviewAction>("\"MERGE\"").is_err());
    }

    #[test]
    fn inline_payload_excludes_the_hunker_route_field() {
        let payload = InlineCommentPayload {
            body: "Please rename this.",
            commit_id: "abc123",
            path: "src/main.rs",
            line: 12,
            side: CommentSide::Right,
        };
        assert_eq!(
            serde_json::to_string(&payload).unwrap(),
            r#"{"body":"Please rename this.","commit_id":"abc123","path":"src/main.rs","line":12,"side":"RIGHT"}"#
        );
    }
}
