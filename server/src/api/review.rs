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
    github::{
        GitHubTarget, InlineComment, PullTarget, ReviewComment, ReviewSubmission,
        reviews::{CommentId, ReviewAction},
    },
    revision::{RevisionKey, RevisionSnapshot},
    source_presentation::FilePresentation,
    types::{NonEmptyText, Oid, PullCommit, RelativePath, ReviewDocument, ReviewSource},
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

impl AppState {
    async fn revision(
        &self,
        target: &GitHubTarget,
        base_oid: Oid,
        head_oid: Oid,
    ) -> AppResult<Arc<RevisionSnapshot>> {
        let key = RevisionKey {
            repository: target.repository.clone(),
            base_oid,
            head_oid,
        };
        let pull = target.pull().map(|pull| pull.number);
        self.revisions
            .get_or_build(key, |key| {
                crate::revision::load(&self.local, &self.github, key, pull)
            })
            .await
    }
}

#[derive(Deserialize)]
struct UrlQuery {
    url: GitHubTarget,
}

#[derive(Deserialize)]
struct PullQuery {
    url: PullTarget,
}

/// Whether the pinned review head is still the pull request's latest head.
#[derive(Serialize)]
#[serde(tag = "_tag", rename_all_fields = "camelCase")]
pub(crate) enum HeadFreshness {
    Current,
    Behind { latest_head_oid: Oid },
}

#[derive(Serialize)]
#[serde(
    tag = "source",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub(crate) enum RevisionResponse {
    GitHub,
    Local {
        path: String,
        checked_at: u64,
        head: HeadFreshness,
    },
}

