use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::LazyLock,
};

use futures::{StreamExt, stream};
use regex::Regex;

use crate::{
    command::Git,
    error::{AppError, AppResult},
    types::{LocalGitRepository, Oid, RelativePath, RepositoryRoot, RepositorySlug},
};

use super::{
    History, Local, LocalRepositories, LocalRepositorySummary, MAX_FILE_CHARACTERS,
    RepositoryCommit, RepositoryCommits, RepositoryFile, RepositoryFileContent, objects,
};

const MAX_LISTED_FILES: usize = 20_000;
const CATALOG_CONCURRENCY: usize = 8;

static GITHUB_REMOTE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^(?:git@github\.com:|https?://github\.com/|ssh://git@github\.com/)([^/]+)/([^/]+?)(?:\.git)?$",
    )
    .expect("GitHub remote expression is valid")
});

impl Local {
    /// Finds the local Git repository for `repository`, or `None` when no
    /// candidate directory is a Git repository.
    pub async fn find(&self, repository: &RepositorySlug) -> AppResult<Option<LocalGitRepository>> {
        let roots = self.settings.roots().await?;
        for (path, root) in roots.candidates(repository) {
            if is_repository(&path).await? {
                return Ok(Some(LocalGitRepository { path, root }));
            }
        }
        Ok(None)
    }

    pub async fn repository_path(&self, repository: &RepositorySlug) -> AppResult<PathBuf> {
        self.find(repository)
            .await?
            .map(|found| found.path)
            .ok_or_else(|| {
                AppError::not_found(format!("Local repository not found for {repository}."))
            })
    }

    pub async fn list_repositories(&self) -> AppResult<LocalRepositories> {
        let roots = self.settings.roots().await?;
        let scanned = roots.clone();
        let candidates = tokio::task::spawn_blocking(move || {
            [RepositoryRoot::Configured, RepositoryRoot::Temporary]
                .into_iter()
                .flat_map(|root| {
                    repository_directories(scanned.path(root))
                        .into_iter()
                        .map(move |path| (path, root))
                })
                .collect::<Vec<_>>()
        })
        .await
        .map_err(|error| AppError::internal(format!("Repository discovery stopped: {error}")))?;
        let summaries = stream::iter(candidates)
            .map(|(path, root)| async move { summarize(path, root).await })
            .buffered(CATALOG_CONCURRENCY)
            .collect::<Vec<_>>()
            .await;
        let unique =
            summaries
                .into_iter()
                .flatten()
                .fold(BTreeMap::new(), |mut unique, summary| {
                    unique
                        .entry(format!("{}/{}", summary.owner, summary.name).to_lowercase())
                        .or_insert(summary);
                    unique
                });
        Ok(LocalRepositories {
            configured_root: display(roots.path(RepositoryRoot::Configured)),
            temporary_root: display(roots.path(RepositoryRoot::Temporary)),
            repositories: unique.into_values().collect(),
        })
    }

    pub async fn list_files(
        &self,
        repository: &RepositorySlug,
        oid: &Oid,
    ) -> AppResult<Vec<RepositoryFile>> {
        let root = self.repository_path(repository).await?;
        let raw = Git::at(&root)
            .ok(&["ls-tree", "-r", "-z", "--long", oid.as_str(), "--"])
            .await?;
        Ok(raw
            .split('\0')
            .filter_map(parse_tree_file)
            .take(MAX_LISTED_FILES)
            .collect())
    }

    pub async fn read_file(
        &self,
        repository: &RepositorySlug,
        oid: &Oid,
        relative: &RelativePath,
    ) -> AppResult<RepositoryFileContent> {
        let root = self.repository_path(repository).await?;
        let mut contents =
            objects::cat_file_batch(&root, vec![format!("{oid}:{relative}")]).await?;
        let content = contents
            .pop()
            .ok_or_else(|| AppError::not_found(format!("Could not read {relative}.")))?;
        let (content, truncated) = match content.char_indices().nth(MAX_FILE_CHARACTERS) {
            Some((cutoff, _)) => (content[..cutoff].to_owned(), true),
            None => (content, false),
        };
        let presentation_path = relative.clone();
        let (content, presentation) = tokio::task::spawn_blocking(move || {
            let presentation =
                crate::semantic::source_presentation(presentation_path.as_str(), &content);
            (content, presentation)
        })
        .await
        .map_err(|error| AppError::internal(format!("Syntax highlighting stopped: {error}")))?;
        Ok(RepositoryFileContent {
            path: relative.to_string(),
            content,
            truncated,
            presentation,
        })
    }

    pub async fn list_commits(
        &self,
        repository: &RepositorySlug,
        oid: &Oid,
    ) -> AppResult<RepositoryCommits> {
        let root = self.repository_path(repository).await?;
        let git = Git::at(&root);
        let raw = git
            .ok(&[
                "log",
                "-100",
                "--no-show-signature",
                "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e",
                oid.as_str(),
            ])
            .await?;
        let history = if git.is_shallow().await? {
            History::Shallow
        } else {
            History::Complete
        };
        Ok(RepositoryCommits {
            reference: oid.clone(),
            history,
            commits: parse_repository_commits(&raw)?,
        })
    }
}

