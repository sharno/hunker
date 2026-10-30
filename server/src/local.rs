use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tokio::sync::Mutex;

use fff_search::SharedFilePicker;

use crate::{
    github::PullNumber,
    settings::SettingsStore,
    source_presentation::SourcePresentationResult,
    types::{BranchName, LocalGitRepository, Oid, RepositoryRoot, Timestamp},
};

const MAX_FILE_CHARACTERS: usize = 500_000;
const FETCH_INTERVAL_MS: u64 = 120_000;
const DEEPEN_STEPS: [usize; 4] = [32, 128, 512, 2_048];

mod catalog;
mod mutations;
mod objects;
mod review_backing;
mod search;
mod source_control;

#[derive(Clone)]
pub struct Local {
    settings: SettingsStore,
    fetches: Arc<Mutex<HashMap<(PathBuf, PullNumber), u64>>>,
    repository_locks: Arc<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>>,
    fuzzy_indexes: Arc<Mutex<HashMap<PathBuf, SharedFilePicker>>>,
}

impl Local {
    pub fn new(settings: SettingsStore) -> Self {
        Self {
            settings,
            fetches: Arc::default(),
            repository_locks: Arc::default(),
            fuzzy_indexes: Arc::default(),
        }
    }
}

impl Local {
    /// One lock per checkout serializes fetches and checkout mutations.
    async fn repository_lock(&self, path: &Path) -> Arc<Mutex<()>> {
        let mut locks = self.repository_locks.lock().await;
        Arc::clone(locks.entry(path.to_path_buf()).or_default())
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRepositories {
    pub configured_root: String,
    pub temporary_root: String,
    pub repositories: Vec<LocalRepositorySummary>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRepositorySummary {
    pub owner: String,
    pub name: String,
    pub path: String,
    pub source: RepositoryRoot,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryFile {
    pub path: String,
    pub size: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryFileContent {
    pub path: String,
    pub content: String,
    pub truncated: bool,
    pub presentation: SourcePresentationResult,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositorySearchMatch {
    pub path: String,
    pub line: usize,
    pub column: usize,
    pub line_content: String,
    pub context_before: Vec<String>,
    pub context_after: Vec<String>,
    pub ranges: Vec<[usize; 2]>,
}
#[derive(Debug, Serialize)]
pub struct SearchResults {
    pub files: Vec<RepositoryFile>,
    pub matches: Vec<RepositorySearchMatch>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryCommit {
    pub sha: Oid,
    pub parents: Vec<Oid>,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: Timestamp,
    pub subject: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum History {
    Shallow,
    Complete,
}
#[derive(Debug, Serialize)]
pub struct RepositoryCommits {
    #[serde(rename = "ref")]
    pub reference: Oid,
    pub history: History,
    pub commits: Vec<RepositoryCommit>,
}
/// Where a branch exists. A branch is listed only when it exists somewhere.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BranchPresence {
    Local,
    Remote,
    Both,
}
#[derive(Debug, Clone, Serialize)]
pub struct Branch {
    pub name: BranchName,
    pub presence: BranchPresence,
}
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "_tag")]
pub enum Checkout {
    TrackingBranch {
        name: BranchName,
        oid: Oid,
        upstream: String,
        ahead: usize,
        behind: usize,
    },
    UntrackedBranch {
        name: BranchName,
        oid: Oid,
    },
    DetachedHead {
        oid: Oid,
    },
}
/// What Hunker last learned from `origin` while producing a status. Opening
/// a repository reads only local Git, so its status has not checked yet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "_tag")]
pub enum RemoteState {
    NotChecked,
    Current {
        #[serde(rename = "checkedAt")]
        checked_at: u64,
    },
    Unavailable {
        #[serde(rename = "checkedAt")]
        checked_at: u64,
        error: String,
    },
}
#[derive(Debug, Clone, Serialize)]
pub struct WorkingTreeChanges {
    pub staged: usize,
    pub unstaged: usize,
    pub untracked: usize,
}
#[derive(Debug, Clone, Serialize)]
pub struct SourceControlStatus {
    pub path: String,
    pub checkout: Checkout,
    pub branches: Vec<Branch>,
    pub changes: WorkingTreeChanges,
    pub remote: RemoteState,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullResult {
    pub pulled_commits: usize,
}
pub struct PullRevision {
    pub repository: LocalGitRepository,
    pub latest_head_oid: Oid,
    pub checked_at: u64,
}
