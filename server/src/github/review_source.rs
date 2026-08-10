use serde::Deserialize;

use crate::{
    error::{AppError, AppResult},
    types::{FilePair, FileStatus, PullCommit},
};

use super::{GitHub, GitHubTarget, encode};

#[derive(Debug, Clone)]
pub struct ReviewMetadata {
    pub title: String,
    pub repository: String,
    pub number: String,
    pub author: String,
    pub base: String,
    pub head: String,
    pub url: String,
    pub base_oid: String,
    pub head_oid: String,
    pub head_ref: String,
}

impl GitHub {
    pub async fn metadata(&self, target: &GitHubTarget) -> AppResult<ReviewMetadata> {
        match target {
            GitHubTarget::Pull {
                owner,
                repo,
                number,
            } => {
                let value: PullMetadataResponse = self.json(&target.api_url()).await?;
                Ok(ReviewMetadata {
                    title: value.title,
                    repository: format!("{owner}/{repo}"),
                    number: number.clone(),
                    author: value
                        .user
                        .map_or_else(|| "GitHub".to_owned(), |user| user.login),
                    base: value.base.reference,
                    head: value.head.reference.clone(),
                    url: target.web_url(),
                    base_oid: value.base.sha,
                    head_oid: value.head.sha,
                    head_ref: value.head.reference,
                })
            }
            GitHubTarget::Compare { owner, repo, range } => {
                let value: CompareMetadataResponse = self.json(&target.api_url()).await?;
                let (base, head) = range.split_once("...").unwrap_or(("base", "head"));
                let base_oid = value.base_commit.sha;
                Ok(ReviewMetadata {
                    title: range.clone(),
                    repository: format!("{owner}/{repo}"),
                    number: "compare".to_owned(),
                    author: "GitHub".to_owned(),
                    base: base.to_owned(),
                    head: head.to_owned(),
                    url: target.web_url(),
                    base_oid: base_oid.clone(),
                    head_oid: value
                        .commits
                        .last()
                        .map_or_else(|| base_oid.clone(), |commit| commit.sha.clone()),
                    head_ref: head.to_owned(),
                })
            }
            GitHubTarget::Commit { owner, repo, sha } => {
                let value: CommitMetadataResponse = self.json(&target.api_url()).await?;
                let base_oid = value
                    .parents
                    .first()
                    .map_or_else(String::new, |parent| parent.sha.clone());
                Ok(ReviewMetadata {
                    title: value
                        .commit
                        .message
                        .lines()
                        .next()
                        .unwrap_or(&value.commit.message)
                        .to_owned(),
                    repository: format!("{owner}/{repo}"),
                    number: sha.chars().take(7).collect(),
                    author: author(value.author.as_ref(), value.commit.author.as_ref()),
                    base: base_oid.clone(),
                    head: value.sha.clone(),
                    url: target.web_url(),
                    base_oid,
                    head_oid: value.sha.clone(),
                    head_ref: value.sha,
                })
            }
        }
    }

    pub async fn revision_diff(
        &self,
        target: &GitHubTarget,
        base: &str,
        head: &str,
    ) -> AppResult<String> {
        self.text(
            &format!(
                "https://api.github.com/repos/{}/{}/compare/{}...{}",
                target.owner(),
                target.repo(),
                encode(base),
                encode(head)
            ),
            "application/vnd.github.diff",
        )
        .await
    }

    pub async fn file_pair(
        &self,
        target: &GitHubTarget,
        base: &str,
        head: &str,
        path: &str,
        previous_path: &str,
        status: FileStatus,
    ) -> AppResult<FilePair> {
        let old_path = if status == FileStatus::Renamed && !previous_path.is_empty() {
            previous_path
        } else {
            path
        };
        let old_text = if status == FileStatus::Added {
            String::new()
        } else {
            self.file(target, old_path, base).await?
        };
        let new_text = if status == FileStatus::Deleted {
            String::new()
        } else {
            self.file(target, path, head).await?
        };
        Ok(FilePair {
            path: path.to_owned(),
            previous_path: (!previous_path.is_empty()).then(|| previous_path.to_owned()),
            status,
            old_text,
            new_text,
        })
    }

    async fn file(&self, target: &GitHubTarget, path: &str, reference: &str) -> AppResult<String> {
        let encoded_path = path.split('/').map(encode).collect::<Vec<_>>().join("/");
        self.text(
            &format!(
                "https://api.github.com/repos/{}/{}/contents/{encoded_path}?ref={}",
                target.owner(),
                target.repo(),
                encode(reference)
            ),
            "application/vnd.github.raw+json",
        )
        .await
    }

    pub async fn pull_commits(&self, target: &GitHubTarget) -> AppResult<Vec<PullCommit>> {
        let Some(number) = target.pull_number() else {
            return Err(AppError::bad_request(
                "GitHub commits are available for pull requests.",
            ));
        };
        let mut commits = Vec::new();
        for page in 1..=100 {
            let values: Vec<PullCommitResponse> = self.json(&format!(
                "https://api.github.com/repos/{}/{}/pulls/{number}/commits?per_page=100&page={page}",
                target.owner(),
                target.repo()
            )).await?;
            let count = values.len();
            commits.extend(values.into_iter().map(|value| {
                PullCommit {
                    sha: value.sha,
                    message: value.commit.message,
                    author: author(value.author.as_ref(), value.commit.author.as_ref()),
                    avatar_url: value
                        .author
                        .as_ref()
                        .and_then(|user| user.avatar_url.clone())
                        .unwrap_or_default(),
                    authored_at: value
                        .commit
                        .author
                        .and_then(|entry| entry.date)
                        .unwrap_or_default(),
                    html_url: value.html_url,
                }
            }));
            if count < 100 {
                break;
            }
        }
        Ok(commits)
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
    sha: String,
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
    sha: String,
}

#[derive(Deserialize)]
struct CompareMetadataResponse {
    base_commit: Sha,
    commits: Vec<Sha>,
}

#[derive(Deserialize)]
struct CommitDetails {
    message: String,
    author: Option<CommitAuthor>,
}

#[derive(Deserialize)]
struct CommitMetadataResponse {
    sha: String,
    commit: CommitDetails,
    author: Option<User>,
    parents: Vec<Sha>,
}

#[derive(Deserialize)]
struct PullCommitResponse {
    sha: String,
    commit: CommitDetails,
    author: Option<User>,
    html_url: String,
}

fn author(user: Option<&User>, commit: Option<&CommitAuthor>) -> String {
    user.map(|value| value.login.clone())
        .or_else(|| commit.map(|value| value.name.clone()))
        .unwrap_or_else(|| "GitHub user".to_owned())
}
