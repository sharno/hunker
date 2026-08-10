use std::env;

use axum::http::StatusCode;
use reqwest::{Method, header};
use serde::{Serialize, de::DeserializeOwned};

use crate::{
    command,
    error::{AppError, AppResult},
};

const API_VERSION: &str = "2022-11-28";

#[derive(Clone)]
pub struct GitHub {
    client: reqwest::Client,
    token: Option<String>,
}

impl GitHub {
    pub async fn new() -> AppResult<Self> {
        let token = match env::var("GITHUB_TOKEN").or_else(|_| env::var("GH_TOKEN")) {
            Ok(value) if !value.trim().is_empty() => Some(value.trim().to_owned()),
            _ => match command::checked("gh", &["auth", "token"], None).await {
                Ok(value) => Some(value.trim().to_owned()).filter(|value| !value.is_empty()),
                Err(error) => {
                    tracing::warn!(
                        reason = %error,
                        "GitHub authentication is unavailable; public repositories remain accessible"
                    );
                    None
                }
            },
        };
        let client = reqwest::Client::builder()
            .user_agent("hunker-diff-reviewer")
            .build()
            .map_err(|error| {
                AppError::internal(format!("Could not initialize GitHub HTTP: {error}"))
            })?;
        Ok(Self { client, token })
    }

    pub(super) async fn json<T: DeserializeOwned>(&self, url: &str) -> AppResult<T> {
        self.request(Method::GET, url, "application/vnd.github+json")
            .await?
            .json()
            .await
            .map_err(|_| AppError::upstream("GitHub returned malformed data."))
    }

    pub(super) async fn post_json<B: Serialize + ?Sized, T: DeserializeOwned>(
        &self,
        url: &str,
        body: &B,
    ) -> AppResult<T> {
        self.request_with_json(Method::POST, url, "application/vnd.github+json", body)
            .await?
            .json()
            .await
            .map_err(|_| AppError::upstream("GitHub returned malformed review data."))
    }

    pub(super) async fn post<B: Serialize + ?Sized>(
        &self,
        url: &str,
        accept: &str,
        body: &B,
    ) -> AppResult<reqwest::Response> {
        self.request_with_json(Method::POST, url, accept, body)
            .await
    }

    pub(super) async fn text(&self, url: &str, accept: &str) -> AppResult<String> {
        self.request(Method::GET, url, accept)
            .await?
            .text()
            .await
            .map_err(|_| AppError::upstream("GitHub returned malformed text data."))
    }

    async fn request(
        &self,
        method: Method,
        url: &str,
        accept: &str,
    ) -> AppResult<reqwest::Response> {
        let request = self.authenticated_request(method, url, accept);
        self.send(request).await
    }

    async fn request_with_json<B: Serialize + ?Sized>(
        &self,
        method: Method,
        url: &str,
        accept: &str,
        body: &B,
    ) -> AppResult<reqwest::Response> {
        let request = self.authenticated_request(method, url, accept).json(body);
        self.send(request).await
    }

    fn authenticated_request(
        &self,
        method: Method,
        url: &str,
        accept: &str,
    ) -> reqwest::RequestBuilder {
        let request = self
            .client
            .request(method, url)
            .header(header::ACCEPT, accept)
            .header("x-github-api-version", API_VERSION);
        match &self.token {
            Some(token) => request.bearer_auth(token),
            None => request,
        }
    }

    async fn send(&self, request: reqwest::RequestBuilder) -> AppResult<reqwest::Response> {
        let response = request
            .send()
            .await
            .map_err(|error| AppError::upstream(format!("Could not reach GitHub: {error}")))?;
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status();
        let message = match status.as_u16() {
            404 if self.token.is_none() => {
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
}