async fn is_repository(path: &Path) -> AppResult<bool> {
    if !tokio::fs::try_exists(path).await.unwrap_or(false) {
        return Ok(false);
    }
    Ok(Git::at(path)
        .run(&["rev-parse", "--git-dir"])
        .await?
        .status
        .success())
}

/// Summarizes one discovered checkout. Directories that do not map to a
/// GitHub repository, or whose Git config cannot be read, are left out of the
/// catalog because Hunker cannot open them by slug anyway.
async fn summarize(path: PathBuf, root: RepositoryRoot) -> Option<LocalRepositorySummary> {
    let remote = match Git::at(&path).config(&["--get", "remote.origin.url"]).await {
        Ok(remote) => remote,
        Err(error) => {
            tracing::warn!(path = %path.display(), %error, "skipping unreadable repository");
            return None;
        }
    };
    let repository = remote
        .as_deref()
        .and_then(parse_github_remote)
        .or_else(|| directory_slug(&path))?;
    Some(LocalRepositorySummary {
        owner: repository.owner().to_owned(),
        name: repository.name().to_owned(),
        path: display(&path),
        source: root,
    })
}

fn directory_slug(path: &Path) -> Option<RepositorySlug> {
    let name = path.file_name()?.to_str()?;
    let owner = path.parent()?.file_name()?.to_str()?;
    RepositorySlug::new(owner, name).ok()
}

fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn parse_tree_file(record: &str) -> Option<RepositoryFile> {
    let (metadata, path) = record.split_once('\t')?;
    let [_, "blob", _, size] = metadata.split_whitespace().collect::<Vec<_>>()[..] else {
        return None;
    };
    Some(RepositoryFile {
        path: path.to_owned(),
        size: size.parse().ok()?,
    })
}

/// Checkouts live directly under a root (`~/src/name`) or one level down
/// (`~/src/owner/name`).
fn repository_directories(root: &Path) -> Vec<PathBuf> {
    let directories = |path: &Path| -> Vec<PathBuf> {
        std::fs::read_dir(path)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir())
            .collect()
    };
    directories(root)
        .into_iter()
        .flat_map(|path| {
            if path.join(".git").exists() {
                vec![path]
            } else {
                directories(&path)
                    .into_iter()
                    .filter(|child| child.join(".git").exists())
                    .collect()
            }
        })
        .collect()
}

fn parse_github_remote(remote: &str) -> Option<RepositorySlug> {
    let captures = GITHUB_REMOTE.captures(remote.trim())?;
    RepositorySlug::new(captures.get(1)?.as_str(), captures.get(2)?.as_str()).ok()
}

fn parse_repository_commits(raw: &str) -> AppResult<Vec<RepositoryCommit>> {
    raw.split('\x1e')
        .map(str::trim)
        .filter(|record| !record.is_empty())
        .map(|record| {
            let [
                sha,
                parents,
                author_name,
                author_email,
                authored_at,
                subject,
            ] = record.split('\x1f').collect::<Vec<_>>()[..]
            else {
                return Err(AppError::upstream(
                    "Git returned a malformed commit record.",
                ));
            };
            Ok(RepositoryCommit {
                sha: Oid::parse(sha).map_err(AppError::upstream)?,
                parents: parents
                    .split_whitespace()
                    .map(|parent| Oid::parse(parent).map_err(AppError::upstream))
                    .collect::<AppResult<_>>()?,
                author_name: author_name.to_owned(),
                author_email: author_email.to_owned(),
                authored_at: authored_at.to_owned(),
                subject: subject.to_owned(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_github_remotes() {
        assert_eq!(
            parse_github_remote("git@github.com:acme/demo.git"),
            Some(RepositorySlug::parse("acme/demo").unwrap())
        );
        assert_eq!(
            parse_github_remote("https://github.com/acme/demo"),
            Some(RepositorySlug::parse("acme/demo").unwrap())
        );
        assert_eq!(parse_github_remote("https://gitlab.com/acme/demo"), None);
    }

    #[test]
    fn parses_only_blob_entries_from_immutable_trees() {
        let file = parse_tree_file("100644 blob 0123456789abcdef 42\tsrc/main.rs")
            .expect("blob entry should be visible in the file tree");
        assert_eq!(file.path, "src/main.rs");
        assert_eq!(file.size, 42);
        assert!(parse_tree_file("160000 commit 0123456789abcdef -\tvendor/effect").is_none());
    }

    #[test]
    fn rejects_malformed_commit_records() {
        let oid = "a".repeat(40);
        let commits = parse_repository_commits(&format!(
            "{oid}\x1f\x1fAda\x1fada@example.com\x1f2026-01-01T00:00:00Z\x1fInitial\x1e"
        ))
        .unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].parents, Vec::<Oid>::new());
        assert!(parse_repository_commits("not-a-commit\x1e").is_err());
    }
}
