use std::sync::Arc;

use axum::{Json, Router, routing::get};
use serde::Serialize;

use crate::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/about", get(about))
}

/// Identifies a running Hunker to local clients. The browser extension only
/// redirects GitHub links while this answers, because another development
/// server can own the same port.
#[derive(Serialize)]
struct About {
    application: &'static str,
    version: &'static str,
}

async fn about() -> Json<About> {
    Json(About {
        application: "hunker",
        version: env!("CARGO_PKG_VERSION"),
    })
}
