mod character_diff;
mod command;
mod diff;
mod error;
mod frontend;
mod github;
mod local;
mod semantic;
mod settings;
mod types;

use std::{env, sync::Arc};

use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderValue, Method},
    routing::{get, post},
};
use futures::{StreamExt, stream};
use serde::Deserialize;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::{
    character_diff::DiffMode,
    error::{AppError, AppResult},
    github::{GitHub, GitHubTarget, InlineCommentInput, parse_url},
    local::Local,
    types::{FilePair, FileStatus, PinnedRefs, RepositoryId, ReviewBacking, ReviewData},
};

#[derive(Clone)]
struct AppState {
    github: GitHub,
    local: Local,
}

#[tokio::main]
async fn main() -> AppResult<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "hunker_server=info,tower_http=info".into()),
        )
        .init();
    let state = Arc::new(AppState {
        github: GitHub::new().await?,
        local: Local::default(),
    });
    let app = router(state);
    let port = env::var("HUNKER_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(5173);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|error| AppError::internal(format!("Could not bind port {port}: {error}")))?;
    tracing::info!(port, "Hunker listening");
    axum::serve(listener, app)
        .await
        .map_err(|error| AppError::internal(format!("Hunker server stopped: {error}")))
}

fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/settings", get(get_settings).put(save_settings))
        .route("/api/diff", get(get_diff))
        .route("/api/revision", get(get_revision))
        .route("/api/commits", get(get_commits))
        .route("/api/repositories", get(get_repositories))
        .route("/api/repository/files", get(get_repository_files))
        .route("/api/repository/commits", get(get_repository_commits))
        .route("/api/repository/source-control", get(get_source_control))
        .route("/api/repository/pulls", get(get_repository_pulls))
        .route("/api/repository/search", get(get_repository_search))
        .route("/api/repository/file", get(get_repository_file))
        .route("/api/repository/clone", post(clone_repository))
        .route("/api/repository/branch", post(switch_repository_branch))
        .route("/api/repository/pull", post(pull_repository))
        .route("/api/file", get(get_file))
        .route("/api/characters", get(get_characters))
        .route("/api/semantic", get(get_semantic))
        .route("/api/moves", get(get_moves))
        .route("/api/reviews", get(get_reviews))
        .route("/api/reviews/comment", post(post_review_comment))
        .route("/api/reviews/reply", post(post_review_reply))
        .route("/api/reviews/submit", post(post_review))
        .route("/assets/app.js", get(frontend::javascript))
        .route("/assets/app.css", get(frontend::stylesheet))
        .layer(
            CorsLayer::new()
                .allow_origin(
                    "http://localhost:5173"
                        .parse::<HeaderValue>()
                        .expect("valid development origin"),
                )
                .allow_methods([Method::GET, Method::POST, Method::PUT])
                .allow_headers(tower_http::cors::Any),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state)
        .fallback(get(frontend::index))
}

#[derive(Deserialize)]
struct UrlQuery {
    url: String,
}

