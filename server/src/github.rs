use std::{collections::HashMap, env};

use axum::http::StatusCode;
use percent_encoding::{NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
use reqwest::{Method, header};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::json;
use url::Url;

use crate::{
    command,
    error::{AppError, AppResult},
    types::{FilePair, FileStatus, PullCommit, RepositoryId},
};

const API_VERSION: &str = "2022-11-28";

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

    pub fn repository(&self) -> RepositoryId {
        RepositoryId {
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

    fn api_url(&self) -> String {
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

fn encode(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}

#[derive(Clone)]
pub struct GitHub {
    client: reqwest::Client,
    token: Option<String>,
}

impl GitHub {
    pub async fn new() -> AppResult<Self> {
        let token = match env::var("GITHUB_TOKEN").or_else(|_| env::var("GH_TOKEN")) {
            Ok(value) if !value.trim().is_empty() => Some(value.trim().to_owned()),
            _ => command::checked("gh", &["auth", "token"], None)
                .await
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty()),
        };
        let client = reqwest::Client::builder()
            .user_agent("hunker-diff-reviewer")
            .build()
            .map_err(|error| {
                AppError::internal(format!("Could not initialize GitHub HTTP: {error}"))
            })?;
        Ok(Self { client, token })
    }

    async fn request(
        &self,
        method: Method,
        url: &str,
        accept: &str,
        body: Option<serde_json::Value>,
    ) -> AppResult<reqwest::Response> {
        let mut request = self
            .client
            .request(method, url)
            .header(header::ACCEPT, accept)
            .header("x-github-api-version", API_VERSION);
        if let Some(token) = &self.token {
            request = request.bearer_auth(token);
        }
        if let Some(value) = body {
            request = request.json(&value);
        }
        let response = request
            .send()
            .await
            .map_err(|error| AppError::upstream(format!("Could not reach GitHub: {error}")))?;
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status();
        let anonymous = self.token.is_none();
        let message = match status.as_u16() {
            404 if anonymous => {
                "That change may be private. Run gh auth login or set GITHUB_TOKEN."
            }
            404 => "That change could not be found or your GitHub account cannot access it.",
            401 => "GitHub rejected the local credential. Run gh auth login again.",
            403 => {
                "GitHub denied this request. Check that the local token has pull-request access and try again."
            }
            422 => "GitHub rejected this review action. Refresh the PR and try again.",
            _ => "GitHub returned an error. Try again in a moment.",
        };
        Err(AppError::new(
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            message,
        ))
    }

    async fn json<T: DeserializeOwned>(&self, url: &str) -> AppResult<T> {
        self.request(Method::GET, url, "application/vnd.github+json", None)
            .await?
            .json()
            .await
            .map_err(|_| AppError::upstream("GitHub returned malformed data."))
    }

    async fn post_json<T: DeserializeOwned>(
        &self,
        url: &str,
        body: serde_json::Value,
    ) -> AppResult<T> {
        self.request(Method::POST, url, "application/vnd.github+json", Some(body))
            .await?
            .json()
            .await
            .map_err(|_| AppError::upstream("GitHub returned malformed review data."))
    }

    async fn text(&self, url: &str, accept: &str) -> AppResult<String> {
        self.request(Method::GET, url, accept, None)
            .await?
            .text()
            .await
            .map_err(|_| AppError::upstream("GitHub returned malformed text data."))
    }

    pub async fn metadata(&self, target: &GitHubTarget) -> AppResult<ReviewMetadata> {
        match target {
            GitHubTarget::Pull {
                owner,
                repo,
                number,
            } => {
                let value: PullMetadataResponse = self.json(&target.api_url()).await?;
                Ok(ReviewMetadata {
                    title: value.title,
                    repository: format!("{owner}/{repo}"),
                    number: number.clone(),
                    author: value
                        .user
                        .map_or_else(|| "GitHub".to_owned(), |user| user.login),
                    base: value.base.reference,
                    head: value.head.reference.clone(),
                    url: target.web_url(),
                    base_oid: value.base.sha,
                    head_oid: value.head.sha,
                    head_ref: value.head.reference,
                })
            }
            GitHubTarget::Compare { owner, repo, range } => {
                let value: CompareMetadataResponse = self.json(&target.api_url()).await?;
                let (base, head) = range.split_once("...").unwrap_or(("base", "head"));
                let base_oid = value.base_commit.sha;
                Ok(ReviewMetadata {
                    title: range.clone(),
                    repository: format!("{owner}/{repo}"),
                    number: "compare".to_owned(),
                    author: "GitHub".to_owned(),
                    base: base.to_owned(),
                    head: head.to_owned(),
                    url: target.web_url(),
                    base_oid: base_oid.clone(),
                    head_oid: value
                        .commits
                        .last()
                        .map_or_else(|| base_oid.clone(), |commit| commit.sha.clone()),
                    head_ref: head.to_owned(),
                })
            }
            GitHubTarget::Commit { owner, repo, sha } => {
                let value: CommitMetadataResponse = self.json(&target.api_url()).await?;
                let base_oid = value
                    .parents
                    .first()
                    .map_or_else(String::new, |parent| parent.sha.clone());
                Ok(ReviewMetadata {
                    title: value
                        .commit
                        .message
                        .lines()
                        .next()
                        .unwrap_or(&value.commit.message)
                        .to_owned(),
                    repository: format!("{owner}/{repo}"),
                    number: sha.chars().take(7).collect(),
                    author: author(value.author.as_ref(), value.commit.author.as_ref()),
                    base: base_oid.clone(),
                    head: value.sha.clone(),
                    url: target.web_url(),
                    base_oid,
                    head_oid: value.sha.clone(),
                    head_ref: value.sha,
                })
            }
        }
    }

    pub async fn review_diff(&self, target: &GitHubTarget) -> AppResult<String> {
        self.text(&target.api_url(), "application/vnd.github.diff")
            .await
    }

    pub async fn revision_diff(
        &self,
        target: &GitHubTarget,
        base: &str,
        head: &str,
    ) -> AppResult<String> {
        self.text(
            &format!(
                "https://api.github.com/repos/{}/{}/compare/{}...{}",
                target.owner(),
                target.repo(),
                encode(base),
                encode(head)
            ),
            "application/vnd.github.diff",
        )
        .await
    }

    pub async fn file_pair(
        &self,
        target: &GitHubTarget,
        base: &str,
        head: &str,
        path: &str,
        previous_path: &str,
        status: FileStatus,
    ) -> AppResult<FilePair> {
        let old_path = if status == FileStatus::Renamed && !previous_path.is_empty() {
            previous_path
        } else {
            path
        };
        let old_text = if status == FileStatus::Added {
            String::new()
        } else {
            self.file(target, old_path, base).await?
        };
        let new_text = if status == FileStatus::Deleted {
            String::new()
        } else {
            self.file(target, path, head).await?
        };
        Ok(FilePair {
            path: path.to_owned(),
            previous_path: (!previous_path.is_empty()).then(|| previous_path.to_owned()),
            status,
            old_text,
            new_text,
        })
    }

    async fn file(&self, target: &GitHubTarget, path: &str, reference: &str) -> AppResult<String> {
        let encoded_path = path.split('/').map(encode).collect::<Vec<_>>().join("/");
        self.text(
            &format!(
                "https://api.github.com/repos/{}/{}/contents/{encoded_path}?ref={}",
                target.owner(),
                target.repo(),
                encode(reference)
            ),
            "application/vnd.github.raw+json",
        )
        .await
    }

    pub async fn pull_commits(&self, target: &GitHubTarget) -> AppResult<Vec<PullCommit>> {
        let Some(number) = target.pull_number() else {
            return Err(AppError::bad_request(
                "GitHub commits are available for pull requests.",
            ));
        };
        let mut commits = Vec::new();
        for page in 1..=100 {
            let values: Vec<PullCommitResponse> = self.json(&format!("https://api.github.com/repos/{}/{}/pulls/{number}/commits?per_page=100&page={page}", target.owner(), target.repo())).await?;
            let count = values.len();
            commits.extend(values.into_iter().map(|value| {
                PullCommit {
                    sha: value.sha,
                    message: value.commit.message,
                    author: author(value.author.as_ref(), value.commit.author.as_ref()),
                    avatar_url: value
                        .author
                        .as_ref()
                        .and_then(|user| user.avatar_url.clone())
                        .unwrap_or_default(),
                    authored_at: value
                        .commit
                        .author
                        .and_then(|entry| entry.date)
                        .unwrap_or_default(),
                    html_url: value.html_url,
                }
            }));
            if count < 100 {
                break;
            }
        }
        Ok(commits)
    }

    pub async fn repository_pulls(
        &self,
        repository: &RepositoryId,
        state: &str,
        page: usize,
    ) -> AppResult<RepositoryPullsPage> {
        let items: Vec<PullListItem> = self.json(&format!("https://api.github.com/repos/{}/{}/pulls?state={state}&sort=updated&direction=desc&per_page=50&page={page}", repository.owner, repository.name)).await?;
        Ok(RepositoryPullsPage {
            state: state.to_owned(),
            page,
            has_more: items.len() == 50,
            pull_requests: items.into_iter().map(RepositoryPullRequest::from).collect(),
        })
    }

    pub async fn review_comments(&self, target: &GitHubTarget) -> AppResult<Vec<ReviewComment>> {
        let Some(number) = target.pull_number() else {
            return Err(AppError::bad_request(
                "GitHub reviews are available for pull requests, not compare URLs.",
            ));
        };
        let values: Vec<ReviewCommentResponse> = self
            .json(&format!(
                "https://api.github.com/repos/{}/{}/pulls/{number}/comments?per_page=100",
                target.owner(),
                target.repo()
            ))
            .await?;
        let resolutions = self.resolutions(target, number).await.unwrap_or_default();
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
        number: &str,
    ) -> AppResult<HashMap<u64, bool>> {
        let mut result = HashMap::new();
        let mut cursor: Option<String> = None;
        loop {
            let body = json!({"query": REVIEW_THREADS_QUERY, "variables": {"owner": target.owner(), "repo": target.repo(), "number": number.parse::<u64>().unwrap_or(0), "cursor": cursor}});
            let page: ThreadsResponse = self
                .request(
                    Method::POST,
                    "https://api.github.com/graphql",
                    "application/json",
                    Some(body),
                )
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
        let value: ReviewCommentResponse = self.post_json(&format!("https://api.github.com/repos/{}/{}/pulls/{number}/comments/{comment_id}/replies", target.owner(), target.repo()), json!({"body": body})).await?;
        Ok(value.into())
    }

    pub async fn create_comment(
        &self,
        target: &GitHubTarget,
        input: &InlineCommentInput,
    ) -> AppResult<ReviewComment> {
        let number = require_pull(target)?;
        let value: ReviewCommentResponse = self.post_json(&format!("https://api.github.com/repos/{}/{}/pulls/{number}/comments", target.owner(), target.repo()), json!({"body": input.body, "commit_id": input.commit_id, "path": input.path, "line": input.line, "side": input.side})).await?;
        Ok(value.into())
    }

    pub async fn submit_review(
        &self,
        target: &GitHubTarget,
        body: &str,
        event: &str,
    ) -> AppResult<()> {
        let number = require_pull(target)?;
        self.request(
            Method::POST,
            &format!(
                "https://api.github.com/repos/{}/{}/pulls/{number}/reviews",
                target.owner(),
                target.repo()
            ),
            "application/vnd.github+json",
            Some(json!({"body": body, "event": event})),
        )
        .await?;
        Ok(())
    }
}

fn require_pull(target: &GitHubTarget) -> AppResult<&str> {
    target.pull_number().ok_or_else(|| {
        AppError::bad_request("GitHub reviews are available for pull requests, not compare URLs.")
    })
}

#[derive(Debug, Clone)]
pub struct ReviewMetadata {
    pub title: String,
    pub repository: String,
    pub number: String,
    pub author: String,
    pub base: String,
    pub head: String,
    pub url: String,
    pub base_oid: String,
    pub head_oid: String,
    pub head_ref: String,
}

#[derive(Deserialize)]
struct User {
    login: String,
    avatar_url: Option<String>,
}
#[derive(Deserialize)]
struct CommitAuthor {
    name: String,
    date: Option<String>,
}
#[derive(Deserialize)]
struct GitRef {
    #[serde(rename = "ref")]
    reference: String,
    sha: String,
}
#[derive(Deserialize)]
struct PullMetadataResponse {
    title: String,
    user: Option<User>,
    base: GitRef,
    head: GitRef,
}
#[derive(Deserialize)]
struct Sha {
    sha: String,
}
#[derive(Deserialize)]
struct CompareMetadataResponse {
    base_commit: Sha,
    commits: Vec<Sha>,
}
#[derive(Deserialize)]
struct CommitDetails {
    message: String,
    author: Option<CommitAuthor>,
}
#[derive(Deserialize)]
struct CommitMetadataResponse {
    sha: String,
    commit: CommitDetails,
    author: Option<User>,
    parents: Vec<Sha>,
}
#[derive(Deserialize)]
struct PullCommitResponse {
    sha: String,
    commit: CommitDetails,
    author: Option<User>,
    html_url: String,
}

fn author(user: Option<&User>, commit: Option<&CommitAuthor>) -> String {
    user.map(|value| value.login.clone())
        .or_else(|| commit.map(|value| value.name.clone()))
        .unwrap_or_else(|| "GitHub user".to_owned())
}

#[derive(Deserialize)]
struct PullListItem {
    number: usize,
    title: String,
    state: String,
    draft: bool,
    user: Option<User>,
    updated_at: String,
    merged_at: Option<String>,
    base: PullListBase,
    head: PullListHead,
    labels: Vec<PullLabel>,
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
    pub state: String,
    pub page: usize,
    pub has_more: bool,
    pub pull_requests: Vec<RepositoryPullRequest>,
}

#[derive(Deserialize)]
struct ReviewCommentResponse {
    id: u64,
    path: String,
    body: String,
    user: Option<User>,
    html_url: String,
    created_at: String,
    in_reply_to_id: Option<u64>,
    line: Option<usize>,
    original_line: Option<usize>,
    side: Option<String>,
    original_side: Option<String>,
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
    pub side: String,
    pub resolved: bool,
}
impl From<ReviewCommentResponse> for ReviewComment {
    fn from(value: ReviewCommentResponse) -> Self {
        let side = value
            .side
            .or(value.original_side)
            .filter(|side| side == "LEFT")
            .unwrap_or_else(|| "RIGHT".to_owned());
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
    pub side: String,
    pub body: String,
}

const REVIEW_THREADS_QUERY: &str = "query HunkerReviewThreads($owner: String!, $repo: String!, $number: Int!, $cursor: String) { repository(owner: $owner, name: $repo) { pullRequest(number: $number) { reviewThreads(first: 100, after: $cursor) { nodes { isResolved comments(first: 1) { nodes { fullDatabaseId } } } pageInfo { hasNextPage endCursor } } } } }";
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
