use std::collections::HashMap;

use futures::{StreamExt, stream};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    types::{LineNumber, NonEmptyText, Oid, RelativePath},
};

use super::{GitHub, PullTarget};

const COMMENT_PAGE_SIZE: usize = 100;
const MAX_COMMENT_PAGES: usize = 30;

const REVIEW_THREADS_QUERY: &str = "query HunkerReviewThreads($owner: String!, $repo: String!, $number: Int!, $cursor: String) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100, after: $cursor) { nodes { isResolved comments(first: 1) { nodes { fullDatabaseId } } } pageInfo { hasNextPage endCursor } } } } }";

impl GitHub {
    pub async fn review_comments(&self, target: &PullTarget) -> AppResult<Vec<ReviewComment>> {
        let (values, resolutions) = futures::try_join!(
            self.paged::<ReviewCommentResponse>(
                |page| {
                    format!(
                        "https://api.github.com/repos/{}/pulls/{}/comments?per_page={COMMENT_PAGE_SIZE}&page={page}",
                        target.repository, target.number
                    )
                },
                COMMENT_PAGE_SIZE,
                MAX_COMMENT_PAGES,
            ),
            self.resolutions(target),
        )?;
        Ok(values
            .into_iter()
            .map(|value| ReviewComment::new(value, &resolutions))
            .collect())
    }

    async fn resolutions(&self, target: &PullTarget) -> AppResult<HashMap<CommentId, bool>> {
        let pages = stream::unfold(Some(None::<String>), |cursor| async move {
            let cursor = cursor?;
            let page = self.thread_page(target, cursor.as_deref()).await;
            let next = match &page {
                Ok(Some(threads)) if threads.page_info.has_next_page => {
                    threads.page_info.end_cursor.clone().map(Some)
                }
                Ok(_) | Err(_) => None,
            };
            Some((page, next))
        })
        .collect::<Vec<_>>()
        .await;
        Ok(pages
            .into_iter()
            .collect::<AppResult<Vec<_>>>()?
            .into_iter()
            .flatten()
            .flat_map(|threads| threads.nodes)
            .filter_map(|thread| {
                let root = thread
                    .comments
                    .nodes
                    .first()?
                    .full_database_id
                    .as_ref()?
                    .id()?;
                Some((root, thread.is_resolved))
            })
            .collect())
    }

    /// Returns `None` when GitHub no longer exposes the pull request's threads.
    async fn thread_page(
        &self,
        target: &PullTarget,
        cursor: Option<&str>,
    ) -> AppResult<Option<Threads>> {
        let body = GraphQlRequest {
            query: REVIEW_THREADS_QUERY,
            variables: ThreadVariables {
                owner: target.repository.owner(),
                repo: target.repository.name(),
                number: target.number.as_u32(),
                cursor,
            },
        };
        let page: ThreadsResponse = self
            .post("https://api.github.com/graphql", "application/json", &body)
            .await?
            .json()
            .await
            .map_err(|_| AppError::upstream("GitHub returned malformed review thread data."))?;
        Ok(page
            .data
            .repository
            .and_then(|repository| repository.pull_request)
            .map(|pull| pull.review_threads))
    }

    pub async fn reply(
        &self,
        target: &PullTarget,
        comment_id: CommentId,
        body: &NonEmptyText,
    ) -> AppResult<ReviewComment> {
        let value: ReviewCommentResponse = self
            .post_json(
                &format!(
                    "https://api.github.com/repos/{}/pulls/{}/comments/{}/replies",
                    target.repository, target.number, comment_id.0
                ),
                &ReplyPayload {
                    body: body.as_str(),
                },
            )
            .await?;
        Ok(ReviewComment::new(value, &HashMap::new()))
    }

    pub async fn create_comment(&self, comment: &InlineComment) -> AppResult<ReviewComment> {
        let target = &comment.pull_url;
        let value: ReviewCommentResponse = self
            .post_json(
                &format!(
                    "https://api.github.com/repos/{}/pulls/{}/comments",
                    target.repository, target.number
                ),
                &InlineCommentPayload {
                    body: comment.body.as_str(),
                    commit_id: &comment.commit_id,
                    path: &comment.path,
                    line: comment.line,
                    side: comment.side,
                },
            )
            .await?;
        Ok(ReviewComment::new(value, &HashMap::new()))
    }

    pub async fn submit_review(
        &self,
        target: &PullTarget,
        submission: &ReviewSubmission,
    ) -> AppResult<()> {
        self.post(
            &format!(
                "https://api.github.com/repos/{}/pulls/{}/reviews",
                target.repository, target.number
            ),
            "application/vnd.github+json",
            &SubmitReviewPayload {
                body: submission.body().map(NonEmptyText::as_str),
                event: submission.action(),
            },
        )
        .await?;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CommentId(u64);

#[derive(Serialize)]
struct ReplyPayload<'a> {
    body: &'a str,
}

#[derive(Serialize)]
struct InlineCommentPayload<'a> {
    body: &'a str,
    commit_id: &'a Oid,
    path: &'a RelativePath,
    line: LineNumber,
    side: CommentSide,
}

