use serde::Deserialize;

use crate::{
    error::{AppError, AppResult},
    types::{
        Contents, FileChange, Oid, PairRead, PullCommit, RelativePath, RepositorySlug,
        ReviewRevision, Side,
    },
};

use super::{GitHub, GitHubChange, GitHubTarget, PullTarget, encode};

const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 100;

#[derive(Debug, Clone)]
pub struct ReviewMetadata {
    pub title: String,
    pub author: String,
    pub base: String,
    pub head: String,
    pub revision: ReviewRevision,
}

impl GitHub {
    /// Resolves a review's title, labels, and immutable revision. The base
    /// OID is the merge base, the commit GitHub diffs against, so file pairs
    /// and local diffs show exactly the reviewed change.
    pub async fn metadata(&self, target: &GitHubTarget) -> AppResult<ReviewMetadata> {
        let repository = &target.repository;
        match &target.change {
            GitHubChange::Pull(_) => {
                let value: PullMetadataResponse = self.json(&target.api_url()).await?;
                let base_oid = self
                    .merge_base(repository, value.base.sha.as_str(), value.head.sha.as_str())
                    .await?;
                Ok(ReviewMetadata {
                    title: value.title,
                    author: value
                        .user
                        .map_or_else(|| "GitHub".to_owned(), |user| user.login),
                    base: value.base.reference,
                    head: value.head.reference.clone(),
                    revision: ReviewRevision {
                        base_oid,
                        head_oid: value.head.sha,
                        head_ref: value.head.reference,
                    },
                })
            }
            GitHubChange::Compare(range) => {
                let (base_oid, head_oid) = futures::try_join!(
                    self.merge_base(repository, &range.base, &range.head),
                    self.commit_oid(repository, &range.head),
                )?;
                Ok(ReviewMetadata {
                    title: range.to_string(),
                    author: "GitHub".to_owned(),
                    base: range.base.clone(),
                    head: range.head.clone(),
                    revision: ReviewRevision {
                        base_oid,
                        head_oid,
                        head_ref: range.head.clone(),
                    },
                })
            }
            GitHubChange::Commit(_) => {
                let value: CommitMetadataResponse = self.json(&target.api_url()).await?;
                let base_oid = value
                    .parents
                    .into_iter()
                    .next()
                    .map(|parent| parent.sha)
                    .ok_or_else(|| {
                        AppError::bad_request("Root commits have no parent to compare against.")
                    })?;
                Ok(ReviewMetadata {
                    title: value
                        .commit
                        .message
                        .lines()
                        .next()
                        .unwrap_or_default()
                        .to_owned(),
                    author: author(value.author.as_ref(), value.commit.author.as_ref()),
                    base: base_oid.to_string(),
                    head: value.sha.to_string(),
                    revision: ReviewRevision {
                        base_oid,
                        head_ref: value.sha.to_string(),
                        head_oid: value.sha,
                    },
                })
            }
        }
    }

    async fn merge_base(
        &self,
        repository: &RepositorySlug,
        base: &str,
        head: &str,
    ) -> AppResult<Oid> {
        let value: CompareMetadataResponse = self
            .json(&format!(
                "https://api.github.com/repos/{repository}/compare/{}...{}?per_page=1",
                encode(base),
                encode(head)
            ))
            .await?;
        Ok(value.merge_base_commit.sha)
    }

    async fn commit_oid(&self, repository: &RepositorySlug, reference: &str) -> AppResult<Oid> {
        let raw = self
            .text(
                &format!(
                    "https://api.github.com/repos/{repository}/commits/{}",
                    encode(reference)
                ),
                "application/vnd.github.sha",
            )
            .await?;
        Oid::parse(raw.trim()).map_err(AppError::upstream)
    }

    pub async fn revision_diff(
        &self,
        repository: &RepositorySlug,
        base: &Oid,
        head: &Oid,
    ) -> AppResult<String> {
        self.text(
            &format!("https://api.github.com/repos/{repository}/compare/{base}...{head}"),
            "application/vnd.github.diff",
        )
        .await
    }

    pub async fn file_pair(
        &self,
        repository: &RepositorySlug,
        base: &Oid,
        head: &Oid,
        file: &FileChange,
    ) -> AppResult<PairRead> {
        let (old, new) = futures::try_join!(
            self.contents(repository, file.path_on(Side::Old), base),
            self.contents(repository, file.path_on(Side::New), head),
        )?;
        Ok(PairRead::new(file, old, new))
    }

    async fn contents(
        &self,
        repository: &RepositorySlug,
        path: Option<&RelativePath>,
        reference: &Oid,
    ) -> AppResult<Contents> {
        let Some(path) = path else {
            return Ok(Contents::Text(String::new()));
        };
        let encoded_path = path
            .as_str()
            .split('/')
            .map(encode)
            .collect::<Vec<_>>()
            .join("/");
        let bytes = self
            .bytes(
                &format!(
                    "https://api.github.com/repos/{repository}/contents/{encoded_path}?ref={reference}"
                ),
                "application/vnd.github.raw+json",
            )
            .await?;
        Ok(String::from_utf8(bytes).map_or(Contents::NotText, Contents::Text))
    }

    pub async fn pull_commits(&self, target: &PullTarget) -> AppResult<Vec<PullCommit>> {
        let commits = self
            .paged::<PullCommitResponse>(
                |page| {
                    format!(
                        "https://api.github.com/repos/{}/pulls/{}/commits?per_page={PAGE_SIZE}&page={page}",
                        target.repository, target.number
                    )
                },
                PAGE_SIZE,
                MAX_PAGES,
            )
            .await?;
        Ok(commits.into_iter().map(PullCommit::from).collect())
    }
}

#[derive(Deserialize)]
struct User {
    login: String,
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
struct CommitAuthor {
    name: String,
    date: Option<String>,
}

#[derive(Deserialize)]
struct GitRef {
    #[serde(rename = "ref")]
    reference: String,
    sha: Oid,
}

#[derive(Deserialize)]
struct PullMetadataResponse {
    title: String,
    user: Option<User>,
    base: GitRef,
    head: GitRef,
}

#[derive(Deserialize)]
struct Sha {
    sha: Oid,
}

#[derive(Deserialize)]
struct CompareMetadataResponse {
    merge_base_commit: Sha,
}

#[derive(Deserialize)]
struct CommitDetails {
    message: String,
    author: Option<CommitAuthor>,
}

#[derive(Deserialize)]
struct CommitMetadataResponse {
    sha: Oid,
    commit: CommitDetails,
    author: Option<User>,
    parents: Vec<Sha>,
}

#[derive(Deserialize)]
struct PullCommitResponse {
    sha: Oid,
    commit: CommitDetails,
    author: Option<User>,
    html_url: String,
}

impl From<PullCommitResponse> for PullCommit {
    fn from(value: PullCommitResponse) -> Self {
        Self {
            sha: value.sha,
            author: author(value.author.as_ref(), value.commit.author.as_ref()),
            avatar_url: value.author.and_then(|user| user.avatar_url),
            authored_at: value.commit.author.and_then(|entry| entry.date),
            message: value.commit.message,
            html_url: value.html_url,
        }
    }
}

fn author(user: Option<&User>, commit: Option<&CommitAuthor>) -> String {
    user.map(|value| value.login.clone())
        .or_else(|| commit.map(|value| value.name.clone()))
        .unwrap_or_else(|| "GitHub user".to_owned())
}
