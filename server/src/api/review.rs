use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use crate::{
    AppState, analysis,
    error::{AppError, AppResult},
    github::{GitHubTarget, InlineCommentInput, ReviewAction, ReviewComment, parse_url},
    revision,
    types::{FilePair, FileStatus, Oid, PinnedRefs, RelativePath, ReviewBacking, ReviewDocument},
};

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/diff", get(get_diff))
        .route("/api/revision", get(get_revision))
        .route("/api/commits", get(get_commits))
        .route("/api/file", get(get_file))
        .route("/api/analysis", get(get_analysis))
        .route("/api/reviews", get(get_reviews))
        .route("/api/reviews/comment", post(post_comment))
        .route("/api/reviews/reply", post(post_reply))
        .route("/api/reviews/submit", post(post_review))
}

#[derive(Deserialize)]
struct UrlQuery {
    url: String,
}

#[derive(Serialize)]
#[serde(
    tag = "source",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
enum RevisionResponse {
    GitHub,
    Local {
        path: String,
        pinned_head_oid: String,
        latest_head_oid: String,
        checked_at: u64,
        current: bool,
    },
}

#[derive(Serialize)]
struct CommitsResponse {
    commits: Vec<crate::types::PullCommit>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FullFileResponse {
    old_text: String,
    new_text: String,
}

#[derive(Serialize)]
pub(crate) struct CommentsResponse {
    pub(crate) comments: Vec<ReviewComment>,
}

#[derive(Serialize)]
struct CommentResponse {
    comment: ReviewComment,
}

#[derive(Serialize)]
struct SubmitReviewResponse {
    event: ReviewAction,
}

async fn get_diff(
    State(state): State<Arc<AppState>>,
    Query(query): Query<UrlQuery>,
) -> AppResult<Json<ReviewDocument>> {
    let target = parse_url(&query.url)?;
    let metadata = state.github.metadata(&target).await?;
    let revision_key = revision::RevisionKey::new(
        target.repository(),
        Oid::parse(metadata.base_oid.clone()).map_err(AppError::bad_request)?,
        Oid::parse(metadata.head_oid.clone()).map_err(AppError::bad_request)?,
    );
    let build_key = revision_key.clone();
    let build_target = target.clone();
    let local = state.local.clone();
    let github = state.github.clone();
    let snapshot = state
        .revisions
        .get_or_build(revision_key, || async move {
            revision::load(&local, &github, build_target, build_key).await
        })
        .await?;
    let backing = if let Some(repository) = snapshot.local_repository() {
        tracing::debug!(kind = repository.kind, path = %repository.path.display(), "reading review from local Git");
        ReviewBacking::Local {
            base_oid: metadata.base_oid.clone(),
            head_oid: metadata.head_oid.clone(),
            head_ref: metadata.head_ref.clone(),
            path: repository.path.to_string_lossy().into_owned(),
        }
    } else {
        ReviewBacking::GitHub {
            base_oid: metadata.base_oid.clone(),
            head_oid: metadata.head_oid.clone(),
            head_ref: metadata.head_ref.clone(),
        }
    };
    Ok(Json(ReviewDocument {
        title: metadata.title,
        repository: metadata.repository,
        number: metadata.number,
        author: metadata.author,
        base: metadata.base,
        head: metadata.head,
        url: metadata.url,
        files: snapshot.files.as_ref().clone(),
        backing,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevisionQuery {
    url: String,
    head_oid: Oid,
}

async fn get_revision(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RevisionQuery>,
) -> AppResult<Json<RevisionResponse>> {
    let target = parse_url(&query.url)?;
    let Some(value) = state
        .local
        .revision(&target, query.head_oid.as_str())
        .await?
    else {
        return Ok(Json(RevisionResponse::GitHub));
    };
    let current = value.pinned_head_oid == value.latest_head_oid;
    Ok(Json(RevisionResponse::Local {
        path: value.repository.path.to_string_lossy().into_owned(),
        pinned_head_oid: value.pinned_head_oid,
        latest_head_oid: value.latest_head_oid,
        checked_at: value.checked_at,
        current,
    }))
}

async fn get_commits(
    State(state): State<Arc<AppState>>,
    Query(query): Query<UrlQuery>,
) -> AppResult<Json<CommitsResponse>> {
    let target = parse_url(&query.url)?;
    if !matches!(target, GitHubTarget::Pull { .. }) {
        return Err(AppError::bad_request(
            "GitHub reviews are available for pull requests, not compare URLs.",
        ));
    }
    let metadata = state.github.metadata(&target).await?;
    let commits = match state.local.load_pull_commits(&target, &metadata).await? {
        Some(commits) => commits,
        None => state.github.pull_commits(&target).await?,
    };
    Ok(Json(CommitsResponse { commits }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileQuery {
    url: String,
    path: RelativePath,
    previous_path: Option<RelativePath>,
    status: FileStatus,
    base_oid: Option<Oid>,
    head_oid: Option<Oid>,
}

impl FileQuery {
    fn pinned(&self) -> Option<PinnedRefs<'_>> {
        match (&self.base_oid, &self.head_oid) {
            (Some(base), Some(head)) => Some(PinnedRefs {
                base: base.as_str(),
                head: head.as_str(),
            }),
            _ => None,
        }
    }
}

async fn file_pair(
    state: &AppState,
    target: &GitHubTarget,
    query: &FileQuery,
) -> AppResult<FilePair> {
    let previous = query
        .previous_path
        .as_ref()
        .map_or("", RelativePath::as_str);
    if let Some(refs) = query.pinned() {
        if let Some(pair) = state
            .local
            .load_file_pair(
                target,
                refs.base,
                refs.head,
                query.path.as_str(),
                previous,
                query.status,
            )
            .await?
        {
            return Ok(pair);
        }
        state
            .github
            .file_pair(
                target,
                refs.base,
                refs.head,
                query.path.as_str(),
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
                query.path.as_str(),
                previous,
                query.status,
            )
            .await
    }
}

async fn get_file(
    State(state): State<Arc<AppState>>,
    Query(query): Query<FileQuery>,
) -> AppResult<Json<FullFileResponse>> {
    let target = parse_url(&query.url)?;
    let pair = file_pair(&state, &target, &query).await?;
    Ok(Json(FullFileResponse {
        old_text: pair.old_text,
        new_text: pair.new_text,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisQuery {
    url: String,
    base_oid: Oid,
    head_oid: Oid,
    whitespace: String,
    semantic: bool,
    mode: String,
}

async fn get_analysis(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AnalysisQuery>,
) -> AppResult<Json<analysis::AnalysisSnapshot>> {
    let target = parse_url(&query.url)?;
    let ignore_whitespace = match query.whitespace.as_str() {
        "ignore" => true,
        "show" => false,
        _ => {
            return Err(AppError::bad_request(
                "Whitespace mode must be ignore or show.",
            ));
        }
    };
    let key = analysis::AnalysisSnapshotKey::new(
        &target.repository(),
        query.base_oid.as_str().to_owned(),
        query.head_oid.as_str().to_owned(),
        analysis::AnalysisOptions {
            ignore_whitespace,
            semantic: query.semantic,
            inline_diff: analysis::InlineDiff::from_query(&query.mode)?,
        },
    );
    let build_key = key.clone();
    let revision_key =
        revision::RevisionKey::new(target.repository(), query.base_oid, query.head_oid);
    let revision_build_key = revision_key.clone();
    let revision_target = target.clone();
    let local = state.local.clone();
    let github = state.github.clone();
    let snapshot = state
        .revisions
        .get_or_build(revision_key, || {
            let local = local.clone();
            let github = github.clone();
            async move {
                revision::load(&local, &github, revision_target, revision_build_key).await
            }
        })
        .await?;
    let analysis = state
        .analysis
        .get_or_build(key, || async move {
            analysis::build(&local, &github, snapshot, build_key).await
        })
        .await?;
    Ok(Json(analysis.as_ref().clone()))
}

async fn get_reviews(
    State(state): State<Arc<AppState>>,
    Query(query): Query<UrlQuery>,
) -> AppResult<Json<CommentsResponse>> {
    let target = parse_url(&query.url)?;
    Ok(Json(CommentsResponse {
        comments: state.github.review_comments(&target).await?,
    }))
}

async fn post_comment(
    State(state): State<Arc<AppState>>,
    Json(mut body): Json<InlineCommentInput>,
) -> AppResult<Json<CommentResponse>> {
    body.body = body.body.trim().to_owned();
    if body.body.is_empty() {
        return Err(AppError::bad_request("Write a comment before posting."));
    }
    if body.line == 0 {
        return Err(AppError::bad_request("The review request body is invalid."));
    }
    let target = parse_url(&body.pull_url)?;
    Ok(Json(CommentResponse {
        comment: state.github.create_comment(&target, &body).await?,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplyBody {
    url: String,
    comment_id: u64,
    body: String,
}

async fn post_reply(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ReplyBody>,
) -> AppResult<Json<CommentResponse>> {
    let text = body.body.trim();
    if text.is_empty() {
        return Err(AppError::bad_request("Write a reply before posting."));
    }
    let target = parse_url(&body.url)?;
    Ok(Json(CommentResponse {
        comment: state.github.reply(&target, body.comment_id, text).await?,
    }))
}

#[derive(Deserialize)]
struct SubmitBody {
    url: String,
    body: String,
    event: ReviewAction,
}

async fn post_review(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SubmitBody>,
) -> AppResult<Json<SubmitReviewResponse>> {
    let event = body.event;
    let text = body.body.trim();
    if event != ReviewAction::Approve && text.is_empty() {
        return Err(AppError::bad_request(
            "Comment and request-changes reviews require a summary.",
        ));
    }
    let target = parse_url(&body.url)?;
    state.github.submit_review(&target, text, event).await?;
    Ok(Json(SubmitReviewResponse { event }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revision_response_keeps_the_elm_contract_typed() {
        let response = RevisionResponse::Local {
            path: "/tmp/acme/demo".to_owned(),
            pinned_head_oid: "111".to_owned(),
            latest_head_oid: "222".to_owned(),
            checked_at: 42,
            current: false,
        };
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            serde_json::json!({
                "source": "local",
                "path": "/tmp/acme/demo",
                "pinnedHeadOid": "111",
                "latestHeadOid": "222",
                "checkedAt": 42,
                "current": false
            })
        );
    }
}
