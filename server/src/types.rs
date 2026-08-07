use std::{fmt, path::PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RepositorySlug {
    pub owner: String,
    pub name: String,
}

impl RepositorySlug {
    pub fn parse(value: &str) -> Result<Self, String> {
        let Some((owner, name)) = value.split_once('/') else {
            return Err("Choose a repository in owner/name format.".to_owned());
        };
        if owner.is_empty() || name.is_empty() || name.contains('/') {
            return Err("Choose a repository in owner/name format.".to_owned());
        }
        Ok(Self {
            owner: owner.to_owned(),
            name: name.to_owned(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Oid(String);

impl Oid {
    pub fn parse(value: String) -> Result<Self, String> {
        if value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            Ok(Self(value))
        } else {
            Err("A full 40-character Git object ID is required.".to_owned())
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for Oid {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(value)
    }
}

impl From<Oid> for String {
    fn from(value: Oid) -> Self {
        value.0
    }
}

impl fmt::Display for Oid {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct RelativePath(String);

impl RelativePath {
    pub fn parse(value: String) -> Result<Self, String> {
        let valid = !value.is_empty()
            && !value.starts_with('/')
            && !value.contains('\0')
            && value
                .split('/')
                .all(|segment| !matches!(segment, "" | "." | ".."));
        if valid {
            Ok(Self(value))
        } else {
            Err("A repository-relative file path is required.".to_owned())
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for RelativePath {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(value)
    }
}

impl From<RelativePath> for String {
    fn from(value: RelativePath) -> Self {
        value.0
    }
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
