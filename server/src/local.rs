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
    command, error::AppResult, source_presentation::SourcePresentationResult,
    types::LocalGitRepository,
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

#[derive(Clone, Default)]
pub struct Local {
    fetches: Arc<Mutex<HashMap<String, u64>>>,
    repository_locks: Arc<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>>,
    fuzzy_indexes: Arc<Mutex<HashMap<PathBuf, SharedFilePicker>>>,
}

fn valid_segment(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

pub fn valid_oid(value: &str) -> bool {
    (40..=64).contains(&value.len()) && value.chars().all(|character| character.is_ascii_hexdigit())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

async fn git_result(path: &Path, args: &[&str]) -> AppResult<(bool, String, i32)> {
    let output = command::output("git", args, Some(path)).await?;
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok((
        output.status.success(),
        text,
        output.status.code().unwrap_or(-1),
    ))
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
    pub source: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryFile {
    pub path: String,
    pub size: u64,
    pub git_status: String,
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
    pub definition: bool,
}
#[derive(Debug, Serialize)]
pub struct SearchResults {
    pub files: Vec<RepositoryFile>,
    pub matches: Vec<RepositorySearchMatch>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryCommit {
    pub sha: String,
    pub parents: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub authored_at: String,
    pub subject: String,
}
#[derive(Debug, Serialize)]
pub struct RepositoryCommits {
    #[serde(rename = "ref")]
    pub reference: String,
    pub shallow: bool,
    pub commits: Vec<RepositoryCommit>,
}
#[derive(Debug, Clone, Serialize)]
pub struct Branch {
    pub name: String,
    pub local: bool,
    pub remote: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "_tag")]
pub enum Checkout {
    TrackingBranch {
        name: String,
        oid: String,
        upstream: String,
        ahead: usize,
        behind: usize,
    },
    UntrackedBranch {
        name: String,
        oid: String,
    },
    DetachedHead {
        oid: String,
    },
}
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "_tag")]
pub enum RemoteState {
    RemoteCurrent {
        #[serde(rename = "checkedAt")]
        checked_at: u64,
    },
    RemoteUnavailable {
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
    pub pinned_head_oid: String,
    pub latest_head_oid: String,
    pub checked_at: u64,
}

pub(crate) fn source_control_contract_fixture() -> SourceControlStatus {
    SourceControlStatus {
        path: "/Users/example/src/hunker".to_owned(),
        checkout: Checkout::TrackingBranch {
            name: "main".to_owned(),
            oid: "2222222222222222222222222222222222222222".to_owned(),
            upstream: "origin/main".to_owned(),
            ahead: 1,
            behind: 2,
        },
        branches: vec![Branch {
            name: "main".to_owned(),
            local: true,
            remote: true,
        }],
        changes: WorkingTreeChanges {
            staged: 1,
            unstaged: 2,
            untracked: 3,
        },
        remote: RemoteState::RemoteCurrent {
            checked_at: 1_786_363_200_000,
        },
    }
}
