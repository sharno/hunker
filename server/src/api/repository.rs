use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use crate::{
    AppState,
    error::AppResult,
    github::{PullRequestState, PullsPage, RepositoryPullsPage},
    local,
    types::{BranchName, Oid, RelativePath, RepositoryRoot, RepositorySlug, SearchMode},
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
    repository: RepositorySlug,
}

#[derive(Deserialize)]
struct RevisionQuery {
    repository: RepositorySlug,
    oid: Oid,
}

#[derive(Serialize)]
struct FilesResponse {
    files: Vec<local::RepositoryFile>,
}

#[derive(Serialize)]
pub(crate) struct SourceControlResponse {
    pub(crate) status: local::SourceControlStatus,
}

#[derive(Serialize)]
struct CloneResponse {
    path: String,
}

#[derive(Serialize)]
struct SwitchBranchResponse {
    status: local::SourceControlStatus,
}

async fn get_repositories(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<local::LocalRepositories>> {
    Ok(Json(state.local.list_repositories().await?))
}

async fn get_files(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RevisionQuery>,
) -> AppResult<Json<FilesResponse>> {
    Ok(Json(FilesResponse {
        files: state
            .local
            .list_files(&query.repository, &query.oid)
            .await?,
    }))
}

async fn get_commits(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RevisionQuery>,
) -> AppResult<Json<local::RepositoryCommits>> {
    Ok(Json(
        state
            .local
            .list_commits(&query.repository, &query.oid)
            .await?,
    ))
}

async fn get_source_control(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RepositoryQuery>,
) -> AppResult<Json<SourceControlResponse>> {
    Ok(Json(SourceControlResponse {
        status: state.local.source_control(&query.repository).await?,
    }))
}

#[derive(Deserialize)]
struct PullsQuery {
    repository: RepositorySlug,
    #[serde(default)]
    state: PullRequestState,
    #[serde(default)]
    page: PullsPage,
}

async fn get_pulls(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PullsQuery>,
) -> AppResult<Json<RepositoryPullsPage>> {
    Ok(Json(
        state
            .github
            .repository_pulls(&query.repository, query.state, query.page)
            .await?,
    ))
}

#[derive(Deserialize)]
struct SearchQuery {
    repository: RepositorySlug,
    oid: Oid,
    query: String,
    mode: SearchMode,
}

async fn get_search(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SearchQuery>,
) -> AppResult<Json<local::SearchResults>> {
    Ok(Json(
        state
            .local
            .search(&query.repository, &query.oid, &query.query, query.mode)
            .await?,
    ))
}

#[derive(Deserialize)]
struct FileQuery {
    repository: RepositorySlug,
    oid: Oid,
    path: RelativePath,
}

async fn get_file(
    State(state): State<Arc<AppState>>,
    Query(query): Query<FileQuery>,
) -> AppResult<Json<local::RepositoryFileContent>> {
    Ok(Json(
        state
            .local
            .read_file(&query.repository, &query.oid, &query.path)
            .await?,
    ))
}

#[derive(Deserialize)]
struct CloneBody {
    repository: RepositorySlug,
    destination: RepositoryRoot,
}

async fn clone(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CloneBody>,
) -> AppResult<Json<CloneResponse>> {
    let path = state
        .local
        .clone_repository(&body.repository, body.destination)
        .await?;
    Ok(Json(CloneResponse {
        path: path.to_string_lossy().into_owned(),
    }))
}

#[derive(Deserialize)]
struct BranchBody {
    repository: RepositorySlug,
    branch: BranchName,
}

async fn switch_branch(
    State(state): State<Arc<AppState>>,
    Json(body): Json<BranchBody>,
) -> AppResult<Json<SwitchBranchResponse>> {
    Ok(Json(SwitchBranchResponse {
        status: state
            .local
            .switch_branch(&body.repository, &body.branch)
            .await?,
    }))
}

#[derive(Deserialize)]
struct PullBody {
    repository: RepositorySlug,
}

async fn pull(
    State(state): State<Arc<AppState>>,
    Json(body): Json<PullBody>,
) -> AppResult<Json<local::PullResult>> {
    Ok(Json(state.local.pull(&body.repository).await?))
}
