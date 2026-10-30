mod analysis;
mod api;
mod cache;
mod character_diff;
mod command;
mod contracts;
mod diff;
mod error;
mod frontend;
mod github;
mod language;
mod local;
mod revision;
mod semantic;
mod settings;
mod source_presentation;
mod types;

use std::{env, sync::Arc};

use axum::{
    Router,
    extract::Request,
    http::header,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{any, get},
};
use tower_http::trace::TraceLayer;

use crate::{
    error::{AppError, AppResult},
    github::GitHub,
    local::Local,
    settings::SettingsStore,
};

const DEFAULT_PORT: u16 = 5173;

#[derive(Clone)]
struct AppState {
    analysis: analysis::AnalysisCache,
    github: GitHub,
    local: Local,
    revisions: revision::RevisionCache,
    settings: SettingsStore,
}

impl AppState {
    async fn new() -> AppResult<Self> {
        let settings = SettingsStore::from_environment();
        Ok(Self {
            analysis: analysis::cache(),
            github: GitHub::new().await?,
            local: Local::new(settings.clone()),
            revisions: revision::cache(),
            settings,
        })
    }
}

enum Cli {
    Serve,
    WriteContractFixtures,
    CheckContractFixtures,
}

impl Cli {
    fn parse(argument: Option<&str>) -> AppResult<Self> {
        match argument {
            None => Ok(Self::Serve),
            Some("--write-contract-fixtures") => Ok(Self::WriteContractFixtures),
            Some("--check-contract-fixtures") => Ok(Self::CheckContractFixtures),
            Some(other) => Err(AppError::bad_request(format!(
                "Unknown argument {other}. Use --write-contract-fixtures or --check-contract-fixtures."
            ))),
        }
    }
}

#[tokio::main]
async fn main() -> AppResult<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "hunker_server=info,tower_http=info".into()),
        )
        .init();
    match Cli::parse(env::args().nth(1).as_deref())? {
        Cli::WriteContractFixtures => contracts::write(),
        Cli::CheckContractFixtures => contracts::check(),
        Cli::Serve => serve().await,
    }
}

async fn serve() -> AppResult<()> {
    let port = match env::var("HUNKER_PORT") {
        Ok(value) => value.parse::<u16>().map_err(|_| {
            AppError::bad_request(format!("HUNKER_PORT must be a port number, not {value}."))
        })?,
        Err(_) => DEFAULT_PORT,
    };
    let app = router(Arc::new(AppState::new().await?));
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
        .merge(api::settings::routes())
        .merge(api::repository::routes())
        .merge(api::review::routes())
        .route(
            "/api/{*rest}",
            any(|| async { AppError::not_found("Hunker has no API at this path.") }),
        )
        .route("/assets/app.js", get(frontend::javascript))
        .route("/assets/app.css", get(frontend::stylesheet))
        .route("/assets/viewport.js", get(frontend::viewport))
        .route("/assets/time.js", get(frontend::time))
        .fallback(get(frontend::index))
        .layer(middleware::from_fn(local_host_only))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// The API acts with the user's GitHub credential, so only answer requests
/// addressed to this machine. This blocks DNS-rebinding pages from driving it.
async fn local_host_only(request: Request, next: Next) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .map(host_name);
    match host {
        Some("localhost" | "127.0.0.1" | "[::1]") => next.run(request).await,
        Some(_) | None => {
            AppError::bad_request("Hunker only serves requests addressed to localhost.")
                .into_response()
        }
    }
}

fn host_name(host: &str) -> &str {
    if host.starts_with('[') {
        host.split_once(']')
            .map_or(host, |(name, _)| &host[..=name.len()])
    } else {
        host.split_once(':').map_or(host, |(name, _)| name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_command_line_arguments() {
        assert!(matches!(Cli::parse(None), Ok(Cli::Serve)));
        assert!(Cli::parse(Some("--chekc-contract-fixtures")).is_err());
    }

    #[test]
    fn reads_host_names_without_ports() {
        assert_eq!(host_name("localhost:5174"), "localhost");
        assert_eq!(host_name("[::1]:5173"), "[::1]");
        assert_eq!(host_name("evil.example"), "evil.example");
    }

    #[tokio::test]
    async fn exposes_every_frontend_route() {
        let _router = router(Arc::new(AppState::new().await.unwrap()));
    }
}
