use axum::{Json, http::StatusCode, response::IntoResponse};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    BadRequest,
    Unauthorized,
    NotFound,
    Conflict,
    Upstream,
    Internal,
}

impl ErrorCode {
    fn status(self) -> StatusCode {
        match self {
            Self::BadRequest => StatusCode::BAD_REQUEST,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Conflict => StatusCode::CONFLICT,
            Self::Upstream => StatusCode::BAD_GATEWAY,
            Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn retryable(self) -> bool {
        match self {
            Self::Upstream => true,
            Self::BadRequest
            | Self::Unauthorized
            | Self::NotFound
            | Self::Conflict
            | Self::Internal => false,
        }
    }
}

/// The code is the single source of truth; the HTTP status and retry hint are
/// derived from it so they cannot disagree.
#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct AppError {
    code: ErrorCode,
    message: String,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    code: ErrorCode,
    message: &'a str,
    retryable: bool,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::BadRequest, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::NotFound, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Conflict, message)
    }

    pub fn upstream(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Upstream, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }

    fn body(&self) -> ErrorBody<'_> {
        ErrorBody {
            code: self.code,
            message: &self.message,
            retryable: self.code.retryable(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        (self.code.status(), Json(self.body())).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_a_stable_typed_error_contract() {
        let error = AppError::conflict("Commit or stash staged changes before pulling.");

        assert_eq!(error.code.status(), StatusCode::CONFLICT);
        assert_eq!(
            serde_json::to_value(error.body()).expect("error body should serialize"),
            serde_json::json!({
                "code": "conflict",
                "message": "Commit or stash staged changes before pulling.",
                "retryable": false
            })
        );
    }
}
