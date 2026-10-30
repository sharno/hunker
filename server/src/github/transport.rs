use std::env;

use futures::{StreamExt, stream};
use reqwest::{Method, StatusCode, header};
use serde::{Serialize, de::DeserializeOwned};

use crate::{
    command,
    error::{AppError, AppResult, ErrorCode},
};

const API_VERSION: &str = "2022-11-28";

#[derive(Clone)]
enum Credential {
    Anonymous,
    Token(String),
}

impl Credential {
    fn from_token(value: &str) -> Option<Self> {
        let token = value.trim();
        (!token.is_empty()).then(|| Self::Token(token.to_owned()))
    }

    async fn discover() -> Self {
        let configured = env::var("GITHUB_TOKEN")
            .or_else(|_| env::var("GH_TOKEN"))
            .ok()
            .and_then(|value| Self::from_token(&value));
        if let Some(credential) = configured {
            return credential;
        }
        match command::checked("gh", &["auth", "token"], None).await {
            Ok(value) => Self::from_token(&value).unwrap_or(Self::Anonymous),
            Err(error) => {
                tracing::warn!(
                    reason = %error,
                    "GitHub authentication is unavailable; public repositories remain accessible"
                );
                Self::Anonymous
            }
        }
    }
}

#[derive(Clone)]
pub struct GitHub {
    client: reqwest::Client,
    credential: Credential,
}

impl GitHub {
    pub async fn new() -> AppResult<Self> {
        let credential = Credential::discover().await;
        let client = reqwest::Client::builder()
            .user_agent("hunker-diff-reviewer")
            .build()
            .map_err(|error| {
                AppError::internal(format!("Could not initialize GitHub HTTP: {error}"))
            })?;
        Ok(Self { client, credential })
    }

    pub(super) async fn json<T: DeserializeOwned>(&self, url: &str) -> AppResult<T> {
        self.request(Method::GET, url, "application/vnd.github+json")
            .await?
            .json()
            .await
            .map_err(|_| AppError::upstream("GitHub returned malformed data."))
    }

    /// Reads a page-numbered REST collection. A short page is GitHub's
    /// end-of-list marker; `max_pages` bounds runaway lists.
    pub(super) async fn paged<T: DeserializeOwned>(
        &self,
        page_url: impl Fn(usize) -> String,
        page_size: usize,
        max_pages: usize,
    ) -> AppResult<Vec<T>> {
        let page_url = &page_url;
        let pages = stream::unfold(Some(1), |next_page| async move {
            let page = next_page?;
            let values = self.json::<Vec<T>>(&page_url(page)).await;
            let following = match &values {
                Ok(values) if values.len() == page_size && page < max_pages => Some(page + 1),
                Ok(_) | Err(_) => None,
            };
            Some((values, following))
        })
        .collect::<Vec<_>>()
        .await;
        pages
            .into_iter()
            .collect::<AppResult<Vec<_>>>()
            .map(|pages| pages.into_iter().flatten().collect())
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

    pub(super) async fn bytes(&self, url: &str, accept: &str) -> AppResult<Vec<u8>> {
        self.request(Method::GET, url, accept)
            .await?
            .bytes()
            .await
            .map(|bytes| bytes.to_vec())
            .map_err(|error| AppError::upstream(format!("GitHub stopped sending data: {error}")))
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
        match &self.credential {
            Credential::Token(token) => request.bearer_auth(token),
            Credential::Anonymous => request,
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
        Err(rejection(response.status(), &self.credential))
    }
}

fn rejection(status: StatusCode, credential: &Credential) -> AppError {
    match (status, credential) {
        (StatusCode::NOT_FOUND, Credential::Anonymous) => AppError::not_found(
            "That change may be private. Run gh auth login or set GITHUB_TOKEN.",
        ),
        (StatusCode::NOT_FOUND, Credential::Token(_)) => AppError::not_found(
            "That change could not be found or your GitHub account cannot access it.",
        ),
        (StatusCode::UNAUTHORIZED, _) => AppError::new(
            ErrorCode::Unauthorized,
            "GitHub rejected the local credential. Run gh auth login again.",
        ),
        (StatusCode::FORBIDDEN, _) => AppError::new(
            ErrorCode::Unauthorized,
            "GitHub denied this request. Check that the local token has pull-request access and try again.",
        ),
        (StatusCode::UNPROCESSABLE_ENTITY, _) => AppError::bad_request(
            "GitHub rejected this review action. Refresh the PR and try again.",
        ),
        _ => AppError::upstream("GitHub returned an error. Try again in a moment."),
    }
}