#[derive(Serialize)]
struct SubmitReviewPayload<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<&'a str>,
    event: ReviewAction,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReviewAction {
    Comment,
    Approve,
    RequestChanges,
}

/// A review GitHub will accept: only approvals may omit the summary.
#[derive(Debug, Clone)]
pub enum ReviewSubmission {
    Approve(Option<NonEmptyText>),
    Comment(NonEmptyText),
    RequestChanges(NonEmptyText),
}

impl ReviewSubmission {
    pub fn new(action: ReviewAction, body: &str) -> AppResult<Self> {
        let summary = NonEmptyText::parse(body).ok();
        match (action, summary) {
            (ReviewAction::Approve, summary) => Ok(Self::Approve(summary)),
            (ReviewAction::Comment, Some(summary)) => Ok(Self::Comment(summary)),
            (ReviewAction::RequestChanges, Some(summary)) => Ok(Self::RequestChanges(summary)),
            (ReviewAction::Comment | ReviewAction::RequestChanges, None) => Err(
                AppError::bad_request("Comment and request-changes reviews require a summary."),
            ),
        }
    }

    pub fn action(&self) -> ReviewAction {
        match self {
            Self::Approve(_) => ReviewAction::Approve,
            Self::Comment(_) => ReviewAction::Comment,
            Self::RequestChanges(_) => ReviewAction::RequestChanges,
        }
    }

    fn body(&self) -> Option<&NonEmptyText> {
        match self {
            Self::Approve(summary) => summary.as_ref(),
            Self::Comment(summary) | Self::RequestChanges(summary) => Some(summary),
        }
    }
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
    id: CommentId,
    path: String,
    body: String,
    user: Option<CommentUser>,
    html_url: String,
    created_at: String,
    in_reply_to_id: Option<CommentId>,
    line: Option<usize>,
    original_line: Option<usize>,
    side: Option<CommentSide>,
    original_side: Option<CommentSide>,
}

#[derive(Deserialize)]
struct CommentUser {
    login: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewComment {
    pub id: CommentId,
    pub root_id: CommentId,
    pub path: String,
    pub body: String,
    pub author: String,
    pub html_url: String,
    pub created_at: String,
    pub line: Option<usize>,
    pub side: CommentSide,
    pub resolved: bool,
}

impl ReviewComment {
    fn new(value: ReviewCommentResponse, resolutions: &HashMap<CommentId, bool>) -> Self {
        let root_id = value.in_reply_to_id.unwrap_or(value.id);
        Self {
            id: value.id,
            root_id,
            path: value.path,
            body: value.body,
            author: value
                .user
                .map_or_else(|| "GitHub user".to_owned(), |user| user.login),
            html_url: value.html_url,
            created_at: value.created_at,
            line: value.line.or(value.original_line),
            side: value
                .side
                .or(value.original_side)
                .unwrap_or(CommentSide::Right),
            resolved: resolutions.get(&root_id).copied().unwrap_or(false),
        }
    }
}

/// An inline comment request, decoded into GitHub-valid anchors at the HTTP
/// boundary.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineComment {
    pub pull_url: PullTarget,
    pub commit_id: Oid,
    pub path: RelativePath,
    pub line: LineNumber,
    pub side: CommentSide,
    pub body: NonEmptyText,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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
    fn id(&self) -> Option<CommentId> {
        match self {
            Self::Number(value) => Some(CommentId(*value)),
            Self::Text(value) => value.parse().ok().map(CommentId),
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
        let commit_id = Oid::parse("a".repeat(40)).unwrap();
        let path = RelativePath::parse("src/main.rs").unwrap();
        let payload = InlineCommentPayload {
            body: "Please rename this.",
            commit_id: &commit_id,
            path: &path,
            line: serde_json::from_str("12").unwrap(),
            side: CommentSide::Right,
        };
        assert_eq!(
            serde_json::to_value(&payload).unwrap(),
            serde_json::json!({
                "body": "Please rename this.",
                "commit_id": "a".repeat(40),
                "path": "src/main.rs",
                "line": 12,
                "side": "RIGHT"
            })
        );
    }

    #[test]
    fn only_approvals_may_omit_a_review_summary() {
        assert!(ReviewSubmission::new(ReviewAction::Approve, "  ").is_ok());
        assert!(ReviewSubmission::new(ReviewAction::Comment, "  ").is_err());
        assert!(matches!(
            ReviewSubmission::new(ReviewAction::RequestChanges, " fix this "),
            Ok(ReviewSubmission::RequestChanges(summary)) if summary.as_str() == "fix this"
        ));
    }
}