#[derive(Serialize)]
pub(crate) struct CommitsResponse {
    pub(crate) commits: Vec<PullCommit>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FullFileResponse {
    old_text: String,
    new_text: String,
    presentation: FilePresentation,
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
    let target = query.url;
    let metadata = state.github.metadata(&target).await?;
    let snapshot = state
        .revision(
            &target,
            metadata.revision.base_oid.clone(),
            metadata.revision.head_oid.clone(),
        )
        .await?;
    let source = snapshot
        .local_repository()
        .map_or(ReviewSource::GitHub, |repository| {
            tracing::debug!(root = ?repository.root, path = %repository.path.display(), "reading review from local Git");
            ReviewSource::Local {
                path: repository.path.to_string_lossy().into_owned(),
            }
        });
    Ok(Json(ReviewDocument {
        title: metadata.title,
        author: metadata.author,
        base: metadata.base,
        head: metadata.head,
        files: Arc::clone(&snapshot.files),
        revision: metadata.revision,
        source,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevisionQuery {
    url: PullTarget,
    head_oid: Oid,
}

async fn get_revision(
    State(state): State<Arc<AppState>>,
    Query(query): Query<RevisionQuery>,
) -> AppResult<Json<RevisionResponse>> {
    let Some(revision) = state.local.revision(&query.url).await? else {
        return Ok(Json(RevisionResponse::GitHub));
    };
    Ok(Json(RevisionResponse::Local {
        path: revision.repository.path.to_string_lossy().into_owned(),
        checked_at: revision.checked_at,
        head: if revision.latest_head_oid == query.head_oid {
            HeadFreshness::Current
        } else {
            HeadFreshness::Behind {
                latest_head_oid: revision.latest_head_oid,
            }
        },
    }))
}

async fn get_commits(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PullQuery>,
) -> AppResult<Json<CommitsResponse>> {
    let target = query.url;
    let metadata = state
        .github
        .metadata(&GitHubTarget::from(target.clone()))
        .await?;
    let commits = match state
        .local
        .load_pull_commits(&target, &metadata.revision)
        .await?
    {
        Some(commits) => commits,
        None => state.github.pull_commits(&target).await?,
    };
    Ok(Json(CommitsResponse { commits }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileQuery {
    url: GitHubTarget,
    path: RelativePath,
    base_oid: Oid,
    head_oid: Oid,
}

async fn get_file(
    State(state): State<Arc<AppState>>,
    Query(query): Query<FileQuery>,
) -> AppResult<Json<FullFileResponse>> {
    let snapshot = state
        .revision(&query.url, query.base_oid, query.head_oid)
        .await?;
    let missing = || {
        AppError::not_found(format!(
            "{} was not found in this immutable review.",
            query.path
        ))
    };
    let pairs = snapshot.file_pairs(&state.local, &state.github).await?;
    let pair = pairs
        .iter()
        .find(|pair| pair.path == query.path)
        .ok_or_else(missing)?;
    let presentation = snapshot
        .prepared(&state.local, &state.github)
        .await?
        .file_presentation(&query.path)
        .ok_or_else(missing)?;
    Ok(Json(FullFileResponse {
        old_text: pair.old_text.clone(),
        new_text: pair.new_text.clone(),
        presentation,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisQuery {
    url: GitHubTarget,
    base_oid: Oid,
    head_oid: Oid,
    whitespace: analysis::WhitespaceMode,
    semantic: analysis::Toggle,
    syntax: analysis::Toggle,
    inline_diff: analysis::InlineDiff,
}

async fn get_analysis(
    State(state): State<Arc<AppState>>,
    Query(query): Query<AnalysisQuery>,
) -> AppResult<Json<Arc<analysis::AnalysisSnapshot>>> {
    let snapshot = state
        .revision(&query.url, query.base_oid, query.head_oid)
        .await?;
    let key = analysis::AnalysisSnapshotKey {
        revision: snapshot.key.clone(),
        options: analysis::AnalysisOptions {
            whitespace: query.whitespace,
            semantic: query.semantic,
            syntax: query.syntax,
            inline_diff: query.inline_diff,
        },
    };
    let analysis = state
        .analysis
        .get_or_build(key, |key| {
            analysis::build(&state.local, &state.github, snapshot, key.options)
        })
        .await?;
    Ok(Json(analysis))
}

async fn get_reviews(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PullQuery>,
) -> AppResult<Json<CommentsResponse>> {
    Ok(Json(CommentsResponse {
        comments: state.github.review_comments(&query.url).await?,
    }))
}

async fn post_comment(
    State(state): State<Arc<AppState>>,
    Json(comment): Json<InlineComment>,
) -> AppResult<Json<CommentResponse>> {
    Ok(Json(CommentResponse {
        comment: state.github.create_comment(&comment).await?,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplyBody {
    url: PullTarget,
    comment_id: CommentId,
    body: NonEmptyText,
}

async fn post_reply(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ReplyBody>,
) -> AppResult<Json<CommentResponse>> {
    Ok(Json(CommentResponse {
        comment: state
            .github
            .reply(&body.url, body.comment_id, &body.body)
            .await?,
    }))
}

#[derive(Deserialize)]
struct SubmitBody {
    url: PullTarget,
    body: String,
    event: ReviewAction,
}

async fn post_review(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SubmitBody>,
) -> AppResult<Json<SubmitReviewResponse>> {
    let submission = ReviewSubmission::new(body.event, &body.body)?;
    state.github.submit_review(&body.url, &submission).await?;
    Ok(Json(SubmitReviewResponse {
        event: submission.action(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revision_response_keeps_the_elm_contract_typed() {
        let response = RevisionResponse::Local {
            path: "/tmp/acme/demo".to_owned(),
            checked_at: 42,
            head: HeadFreshness::Behind {
                latest_head_oid: Oid::parse("2".repeat(40)).unwrap(),
            },
        };
        assert_eq!(
            serde_json::to_value(response).unwrap(),
            serde_json::json!({
                "source": "local",
                "path": "/tmp/acme/demo",
                "checkedAt": 42,
                "head": { "_tag": "Behind", "latestHeadOid": "2".repeat(40) }
            })
        );
    }
}
