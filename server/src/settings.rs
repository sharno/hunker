use std::{
    env,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::{
    error::{AppError, AppResult},
    types::{RepositoryRoot, RepositorySlug},
};

/// Owns the one settings file. Environment and home-directory lookups happen
/// once in [`SettingsStore::from_environment`]; everything else is driven by
/// the values captured here.
#[derive(Clone)]
pub struct SettingsStore {
    path: PathBuf,
    home: PathBuf,
    defaults: Arc<HunkerSettings>,
    writes: Arc<Mutex<()>>,
}

impl SettingsStore {
    pub fn from_environment() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let path = env::var("HUNKER_CONFIG_FILE").map_or_else(
            |_| home.join(".config/hunker/settings.json"),
            |value| resolve_path(&home, &value),
        );
        let defaults = defaults(
            env::var("HUNKER_REPOS_ROOT")
                .unwrap_or_else(|_| home.join("src").to_string_lossy().into_owned()),
            env::var("HUNKER_CACHE_ROOT").unwrap_or_else(|_| "/tmp/hunker/repositories".to_owned()),
        );
        Self {
            path,
            home,
            defaults: Arc::new(defaults),
            writes: Arc::new(Mutex::new(())),
        }
    }

    pub async fn load(&self) -> AppResult<SettingsDocument> {
        let settings = match tokio::fs::read_to_string(&self.path).await {
            Ok(content) => serde_json::from_str(&content).map_err(|error| {
                AppError::internal(format!("Hunker’s settings file is invalid: {error}"))
            })?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                self.defaults.as_ref().clone()
            }
            Err(_) => {
                return Err(AppError::internal(format!(
                    "Could not read {}.",
                    self.path.display()
                )));
            }
        };
        Ok(self.document(settings))
    }

    pub async fn roots(&self) -> AppResult<RepositoryRoots> {
        let settings = self.load().await?.settings;
        Ok(RepositoryRoots {
            configured: resolve_path(&self.home, &settings.repositories_root),
            temporary: resolve_path(&self.home, &settings.cache_root),
        })
    }

    pub async fn save(&self, settings: HunkerSettings) -> AppResult<SettingsDocument> {
        // All browser tabs share one settings file. Serializing the atomic
        // replace prevents two requests from writing the same temporary path.
        let _guard = self.writes.lock().await;
        let parent = self.path.parent().unwrap_or_else(|| Path::new("."));
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|_| AppError::internal(format!("Could not create {}.", parent.display())))?;
        let temporary = self.path.with_extension("json.tmp");
        let content = serde_json::to_string_pretty(&settings)
            .map_err(|error| AppError::internal(format!("Could not encode settings: {error}")))?;
        tokio::fs::write(&temporary, format!("{content}\n"))
            .await
            .map_err(|_| AppError::internal(format!("Could not write {}.", temporary.display())))?;
        tokio::fs::rename(&temporary, &self.path)
            .await
            .map_err(|_| {
                AppError::internal(format!("Could not replace {}.", self.path.display()))
            })?;
        Ok(self.document(settings))
    }

    fn document(&self, settings: HunkerSettings) -> SettingsDocument {
        SettingsDocument {
            settings,
            config_path: self.path.to_string_lossy().into_owned(),
        }
    }
}

/// The two directories Hunker discovers repositories in, resolved from the
/// current settings.
#[derive(Debug, Clone)]
pub struct RepositoryRoots {
    configured: PathBuf,
    temporary: PathBuf,
}

impl RepositoryRoots {
    #[cfg(test)]
    pub fn new(configured: PathBuf, temporary: PathBuf) -> Self {
        Self {
            configured,
            temporary,
        }
    }

    pub fn path(&self, root: RepositoryRoot) -> &Path {
        match root {
            RepositoryRoot::Configured => &self.configured,
            RepositoryRoot::Temporary => &self.temporary,
        }
    }

    /// Where a clone of `repository` is created under `root`. Configured
    /// checkouts are flat (`~/src/name`); the cache is namespaced by owner.
    pub fn clone_target(&self, repository: &RepositorySlug, root: RepositoryRoot) -> PathBuf {
        match root {
            RepositoryRoot::Configured => self.configured.join(repository.name()),
            RepositoryRoot::Temporary => self
                .temporary
                .join(repository.owner())
                .join(repository.name()),
        }
    }

    /// Every location a local copy of `repository` may occupy, in lookup order.
    pub fn candidates(&self, repository: &RepositorySlug) -> [PathBuf; 3] {
        [
            self.clone_target(repository, RepositoryRoot::Configured),
            self.configured
                .join(repository.owner())
                .join(repository.name()),
            self.clone_target(repository, RepositoryRoot::Temporary),
        ]
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

fn resolve_path(home: &Path, value: &str) -> PathBuf {
    value
        .strip_prefix("~/")
        .map_or_else(|| PathBuf::from(value), |relative| home.join(relative))
}

fn defaults(repositories_root: String, cache_root: String) -> HunkerSettings {
    HunkerSettings {
        repositories_root,
        cache_root,
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn settings_remain_a_flat_frontend_contract() {
        let settings = defaults("/tmp/src".to_owned(), "/tmp/cache".to_owned());
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
