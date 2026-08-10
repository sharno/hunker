use std::sync::Arc;

use axum::{Json, Router, extract::State, routing::get};
use serde::Deserialize;

use crate::{AppState, error::AppResult, settings};

pub fn routes() -> Router<Arc<AppState>> {
    Router::new().route("/api/settings", get(get_settings).put(save_settings))
}

async fn get_settings(
    State(state): State<Arc<AppState>>,
) -> AppResult<Json<settings::SettingsDocument>> {
    Ok(Json(state.settings.load().await?))
}

#[derive(Deserialize)]
struct SettingsBody {
    settings: settings::HunkerSettings,
}

async fn save_settings(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SettingsBody>,
) -> AppResult<Json<settings::SettingsDocument>> {
    Ok(Json(state.settings.save(body.settings).await?))
}
