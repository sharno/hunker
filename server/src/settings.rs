use std::{
    env,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};

#[derive(Clone, Default)]
pub struct SettingsStore {
    writes: Arc<Mutex<()>>,
}

impl SettingsStore {
    pub async fn load(&self) -> AppResult<SettingsDocument> {
        load().await
    }

    pub async fn save(&self, settings: HunkerSettings) -> AppResult<SettingsDocument> {
        // All browser tabs share one settings file. Serializing the atomic
        // replace prevents two requests from writing the same temporary path.
        let _guard = self.writes.lock().await;
        save(settings).await
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HunkerSettings {
    pub repositories_root: String,
    pub cache_root: String,
    pub review_scope: ReviewScope,
    pub view_mode: ViewMode,
    #[serde(flatten)]
    pub diff: DiffSettings,
    pub inline_diff_mode: InlineDiffMode,
    #[serde(flatten)]
    pub interface: InterfaceSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSettings {
    pub ignore_whitespace: bool,
    pub semantic: bool,
    pub syntax_highlighting: bool,
    #[serde(default)]
    pub diff_colors: DiffColors,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DiffColors(bool);

impl Default for DiffColors {
    fn default() -> Self {
        Self(true)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceSettings {
    pub sidebar_collapsed: bool,
    pub show_git_hub_reviews: bool,
    #[serde(default)]
    pub top_bar_collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReviewScope {
    File,
    Full,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ViewMode {
    Unified,
    Split,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InlineDiffMode {
    Token,
    Character,
    Off,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDocument {
    pub settings: HunkerSettings,
    pub config_path: String,
}

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

pub fn resolve_path(value: &str) -> PathBuf {
    if let Some(relative) = value.strip_prefix("~/") {
        home().join(relative)
    } else {
        PathBuf::from(value)
    }
}

pub fn config_path() -> PathBuf {
    env::var("HUNKER_CONFIG_FILE").map_or_else(
        |_| home().join(".config/hunker/settings.json"),
        |value| resolve_path(&value),
    )
}

fn defaults() -> HunkerSettings {
    HunkerSettings {
        repositories_root: env::var("HUNKER_REPOS_ROOT")
            .unwrap_or_else(|_| home().join("src").to_string_lossy().into_owned()),
        cache_root: env::var("HUNKER_CACHE_ROOT")
            .unwrap_or_else(|_| "/tmp/hunker/repositories".to_owned()),
        review_scope: ReviewScope::File,
        view_mode: ViewMode::Split,
        inline_diff_mode: InlineDiffMode::Token,
        diff: DiffSettings {
            ignore_whitespace: true,
            semantic: true,
            syntax_highlighting: true,
            diff_colors: DiffColors::default(),
        },
        interface: InterfaceSettings {
            sidebar_collapsed: false,
            show_git_hub_reviews: true,
            top_bar_collapsed: false,
        },
    }
}

pub async fn load() -> AppResult<SettingsDocument> {
    let path = config_path();
    let settings = if path.exists() {
        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|_| AppError::internal(format!("Could not read {}.", path.display())))?;
        serde_json::from_str(&content).map_err(|error| {
            AppError::internal(format!("Hunker’s settings file is invalid: {error}"))
        })?
    } else {
        defaults()
    };
    Ok(SettingsDocument {
        settings,
        config_path: path.to_string_lossy().into_owned(),
    })
}

pub async fn save(settings: HunkerSettings) -> AppResult<SettingsDocument> {
    let path = config_path();
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|_| AppError::internal(format!("Could not create {}.", parent.display())))?;
    let temporary = path.with_extension("json.tmp");
    let mut content = serde_json::to_string_pretty(&settings)
        .map_err(|error| AppError::internal(format!("Could not encode settings: {error}")))?;
    content.push('\n');
    tokio::fs::write(&temporary, content)
        .await
        .map_err(|_| AppError::internal(format!("Could not write {}.", temporary.display())))?;
    tokio::fs::rename(&temporary, &path)
        .await
        .map_err(|_| AppError::internal(format!("Could not replace {}.", path.display())))?;
    Ok(SettingsDocument {
        settings,
        config_path: path.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn settings_remain_a_flat_frontend_contract() {
        let settings = defaults();
        let repositories_root = settings.repositories_root.clone();
        let cache_root = settings.cache_root.clone();
        let encoded = serde_json::to_value(settings).unwrap();
        assert_eq!(
            encoded,
            json!({
                "repositoriesRoot": repositories_root,
                "cacheRoot": cache_root,
                "reviewScope": "file",
                "viewMode": "split",
                "ignoreWhitespace": true,
                "semantic": true,
                "inlineDiffMode": "token",
                "syntaxHighlighting": true,
                "diffColors": true,
                "sidebarCollapsed": false,
                "showGitHubReviews": true,
                "topBarCollapsed": false
            })
        );
    }

    #[test]
    fn new_visual_settings_preserve_existing_configuration_defaults() {
        let decoded: HunkerSettings = serde_json::from_value(json!({
            "repositoriesRoot": "/tmp/src",
            "cacheRoot": "/tmp/cache",
            "reviewScope": "file",
            "viewMode": "split",
            "ignoreWhitespace": true,
            "semantic": true,
            "inlineDiffMode": "token",
            "syntaxHighlighting": true,
            "sidebarCollapsed": false,
            "showGitHubReviews": true
        }))
        .unwrap();

        assert!(decoded.diff.diff_colors.0);
        assert!(!decoded.interface.top_bar_collapsed);
    }
}
