use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

use regex::Regex;

use crate::{
    command,
    error::{AppError, AppResult},
    settings,
    types::{LocalGitRepository, Oid, RepositorySlug},
};

use super::{
    Local, LocalRepositories, LocalRepositorySummary, MAX_FILE_CHARACTERS, RepositoryCommit,
    RepositoryCommits, RepositoryFile, RepositoryFileContent, git_result, objects, valid_segment,
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

    pub async fn list_files(
        &self,
        repository: &RepositorySlug,
        oid: &Oid,
    ) -> AppResult<Vec<RepositoryFile>> {
        let root = self.repository_path(repository).await?;
        let raw = command::git(
            &root,
            &["ls-tree", "-r", "-z", "--long", oid.as_str(), "--"],
        )
        .await?;
        Ok(raw
            .split('\0')
            .filter_map(parse_tree_file)
            .take(20_000)
            .collect())
    }

    pub async fn read_file(
        &self,
        repository: &RepositorySlug,
        oid: &Oid,
        relative: &str,
    ) -> AppResult<RepositoryFileContent> {
        let root = self.repository_path(repository).await?;
        objects::validate_git_path(relative)?;
        let object = format!("{}:{relative}", oid.as_str());
        let mut contents = objects::cat_file_batch(&root, &[object]).await?;
        let content = contents
            .pop()
            .ok_or_else(|| AppError::not_found(format!("Could not read {relative}.")))?;
        let truncated = content.chars().count() > MAX_FILE_CHARACTERS;
        Ok(RepositoryFileContent {
            path: relative.to_owned(),
            content: content.chars().take(MAX_FILE_CHARACTERS).collect(),
            truncated,
        })
    }

    pub async fn list_commits(
        &self,
        repository: &RepositorySlug,
        oid: &Oid,
    ) -> AppResult<RepositoryCommits> {
        let root = self.repository_path(repository).await?;
        let raw = command::git(
            &root,
            &[
                "log",
                "-100",
                "--no-show-signature",
                "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e",
                oid.as_str(),
            ],
        )
        .await?;
        let shallow = command::git(&root, &["rev-parse", "--is-shallow-repository"])
            .await?
            .trim()
            == "true";
        Ok(RepositoryCommits {
            reference: oid.to_string(),
            shallow,
            commits: parse_repository_commits(&raw),
        })
    }
}

fn parse_tree_file(record: &str) -> Option<RepositoryFile> {
    let (metadata, path) = record.split_once('\t')?;
    let mut fields = metadata.split_whitespace();
    fields.next()?;
    if fields.next()? != "blob" {
        return None;
    }
    fields.next()?;
    let size = fields.next()?.parse().ok()?;
    Some(RepositoryFile {
        path: path.to_owned(),
        size,
        git_status: "clean".to_owned(),
    })
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

    #[test]
    fn parses_only_blob_entries_from_immutable_trees() {
        let file = parse_tree_file("100644 blob 0123456789abcdef 42\tsrc/main.rs")
            .expect("blob entry should be visible in the file tree");
        assert_eq!(file.path, "src/main.rs");
        assert_eq!(file.size, 42);
        assert_eq!(file.git_status, "clean");
        assert!(parse_tree_file("160000 commit 0123456789abcdef -\tvendor/effect").is_none());
    }
}
