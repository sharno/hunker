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

#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct AppError {
    pub status: StatusCode,
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    code: ErrorCode,
    message: &'a str,
    retryable: bool,
}

impl AppError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        let (code, retryable) = match status {
            StatusCode::BAD_REQUEST => (ErrorCode::BadRequest, false),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => (ErrorCode::Unauthorized, false),
            StatusCode::NOT_FOUND => (ErrorCode::NotFound, false),
            StatusCode::CONFLICT => (ErrorCode::Conflict, false),
            StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT => (ErrorCode::Upstream, true),
            _ => (ErrorCode::Internal, status.is_server_error()),
        };
        Self {
            status,
            code,
            message: message.into(),
            retryable,
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, message)
    }

    pub fn upstream(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_GATEWAY, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, message)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        (
            self.status,
            Json(ErrorBody {
                code: self.code,
                message: &self.message,
                retryable: self.retryable,
            }),
        )
            .into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_a_stable_typed_error_contract() {
        let error = AppError::conflict("Commit or stash staged changes before pulling.");
        let body = ErrorBody {
            code: error.code,
            message: &error.message,
            retryable: error.retryable,
        };

        assert_eq!(error.code, ErrorCode::Conflict);
        assert!(!error.retryable);
        assert_eq!(
            serde_json::to_value(body).expect("error body should serialize"),
            serde_json::json!({
                "code": "conflict",
                "message": "Commit or stash staged changes before pulling.",
                "retryable": false
            })
        );
    }
}
