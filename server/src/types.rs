use std::{fmt, num::NonZeroUsize, path::PathBuf, sync::Arc};

use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;

/// Declares a `String` newtype whose only constructor is a normalizing parser,
/// so serde, query extraction, and internal callers share one boundary check.
macro_rules! validated_string {
    ($(#[$meta:meta])* $name:ident, $parse:expr) => {
        $(#[$meta])*
        #[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);

        impl $name {
            pub fn parse(value: impl Into<String>) -> Result<Self, String> {
                let parse: fn(String) -> Result<String, &'static str> = $parse;
                parse(value.into()).map(Self).map_err(str::to_owned)
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl TryFrom<String> for $name {
            type Error = String;

            fn try_from(value: String) -> Result<Self, Self::Error> {
                Self::parse(value)
            }
        }

        impl From<$name> for String {
            fn from(value: $name) -> Self {
                value.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }
    };
}

validated_string!(
    /// A local branch name that is safe to pass as one Git argument.
    BranchName,
    |value| {
        if value.is_empty() || value.starts_with('-') || value.contains(['\0', '\n', '\r']) {
            Err("Choose a valid branch.")
        } else {
            Ok(value)
        }
    }
);

validated_string!(
    /// A full SHA-1 or SHA-256 Git object ID.
    Oid,
    |value| {
        if matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            Ok(value.to_ascii_lowercase())
        } else {
            Err("A full Git object ID is required.")
        }
    }
);

validated_string!(
    /// A possibly abbreviated commit ID as it appears in GitHub commit URLs.
    CommitId,
    |value| {
        if (7..=64).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            Ok(value.to_ascii_lowercase())
        } else {
            Err("Choose a valid commit ID.")
        }
    }
);

validated_string!(
    /// A normalized path inside a repository revision.
    RelativePath,
    |value| {
        let valid = !value.is_empty()
            && !value.starts_with('/')
            && !value.contains(['\0', '\n', '\r'])
            && value
                .split('/')
                .all(|segment| !matches!(segment, "" | "." | ".."));
        if valid {
            Ok(value)
        } else {
            Err("A repository-relative file path is required.")
        }
    }
);

/// User-authored text with surrounding whitespace removed and at least one
/// visible character.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct NonEmptyText(String);

impl NonEmptyText {
    pub fn parse(value: &str) -> Result<Self, String> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            Err("Write some text before posting.".to_owned())
        } else {
            Ok(Self(trimmed.to_owned()))
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for NonEmptyText {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

impl From<NonEmptyText> for String {
    fn from(value: NonEmptyText) -> Self {
        value.0
    }
}

/// A one-based source line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct LineNumber(NonZeroUsize);

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct RepositorySlug {
    owner: String,
    name: String,
}

impl RepositorySlug {
    pub fn new(owner: &str, name: &str) -> Result<Self, String> {
        if valid_segment(owner) && valid_segment(name) {
            Ok(Self {
                owner: owner.to_owned(),
                name: name.to_owned(),
            })
        } else {
            Err("Choose a repository in owner/name format.".to_owned())
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        let (owner, name) = value
            .split_once('/')
            .ok_or_else(|| "Choose a repository in owner/name format.".to_owned())?;
        Self::new(owner, name)
    }

    pub fn owner(&self) -> &str {
        &self.owner
    }

    pub fn name(&self) -> &str {
        &self.name
    }
}

/// GitHub owner and repository names. The first character must be
/// alphanumeric so a name can never be read as a command-line flag.
fn valid_segment(value: &str) -> bool {
    value
        .chars()
        .next()
        .is_some_and(|first| first.is_ascii_alphanumeric())
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

impl TryFrom<String> for RepositorySlug {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

impl From<RepositorySlug> for String {
    fn from(value: RepositorySlug) -> Self {
        value.to_string()
    }
}

impl fmt::Display for RepositorySlug {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}/{}", self.owner, self.name)
    }
}

/// Which configured root owns a local repository: the user's checkout root or
/// Hunker's disposable clone cache.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepositoryRoot {
    Configured,
    Temporary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchMode {
    Literal,
    Regex,
    Fuzzy,
}

/// The pre-image or post-image of a change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Old,
    New,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed {
        #[serde(rename = "previousPath")]
        previous_path: RelativePath,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: RelativePath,
    #[serde(flatten)]
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
    pub patch: String,
}

impl FileChange {
    /// The path this change occupies on one side, or `None` when that side
    /// does not exist (the old side of an addition or new side of a deletion).
    pub fn path_on(&self, side: Side) -> Option<&RelativePath> {
        path_on(&self.path, &self.status, side)
    }
}

#[derive(Debug, Clone)]
pub struct FilePair {
    pub path: RelativePath,
    pub status: FileStatus,
    pub old_text: String,
    pub new_text: String,
}

/// One side of a file at a revision. Binary and non-UTF-8 content cannot be
/// diffed or parsed as text, so it is kept apart rather than failing a review.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Contents {
    Text(String),
    NotText,
}

/// A changed file whose two sides were read: either both are text, or the
/// file is not text and analysis skips it.
#[derive(Debug, Clone)]
pub enum PairRead {
    Text(FilePair),
    NotText(RelativePath),
}

impl PairRead {
    pub fn new(file: &FileChange, old: Contents, new: Contents) -> Self {
        match (old, new) {
            (Contents::Text(old_text), Contents::Text(new_text)) => Self::Text(FilePair {
                path: file.path.clone(),
                status: file.status.clone(),
                old_text,
                new_text,
            }),
            (Contents::NotText, _) | (_, Contents::NotText) => Self::NotText(file.path.clone()),
        }
    }
}

fn path_on<'a>(
    path: &'a RelativePath,
    status: &'a FileStatus,
    side: Side,
) -> Option<&'a RelativePath> {
    match (status, side) {
        (FileStatus::Added, Side::Old) | (FileStatus::Deleted, Side::New) => None,
        (FileStatus::Renamed { previous_path }, Side::Old) => Some(previous_path),
        (FileStatus::Modified | FileStatus::Deleted, Side::Old)
        | (FileStatus::Modified | FileStatus::Added | FileStatus::Renamed { .. }, Side::New) => {
            Some(path)
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRevision {
    pub base_oid: Oid,
    pub head_oid: Oid,
    pub head_ref: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "_tag")]
pub enum ReviewSource {
    Local { path: String },
    GitHub,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDocument {
    pub title: String,
    pub author: String,
    pub base: String,
    pub head: String,
    pub files: Arc<Vec<FileChange>>,
    pub revision: ReviewRevision,
    pub source: ReviewSource,
}

/// An instant from Git or GitHub. It is decoded once from RFC 3339 and sent
/// to the browser as Unix milliseconds, which Elm reads as `Time.Posix`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct Timestamp(i64);

impl Timestamp {
    pub fn parse(value: &str) -> Result<Self, String> {
        let invalid =
            |reason: &dyn fmt::Display| format!("{value} is not an RFC 3339 time: {reason}");
        let instant =
            time::OffsetDateTime::parse(value.trim(), &Rfc3339).map_err(|error| invalid(&error))?;
        i64::try_from(instant.unix_timestamp_nanos() / 1_000_000)
            .map(Self)
            .map_err(|error| invalid(&error))
    }
}

impl<'de> Deserialize<'de> for Timestamp {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(&String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullCommit {
    pub sha: Oid,
    pub message: String,
    pub author: String,
    pub avatar_url: Option<String>,
    pub authored_at: Option<Timestamp>,
    pub html_url: String,
}

#[derive(Debug, Clone)]
pub struct LocalGitRepository {
    pub path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRange {
    pub start_line: usize,
    pub end_line: usize,
    pub start_column: usize,
    pub end_column: usize,
}

impl SourceRange {
    pub fn line_count(&self) -> usize {
        self.end_line.saturating_sub(self.start_line) + 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamps_decode_offsets_into_one_instant() {
        let git = Timestamp::parse("2026-10-28T10:30:25-04:00").unwrap();
        let github = serde_json::from_str::<Timestamp>(r#""2026-10-28T14:30:25Z""#).unwrap();
        assert_eq!(git, github);
        assert_eq!(serde_json::to_string(&git).unwrap(), "1793197825000");
        assert!(Timestamp::parse("yesterday").is_err());
    }

    #[test]
    fn boundary_identifiers_decode_once_into_closed_types() {
        let repository = serde_json::from_str::<RepositorySlug>(r#""acme/demo""#).unwrap();
        assert_eq!(repository.to_string(), "acme/demo");
        assert!(serde_json::from_str::<RepositorySlug>(r#""acme/demo/extra""#).is_err());
        assert!(serde_json::from_str::<RepositorySlug>(r#""acme/..""#).is_err());

        let branch = serde_json::from_str::<BranchName>(r#""feature/typed-boundaries""#).unwrap();
        assert_eq!(branch.as_str(), "feature/typed-boundaries");
        assert!(serde_json::from_str::<BranchName>(r#""""#).is_err());

        assert_eq!(
            serde_json::from_str::<RepositoryRoot>(r#""temporary""#).unwrap(),
            RepositoryRoot::Temporary
        );
        assert!(serde_json::from_str::<RepositoryRoot>(r#""workspace""#).is_err());
        assert_eq!(
            serde_json::from_str::<SearchMode>(r#""regex""#).unwrap(),
            SearchMode::Regex
        );
        assert!(serde_json::from_str::<SearchMode>(r#""semantic""#).is_err());
        assert!(serde_json::from_str::<LineNumber>("0").is_err());
        assert_eq!(
            serde_json::from_str::<NonEmptyText>(r#""  keep this typed  ""#)
                .unwrap()
                .as_str(),
            "keep this typed"
        );
        assert!(serde_json::from_str::<NonEmptyText>(r#""   ""#).is_err());
    }

    #[test]
    fn renamed_files_carry_their_previous_path_on_the_wire() {
        let change = FileChange {
            path: RelativePath::parse("src/new.rs").unwrap(),
            status: FileStatus::Renamed {
                previous_path: RelativePath::parse("src/old.rs").unwrap(),
            },
            additions: 0,
            deletions: 0,
            patch: String::new(),
        };
        assert_eq!(
            serde_json::to_value(&change).unwrap(),
            serde_json::json!({
                "path": "src/new.rs",
                "status": "renamed",
                "previousPath": "src/old.rs",
                "additions": 0,
                "deletions": 0,
                "patch": ""
            })
        );
        assert_eq!(change.path_on(Side::Old).unwrap().as_str(), "src/old.rs");
    }
}
