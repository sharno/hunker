use std::{
    collections::{BTreeMap, HashMap},
    path::{Component, Path, PathBuf},
};

use regex::Regex;

use crate::{
    command,
    error::{AppError, AppResult},
    settings,
    types::{LocalGitRepository, RepositorySlug},
};

use super::{
    Local, LocalRepositories, LocalRepositorySummary, MAX_FILE_CHARACTERS, RepositoryCommit,
    RepositoryCommits, RepositoryFile, RepositoryFileContent, git_result, valid_segment,
};

impl Local {
    pub async fn repository_path(&self, repository: &RepositorySlug) -> AppResult<PathBuf> {
        if !valid_segment(&repository.owner) || !valid_segment(&repository.name) {
            return Err(AppError::bad_request("That repository name is not valid."));
        }
        let document = settings::load().await?;
        let repositories_root = settings::resolve_path(&document.settings.repositories_root);
        let cache_root = settings::resolve_path(&document.settings.cache_root);
        let candidates = [
            repositories_root.join(&repository.name),
            repositories_root
                .join(&repository.owner)
                .join(&repository.name),
            cache_root.join(&repository.owner).join(&repository.name),
        ];
        for candidate in candidates {
            if candidate.exists() {
                return Ok(candidate);
            }
        }
        Err(AppError::not_found(format!(
            "Local repository not found for {}/{}.",
            repository.owner, repository.name
        )))
    }

    pub async fn find(&self, repository: &RepositorySlug) -> AppResult<Option<LocalGitRepository>> {
        let document = settings::load().await?;
        let configured = settings::resolve_path(&document.settings.repositories_root);
        let cache = settings::resolve_path(&document.settings.cache_root);
        let candidates = [
            (configured.join(&repository.name), "checkout"),
            (
                configured.join(&repository.owner).join(&repository.name),
                "checkout",
            ),
            (
                cache.join(&repository.owner).join(&repository.name),
                "cache",
            ),
        ];
        for (path, kind) in candidates {
            if path.exists() && git_result(&path, &["rev-parse", "--git-dir"]).await?.0 {
                return Ok(Some(LocalGitRepository { path, kind }));
            }
        }
        Ok(None)
    }

    pub async fn list_repositories(&self) -> AppResult<LocalRepositories> {
        let document = settings::load().await?;
        let configured_root = settings::resolve_path(&document.settings.repositories_root);
        let temporary_root = settings::resolve_path(&document.settings.cache_root);
        let mut unique = BTreeMap::new();
        for (root, source) in [
            (&configured_root, "configured"),
            (&temporary_root, "temporary"),
        ] {
            for path in repository_directories(root) {
                let fallback_name = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("repository")
                    .to_owned();
                let fallback_owner = path
                    .parent()
                    .and_then(Path::file_name)
                    .and_then(|value| value.to_str())
                    .unwrap_or("local")
                    .to_owned();
                let remote = command::git_config(&path, &["--get", "remote.origin.url"]).await?;
                let (owner, name) = remote
                    .as_deref()
                    .and_then(parse_github_remote)
                    .unwrap_or((fallback_owner, fallback_name));
                unique
                    .entry(format!("{owner}/{name}").to_lowercase())
                    .or_insert(LocalRepositorySummary {
                        owner,
                        name,
                        path: path.to_string_lossy().into_owned(),
                        source: source.to_owned(),
                    });
            }
        }
        Ok(LocalRepositories {
            configured_root: configured_root.to_string_lossy().into_owned(),
            temporary_root: temporary_root.to_string_lossy().into_owned(),
            repositories: unique.into_values().collect(),
        })
    }

    pub async fn list_files(&self, repository: &RepositorySlug) -> AppResult<Vec<RepositoryFile>> {
        let root = self.repository_path(repository).await?;
        let raw = command::git(&root, &["ls-files", "-co", "--exclude-standard", "-z"]).await?;
        let statuses = file_statuses(&root).await?;
        let mut files = Vec::new();
        for relative in raw
            .split('\0')
            .filter(|value| !value.is_empty())
            .take(20_000)
        {
            let size = tokio::fs::metadata(root.join(relative))
                .await
                .map_or(0, |metadata| metadata.len());
            files.push(RepositoryFile {
                path: relative.to_owned(),
                size,
                git_status: statuses
                    .get(relative)
                    .cloned()
                    .unwrap_or_else(|| "clean".to_owned()),
            });
        }
        Ok(files)
    }