async fn get_diff(
    State(state): State<Arc<AppState>>,
    Query(query): Query<UrlQuery>,
) -> AppResult<Json<ReviewData>> {
    let target = parse_url(&query.url)?;
    let metadata = state.github.metadata(&target).await?;
    let local = state
        .local
        .load_diff(&target, &metadata.base_oid, &metadata.head_oid)
        .await
        .ok()
        .flatten();
    let (diff, backing) = if let Some((repository, diff)) = local {
        let kind = repository.kind;
        tracing::debug!(kind, path = %repository.path.display(), "reading review from local Git");
        (
            diff,
            ReviewBacking {
                source: "local",
                base_oid: metadata.base_oid.clone(),
                head_oid: metadata.head_oid.clone(),
                head_ref: metadata.head_ref.clone(),
                path: repository.path.to_string_lossy().into_owned(),
            },
        )
    } else {
        (
            state.github.review_diff(&target).await?,
            ReviewBacking {
                source: "github",
                base_oid: metadata.base_oid.clone(),
                head_oid: metadata.head_oid.clone(),
                head_ref: metadata.head_ref.clone(),
                path: String::new(),
            },
        )
    };
    Ok(Json(ReviewData {
        title: metadata.title,
        repository: metadata.repository,
        number: metadata.number,
        author: metadata.author,
        base: metadata.base,
        head: metadata.head,
        url: metadata.url,
        diff,
        backing,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevisionQuery {
    url: String,
    head_oid: String,
}
async fn get_revision(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RevisionQuery>,
) -> AppResult<Json<serde_json::Value>> {
    if !local::valid_oid(&query.head_oid) {
        return Err(AppError::bad_request(
            "A pinned pull request revision is required.",
        ));
    }
    let target = parse_url(&query.url)?;
    let Some(revision) = state.local.revision(&target, &query.head_oid).await? else {
        return Ok(Json(serde_json::json!({"source": "github"})));
    };
    Ok(Json(
        serde_json::json!({"source": "local", "path": revision.repository.path, "pinnedHeadOid": revision.pinned_head_oid, "latestHeadOid": revision.latest_head_oid, "checkedAt": revision.checked_at, "current": revision.pinned_head_oid == revision.latest_head_oid}),
    ))
}

async fn get_commits(
    State(state): State<Arc<AppState>>,
    Query(query): Query<UrlQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let target = parse_url(&query.url)?;
    if !matches!(target, GitHubTarget::Pull { .. }) {
        return Err(AppError::bad_request(
            "GitHub reviews are available for pull requests, not compare URLs.",
        ));
    }
    let metadata = state.github.metadata(&target).await?;
    let commits = match state.local.load_pull_commits(&target, &metadata).await {
        Ok(Some(commits)) => commits,
        _ => state.github.pull_commits(&target).await?,
    };
    Ok(Json(serde_json::json!({"commits": commits})))
}

async fn get_repositories(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<local::LocalRepositories>> {
    Ok(Json(state.local.list_repositories().await?))
}

#[derive(Deserialize)]
struct RepositoryQuery {
    repository: String,
}
fn repository(value: &str) -> AppResult<RepositoryId> {
    let Some((owner, name)) = value.split_once('/') else {
        return Err(AppError::bad_request(
            "Choose a repository in owner/name format.",
        ));
    };
    if owner.is_empty() || name.is_empty() || name.contains('/') {
        return Err(AppError::bad_request(
            "Choose a repository in owner/name format.",
        ));
    }
    Ok(RepositoryId {
        owner: owner.to_owned(),
        name: name.to_owned(),
    })
}

async fn get_repository_files(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RepositoryQuery>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(
        serde_json::json!({"files": state.local.list_files(&repository(&query.repository)?).await?}),
    ))
}
async fn get_repository_commits(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RepositoryQuery>,
) -> AppResult<Json<local::RepositoryCommits>> {
    Ok(Json(
        state
            .local
            .list_commits(&repository(&query.repository)?)
            .await?,
    ))
}
async fn get_source_control(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RepositoryQuery>,
) -> AppResult<Json<serde_json::Value>> {
    Ok(Json(
        serde_json::json!({"status": state.local.source_control(&repository(&query.repository)?).await?}),
    ))
}

#[derive(Deserialize)]
struct PullsQuery {
    repository: String,
    state: Option<String>,
    page: Option<usize>,
}
async fn get_repository_pulls(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PullsQuery>,
) -> AppResult<Json<github::RepositoryPullsPage>> {
    let filter = query.state.unwrap_or_else(|| "open".to_owned());
    if !matches!(filter.as_str(), "open" | "closed" | "all") {
        return Err(AppError::bad_request("Choose a valid pull request state."));
    }
    let page = query.page.unwrap_or(1);
    if !(1..=1_000).contains(&page) {
        return Err(AppError::bad_request(
            "Pull request page must be between 1 and 1000.",
        ));
    }
    Ok(Json(
        state
            .github
            .repository_pulls(&repository(&query.repository)?, &filter, page)
            .await?,
    ))
}

#[derive(Deserialize)]
struct SearchQuery {
    repository: String,
    query: String,
    mode: Option<String>,
}
async fn get_repository_search(
    State(state): State<Arc<AppState>>,
    Query(query): Query<SearchQuery>,
) -> AppResult<Json<local::SearchResults>> {
    let mode = query.mode.unwrap_or_else(|| "literal".to_owned());
    if !matches!(mode.as_str(), "literal" | "regex" | "fuzzy") {
        return Err(AppError::bad_request("Choose a valid search mode."));
    }
    Ok(Json(
        state
            .local
            .search(&repository(&query.repository)?, &query.query, &mode)
            .await?,
    ))
}

#[derive(Deserialize)]
struct RepositoryFileQuery {
    repository: String,
    path: String,
}
async fn get_repository_file(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RepositoryFileQuery>,
) -> AppResult<Json<local::RepositoryFileContent>> {
    Ok(Json(
        state
            .local
            .read_file(&repository(&query.repository)?, &query.path)
            .await?,
    ))
}

#[derive(Deserialize)]
struct CloneBody {
    repository: String,
    destination: String,
}
async fn clone_repository(
    State(state): State<Arc<AppState>>,
    Json(body): Json<CloneBody>,
) -> AppResult<Json<serde_json::Value>> {
    if !matches!(body.destination.as_str(), "temporary" | "configured") {
        return Err(AppError::bad_request("Choose a valid clone destination."));
    }
    let path = state
        .local
        .clone_repository(&repository(&body.repository)?, &body.destination)
        .await?;
    Ok(Json(serde_json::json!({"path": path})))
}

#[derive(Deserialize)]
struct BranchBody {
    repository: String,
    branch: String,
}
async fn switch_repository_branch(
    State(state): State<Arc<AppState>>,
    Json(body): Json<BranchBody>,
) -> AppResult<Json<serde_json::Value>> {
    if body.branch.is_empty() {
        return Err(AppError::bad_request("Choose a branch."));
    }
    Ok(Json(
        serde_json::json!({"status": state.local.switch_branch(&repository(&body.repository)?, &body.branch).await?}),
    ))
}

#[derive(Deserialize)]
struct PullBody {
    repository: String,
}
async fn pull_repository(
    State(state): State<Arc<AppState>>,
    Json(body): Json<PullBody>,
) -> AppResult<Json<local::PullResult>> {
    Ok(Json(
        state.local.pull(&repository(&body.repository)?).await?,
    ))
}

async fn get_settings() -> AppResult<Json<settings::SettingsDocument>> {
    Ok(Json(settings::load().await?))
}
#[derive(Deserialize)]
struct SettingsBody {
    settings: settings::HunkerSettings,
}
async fn save_settings(
    Json(body): Json<SettingsBody>,
) -> AppResult<Json<settings::SettingsDocument>> {
    Ok(Json(settings::save(body.settings).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileQuery {
    url: String,
    path: String,
    previous_path: Option<String>,
    status: FileStatus,
    base_oid: Option<String>,
    head_oid: Option<String>,
}
impl FileQuery {
    fn pinned(&self) -> Option<PinnedRefs<'_>> {
        match (&self.base_oid, &self.head_oid) {
            (Some(base), Some(head)) if local::valid_oid(base) && local::valid_oid(head) => {
                Some(PinnedRefs { base, head })
            }
            _ => None,
        }
    }
}

async fn file_pair(
    state: &AppState,
    target: &GitHubTarget,
    query: &FileQuery,
) -> AppResult<FilePair> {
    if query.path.is_empty() {
        return Err(AppError::bad_request(
            "Choose a reviewable file before loading its revisions.",
        ));
    }
    let previous = query.previous_path.as_deref().unwrap_or("");
    if let Some(refs) = query.pinned() {
        if let Ok(Some(pair)) = state
            .local
            .load_file_pair(
                target,
                refs.base,
                refs.head,
                &query.path,
                previous,
                query.status,
            )
            .await
        {
            return Ok(pair);
        }
        state
            .github
            .file_pair(
                target,
                refs.base,
                refs.head,
                &query.path,
                previous,
                query.status,
            )
            .await
    } else {
        let metadata = state.github.metadata(target).await?;
        state
            .github
            .file_pair(
                target,
                &metadata.base_oid,
                &metadata.head_oid,
                &query.path,
                previous,
                query.status,
            )
            .await
    }
}

async fn get_file(
    State(state): State<Arc<AppState>>,
    Query(query): Query<FileQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let target = parse_url(&query.url)?;
    let pair = file_pair(&state, &target, &query).await?;
    Ok(Json(
        serde_json::json!({"oldText": pair.old_text, "newText": pair.new_text}),
    ))
}

#[derive(Deserialize)]
struct CharacterQuery {
    #[serde(flatten)]
    file: FileQuery,
    whitespace: Option<String>,
    mode: Option<String>,
}
async fn get_characters(
    State(state): State<Arc<AppState>>,
    Query(query): Query<CharacterQuery>,
) -> AppResult<Json<character_diff::CharacterDiffResult>> {
    let target = parse_url(&query.file.url)?;
    let pair = file_pair(&state, &target, &query.file).await?;
    let mode = if query.mode.as_deref() == Some("character") {
        DiffMode::Character
    } else {
        DiffMode::Token
    };
    Ok(Json(
        character_diff::analyze(
            &pair.path,
            &pair.old_text,
            &pair.new_text,
            query.whitespace.as_deref() == Some("ignore"),
            mode,
        )
        .await?,
    ))
}

async fn get_semantic(
    State(state): State<Arc<AppState>>,
    Query(query): Query<FileQuery>,
) -> AppResult<Json<semantic::SemanticResult>> {
    let target = parse_url(&query.url)?;
    let pair = file_pair(&state, &target, &query).await?;
    Ok(Json(semantic::analyze_file(&pair)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MovesQuery {
    url: String,
    base_oid: Option<String>,
    head_oid: Option<String>,
}
async fn get_moves(
    State(state): State<Arc<AppState>>,
    Query(query): Query<MovesQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let target = parse_url(&query.url)?;
    let pinned = match (&query.base_oid, &query.head_oid) {
        (Some(base), Some(head)) if local::valid_oid(base) && local::valid_oid(head) => {
            Some((base.as_str(), head.as_str()))
        }
        _ => None,
    };
    let diff = if let Some((base, head)) = pinned {
        match state.local.load_diff(&target, base, head).await {
            Ok(Some((_, diff))) => diff,
            _ => state.github.revision_diff(&target, base, head).await?,
        }
    } else {
        state.github.review_diff(&target).await?
    };
    let files = diff::parse_git_diff(&diff)
        .into_iter()
        .filter(|file| file.patch.contains("@@") && !diff::generated(&file.path))
        .collect::<Vec<_>>();
    let Some(refs) = pinned else {
        let metadata = state.github.metadata(&target).await?;
        return get_moves_at_refs(
            &state,
            &target,
            files,
            &metadata.base_oid,
            &metadata.head_oid,
        )
        .await;
    };
    get_moves_at_refs(&state, &target, files, refs.0, refs.1).await
}

async fn get_moves_at_refs(
    state: &AppState,
    target: &GitHubTarget,
    files: Vec<types::FileChange>,
    base: &str,
    head: &str,
) -> AppResult<Json<serde_json::Value>> {
    let pairs = stream::iter(files)
        .map(|file| async move {
            match state
                .local
                .load_file_pair(
                    target,
                    base,
                    head,
                    &file.path,
                    &file.previous_path,
                    file.status,
                )
                .await
            {
                Ok(Some(pair)) => Ok(pair),
                _ => {
                    state
                        .github
                        .file_pair(
                            target,
                            base,
                            head,
                            &file.path,
                            &file.previous_path,
                            file.status,
                        )
                        .await
                }
            }
        })
        .buffer_unordered(6)
        .collect::<Vec<AppResult<FilePair>>>()
        .await
        .into_iter()
        .collect::<AppResult<Vec<_>>>()?;
    Ok(Json(
        serde_json::json!({"moves": semantic::analyze_review(&pairs)}),
    ))
}

async fn get_reviews(
    State(state): State<Arc<AppState>>,
    Query(query): Query<UrlQuery>,
) -> AppResult<Json<serde_json::Value>> {
    let target = parse_url(&query.url)?;
    Ok(Json(
        serde_json::json!({"comments": state.github.review_comments(&target).await?}),
    ))
}

async fn post_review_comment(
    State(state): State<Arc<AppState>>,
    Json(mut body): Json<InlineCommentInput>,
) -> AppResult<Json<serde_json::Value>> {
    body.body = body.body.trim().to_owned();
    if body.body.is_empty() {
        return Err(AppError::bad_request("Write a comment before posting."));
    }
    if body.line == 0 || !matches!(body.side.as_str(), "LEFT" | "RIGHT") {
        return Err(AppError::bad_request("The review request body is invalid."));
    }
    let target = parse_url(&body.pull_url)?;
    Ok(Json(
        serde_json::json!({"comment": state.github.create_comment(&target, &body).await?}),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplyBody {
    url: String,
    comment_id: u64,
    body: String,
}
async fn post_review_reply(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ReplyBody>,
) -> AppResult<Json<serde_json::Value>> {
    let text = body.body.trim();
    if text.is_empty() {
        return Err(AppError::bad_request("Write a reply before posting."));
    }
    let target = parse_url(&body.url)?;
    Ok(Json(
        serde_json::json!({"comment": state.github.reply(&target, body.comment_id, text).await?}),
    ))
}

#[derive(Deserialize)]
struct SubmitBody {
    url: String,
    body: String,
    event: String,
}
async fn post_review(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SubmitBody>,
) -> AppResult<Json<serde_json::Value>> {
    if !matches!(
        body.event.as_str(),
        "COMMENT" | "APPROVE" | "REQUEST_CHANGES"
    ) {
        return Err(AppError::bad_request("The review request body is invalid."));
    }
    let text = body.body.trim();
    if body.event != "APPROVE" && text.is_empty() {
        return Err(AppError::bad_request(
            "Comment and request-changes reviews require a summary.",
        ));
    }
    let target = parse_url(&body.url)?;
    state
        .github
        .submit_review(&target, text, &body.event)
        .await?;
    Ok(Json(serde_json::json!({"event": body.event})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_malformed_repository_names() {
        assert!(repository("owner/repo/extra").is_err());
    }
    #[tokio::test]
    async fn exposes_every_frontend_route() {
        let _router = router(Arc::new(AppState {
            github: GitHub::new().await.unwrap(),
            local: Local::default(),
        }));
    }
}
