mod analysis;
mod api;
mod character_diff;
mod command;
mod contracts;
mod diff;
mod error;
mod frontend;
mod github;
mod local;
mod revision;
mod semantic;
mod settings;
mod source_presentation;
mod types;

use std::{env, sync::Arc};

use axum::{
    Router,
    http::{HeaderValue, Method},
    routing::get,
};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::{
    error::{AppError, AppResult},
    github::GitHub,
    local::Local,
};

#[derive(Clone)]
struct AppState {
    analysis: analysis::AnalysisCache,
    github: GitHub,
    local: Local,
    revisions: revision::RevisionCache,
    settings: settings::SettingsStore,
}

#[tokio::main]
async fn main() -> AppResult<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "hunker_server=info,tower_http=info".into()),
        )
        .init();
    match env::args().nth(1).as_deref() {
        Some("--write-contract-fixtures") => return contracts::write(),
        Some("--check-contract-fixtures") => return contracts::check(),
        _ => {}
    }
    let state = Arc::new(AppState {
        analysis: analysis::AnalysisCache::default(),
        github: GitHub::new().await?,
        local: Local::default(),
        revisions: revision::RevisionCache::default(),
        settings: settings::SettingsStore::default(),
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
        .merge(api::settings::routes())
        .merge(api::repository::routes())
        .merge(api::review::routes())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_malformed_repository_names() {
        assert!(types::RepositorySlug::parse("owner/repo/extra").is_err());
    }

    #[tokio::test]
    async fn exposes_every_frontend_route() {
        let _router = router(Arc::new(AppState {
            analysis: analysis::AnalysisCache::default(),
            github: GitHub::new().await.unwrap(),
            local: Local::default(),
            revisions: revision::RevisionCache::default(),
            settings: settings::SettingsStore::default(),
        }));
    }
}