    pub async fn read_file(
        &self,
        repository: &RepositorySlug,
        relative: &str,
    ) -> AppResult<RepositoryFileContent> {
        let root = self.repository_path(repository).await?;
        let path = validated_file(&root, relative).await?;
        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|_| AppError::not_found(format!("Could not read {relative}.")))?;
        let truncated = content.chars().count() > MAX_FILE_CHARACTERS;
        Ok(RepositoryFileContent {
            path: relative.to_owned(),
            content: content.chars().take(MAX_FILE_CHARACTERS).collect(),
            truncated,
        })
    }

    pub async fn list_commits(&self, repository: &RepositorySlug) -> AppResult<RepositoryCommits> {
        let root = self.repository_path(repository).await?;
        let raw = command::git(
            &root,
            &[
                "log",
                "-100",
                "--no-show-signature",
                "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e",
                "HEAD",
            ],
        )
        .await?;
        let reference = command::git(&root, &["rev-parse", "--abbrev-ref", "HEAD"])
            .await?
            .trim()
            .to_owned();
        let shallow = command::git(&root, &["rev-parse", "--is-shallow-repository"])
            .await?
            .trim()
            == "true";
        Ok(RepositoryCommits {
            reference,
            shallow,
            commits: parse_repository_commits(&raw),
        })
    }
}

fn repository_directories(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return found;
    };
    for entry in entries.flatten().filter(|entry| entry.path().is_dir()) {
        let path = entry.path();
        if path.join(".git").exists() {
            found.push(path);
            continue;
        }
        if let Ok(nested) = std::fs::read_dir(&path) {
            found.extend(
                nested
                    .flatten()
                    .map(|child| child.path())
                    .filter(|child| child.is_dir() && child.join(".git").exists()),
            );
        }
    }
    found
}

fn parse_github_remote(remote: &str) -> Option<(String, String)> {
    let regex = Regex::new(r"^(?:git@github\.com:|https?://github\.com/|ssh://git@github\.com/)([^/]+)/([^/]+?)(?:\.git)?$").ok()?;
    let captures = regex.captures(remote.trim())?;
    Some((
        captures.get(1)?.as_str().to_owned(),
        captures.get(2)?.as_str().to_owned(),
    ))
}

async fn validated_file(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let relative_path = Path::new(relative);
    if relative.is_empty()
        || relative_path.is_absolute()
        || relative_path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(AppError::bad_request(
            "That file is outside the configured repository.",
        ));
    }
    let canonical_root = tokio::fs::canonicalize(root)
        .await
        .map_err(|_| AppError::internal(format!("Could not inspect {}.", root.display())))?;
    let canonical_file = tokio::fs::canonicalize(root.join(relative))
        .await
        .map_err(|_| AppError::not_found(format!("Could not read {relative}.")))?;
    if !canonical_file.starts_with(&canonical_root) {
        return Err(AppError::bad_request(
            "That file is outside the configured repository.",
        ));
    }
    Ok(canonical_file)
}

async fn file_statuses(root: &Path) -> AppResult<HashMap<String, String>> {
    let raw = command::git(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )
    .await?;
    let mut statuses = HashMap::new();
    for record in raw.split('\0').filter(|record| record.len() > 3) {
        statuses.insert(record[3..].to_owned(), record[..2].trim().to_owned());
    }
    Ok(statuses)
}

fn parse_repository_commits(raw: &str) -> Vec<RepositoryCommit> {
    raw.split('\x1e')
        .filter_map(|record| {
            let mut fields = record.trim().split('\x1f');
            let sha = fields.next()?.to_owned();
            if sha.is_empty() {
                return None;
            }
            Some(RepositoryCommit {
                sha,
                parents: fields
                    .next()
                    .unwrap_or("")
                    .split_whitespace()
                    .map(str::to_owned)
                    .collect(),
                author_name: fields.next().unwrap_or("").to_owned(),
                author_email: fields.next().unwrap_or("").to_owned(),
                authored_at: fields.next().unwrap_or("").to_owned(),
                subject: fields.next().unwrap_or("").to_owned(),
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
            Some(("acme".to_owned(), "demo".to_owned()))
        );
        assert_eq!(
            parse_github_remote("https://github.com/acme/demo"),
            Some(("acme".to_owned(), "demo".to_owned()))
        );
    }
}
