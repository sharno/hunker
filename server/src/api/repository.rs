use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, post},
};
use serde::Deserialize;

use crate::{
    AppState,
    error::{AppError, AppResult},
    local,
    types::{RelativePath, RepositorySlug},
};

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/repositories", get(get_repositories))
        .route("/api/repository/files", get(get_files))
        .route("/api/repository/commits", get(get_commits))
        .route("/api/repository/source-control", get(get_source_control))
        .route("/api/repository/pulls", get(get_pulls))
        .route("/api/repository/search", get(get_search))
        .route("/api/repository/file", get(get_file))
        .route("/api/repository/clone", post(clone))
        .route("/api/repository/branch", post(switch_branch))
        .route("/api/repository/pull", post(pull))
}

#[derive(Deserialize)]
struct RepositoryQuery {
    repository: String,
}

pub(crate) fn parse_repository(value: &str) -> AppResult<RepositorySlug> {
    RepositorySlug::parse(value).map_err(AppError::bad_request)
}

async fn get_repositories(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<local::LocalRepositories>> {
    Ok(Json(state.local.list_repositories().await?))
}

async fn get_files(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RepositoryQuery>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(
        serde_json::json!({"files": state.local.list_files(&parse_repository(&query.repository)?).await?}),
    ))
}

async fn get_commits(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RepositoryQuery>,
) -> AppResult<Json<local::RepositoryCommits>> {
    Ok(Json(
        state
            .local
            .list_commits(&parse_repository(&query.repository)?)
            .await?,
    ))
}

async fn get_source_control(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RepositoryQuery>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(
        serde_json::json!({"status": state.local.source_control(&parse_repository(&query.repository)?).await?}),
    ))
}

#[derive(Deserialize)]
struct PullsQuery {
    repository: String,
    state: Option<PullRequestState>,
    page: Option<usize>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum PullRequestState {
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

async fn get_pulls(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PullsQuery>,
) -> AppResult<Json<crate::github::RepositoryPullsPage>> {
    let filter = query.state.unwrap_or(PullRequestState::Open);
    let page = query.page.unwrap_or(1);
    if !(1..=1_000).contains(&page) {
        return Err(AppError::bad_request(
            "Pull request page must be between 1 and 1000.",
        ));
    }
    Ok(Json(
        state
            .github
            .repository_pulls(&parse_repository(&query.repository)?, filter.as_str(), page)
            .await?,
    ))
}

#[derive(Deserialize)]
struct SearchQuery {
    repository: String,
    query: String,
    mode: Option<SearchMode>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum SearchMode {
    Literal,
    Regex,
    Fuzzy,
}

impl SearchMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Literal => "literal",
            Self::Regex => "regex",
            Self::Fuzzy => "fuzzy",
        }
    }
}

async fn get_search(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SearchQuery>,
) -> AppResult<Json<local::SearchResults>> {
    let mode = query.mode.unwrap_or(SearchMode::Literal);
    Ok(Json(
        state
            .local
            .search(
                &parse_repository(&query.repository)?,
                &query.query,
                mode.as_str(),
            )
            .await?,
    ))
}

#[derive(Deserialize)]
struct FileQuery {
    repository: String,
    path: RelativePath,
}

async fn get_file(
    State(state): State<Arc<AppState>>,
    Query(query): Query<FileQuery>,
) -> AppResult<Json<local::RepositoryFileContent>> {
    Ok(Json(
        state
            .local
            .read_file(&parse_repository(&query.repository)?, query.path.as_str())
            .await?,
    ))
}

#[derive(Deserialize)]
struct CloneBody {
    repository: String,
    destination: String,
}

async fn clone(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CloneBody>,
) -> AppResult<Json<serde_json::Value>> {
    if !matches!(body.destination.as_str(), "temporary" | "configured") {
        return Err(AppError::bad_request("Choose a valid clone destination."));
    }
    let path = state
        .local
        .clone_repository(&parse_repository(&body.repository)?, &body.destination)
        .await?;
    Ok(Json(serde_json::json!({"path": path})))
}

#[derive(Deserialize)]
struct BranchBody {
    repository: String,
    branch: String,
}

async fn switch_branch(
    State(state): State<Arc<AppState>>,
    Json(body): Json<BranchBody>,
) -> AppResult<Json<serde_json::Value>> {
    if body.branch.is_empty() {
        return Err(AppError::bad_request("Choose a branch."));
    }
    Ok(Json(
        serde_json::json!({"status": state.local.switch_branch(&parse_repository(&body.repository)?, &body.branch).await?}),
    ))
}

#[derive(Deserialize)]
struct PullBody {
    repository: String,
}

async fn pull(
    State(state): State<Arc<AppState>>,
    Json(body): Json<PullBody>,
) -> AppResult<Json<local::PullResult>> {
    Ok(Json(
        state
            .local
            .pull(&parse_repository(&body.repository)?)
            .await?,
    ))
}
