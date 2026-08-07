use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RepositoryId {
    pub owner: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub previous_path: Option<String>,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
    pub patch: String,
}

#[derive(Debug, Clone)]
pub struct FilePair {
    pub path: String,
    pub previous_path: Option<String>,
    pub status: FileStatus,
    pub old_text: String,
    pub new_text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "_tag")]
pub enum ReviewBacking {
    Local {
        #[serde(rename = "baseOid")]
        base_oid: String,
        #[serde(rename = "headOid")]
        head_oid: String,
        #[serde(rename = "headRef")]
        head_ref: String,
        path: String,
    },
    GitHub {
        #[serde(rename = "baseOid")]
        base_oid: String,
        #[serde(rename = "headOid")]
        head_oid: String,
        #[serde(rename = "headRef")]
        head_ref: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDocument {
    pub title: String,
    pub repository: String,
    pub number: String,
    pub author: String,
    pub base: String,
    pub head: String,
    pub url: String,
    pub files: Vec<FileChange>,
    pub backing: ReviewBacking,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullCommit {
    pub sha: String,
    pub message: String,
    pub author: String,
    pub avatar_url: String,
    pub authored_at: String,
    pub html_url: String,
}

#[derive(Debug, Clone)]
pub struct LocalGitRepository {
    pub path: PathBuf,
    pub kind: &'static str,
}

#[derive(Debug, Clone, Copy)]
pub struct PinnedRefs<'a> {
    pub base: &'a str,
    pub head: &'a str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRange {
    pub start_line: usize,
    pub end_line: usize,
    pub start_column: usize,
    pub end_column: usize,
}
