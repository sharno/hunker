use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use regex::Regex;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tokio::{io::AsyncWriteExt, process::Command};
use walkdir::WalkDir;

use fff_search::{
    FFFMode, FilePicker, FilePickerOptions, FuzzySearchOptions, PaginationArgs, QueryParser,
    SharedFilePicker, SharedFrecency,
};

use crate::{
    command,
    error::{AppError, AppResult},
    github::{GitHubTarget, ReviewMetadata},
    settings,
    types::{FilePair, FileStatus, LocalGitRepository, PullCommit, RepositoryId},
};

const MAX_FILE_CHARACTERS: usize = 500_000;
const FETCH_INTERVAL_MS: u64 = 120_000;
const DEEPEN_STEPS: [usize; 4] = [32, 128, 512, 2_048];

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

async fn git_action(path: &Path, args: &[&str]) -> AppResult<String> {
    let (succeeded, output, exit_code) = git_result(path, args).await?;
    if succeeded {
        Ok(output)
    } else {
        Err(AppError::conflict(if output.trim().is_empty() {
            format!(
                "Git {} refused the operation with status {exit_code}.",
                args.first().copied().unwrap_or("command")
            )
        } else {
            output.trim().to_owned()
        }))
    }
}

impl Local {
    pub async fn repository_path(&self, repository: &RepositoryId) -> AppResult<PathBuf> {
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

    pub async fn find(&self, repository: &RepositoryId) -> AppResult<Option<LocalGitRepository>> {
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
                let remote = command::git(&path, &["config", "--get", "remote.origin.url"])
                    .await
                    .unwrap_or_default();
                let (owner, name) =
                    parse_github_remote(&remote).unwrap_or((fallback_owner, fallback_name));
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

    pub async fn list_files(&self, repository: &RepositoryId) -> AppResult<Vec<RepositoryFile>> {
        let root = self.repository_path(repository).await?;
        let raw = command::git(&root, &["ls-files", "-co", "--exclude-standard", "-z"]).await?;
        let statuses = file_statuses(&root).await.unwrap_or_default();
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
        repository: &RepositoryId,
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

    pub async fn search(
        &self,
        repository: &RepositoryId,
        query: &str,
        mode: &str,
    ) -> AppResult<SearchResults> {
        let root = self.repository_path(repository).await?;
        if query.trim().is_empty() {
            return Err(AppError::bad_request("Enter a search query."));
        }
        if mode == "fuzzy" {
            let picker = self.fuzzy_index(&root).await?;
            return fuzzy_search(&root, query, picker).await;
        }
        text_search(&root, query, mode).await
    }

    async fn fuzzy_index(&self, root: &Path) -> AppResult<SharedFilePicker> {
        let mut indexes = self.fuzzy_indexes.lock().await;
        if let Some(picker) = indexes.get(root) {
            return Ok(picker.clone());
        }
        let picker = SharedFilePicker::default();
        FilePicker::new_with_shared_state(
            picker.clone(),
            SharedFrecency::default(),
            FilePickerOptions {
                base_path: root.to_string_lossy().into_owned(),
                mode: FFFMode::Ai,
                watch: true,
                ..FilePickerOptions::default()
            },
        )
        .map_err(|error| {
            AppError::internal(format!("FFF could not index the repository: {error}"))
        })?;
        indexes.insert(root.to_path_buf(), picker.clone());
        Ok(picker)
    }

    pub async fn list_commits(&self, repository: &RepositoryId) -> AppResult<RepositoryCommits> {
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

    pub async fn clone_repository(
        &self,
        repository: &RepositoryId,
        destination: &str,
    ) -> AppResult<PathBuf> {
        if !valid_segment(&repository.owner) || !valid_segment(&repository.name) {
            return Err(AppError::bad_request("That repository name is not valid."));
        }
        let settings = settings::load().await?.settings;
        let root = if destination == "configured" {
            settings::resolve_path(&settings.repositories_root)
        } else {
            settings::resolve_path(&settings.cache_root)
        };
        let target = if destination == "configured" {
            root.join(&repository.name)
        } else {
            root.join(&repository.owner).join(&repository.name)
        };
        if target.exists() {
            return Ok(target);
        }
        tokio::fs::create_dir_all(target.parent().unwrap_or(&root))
            .await
            .map_err(|error| {
                AppError::internal(format!("Could not create clone directory: {error}"))
            })?;
        let target_text = target.to_string_lossy();
        command::checked(
            "gh",
            &[
                "repo",
                "clone",
                &format!("{}/{}", repository.owner, repository.name),
                &target_text,
                "--",
                "--depth=1",
                "--single-branch",
                "--filter=blob:none",
                "--no-tags",
            ],
            target.parent(),
        )
        .await?;
        Ok(target)
    }

    async fn lock_for(&self, repository: &RepositoryId) -> AppResult<(PathBuf, Arc<Mutex<()>>)> {
        let root = self.repository_path(repository).await?;
        let lock = {
            let mut locks = self.repository_locks.lock().await;
            locks
                .entry(root.clone())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        Ok((root, lock))
    }

    pub async fn source_control(
        &self,
        repository: &RepositoryId,
    ) -> AppResult<SourceControlStatus> {
        let (root, lock) = self.lock_for(repository).await?;
        let _guard = lock.lock().await;
        inspect_source_control(&root, true).await
    }

    pub async fn switch_branch(
        &self,
        repository: &RepositoryId,
        branch: &str,
    ) -> AppResult<SourceControlStatus> {
        let (root, lock) = self.lock_for(repository).await?;
        let _guard = lock.lock().await;
        git_action(&root, &["check-ref-format", "--branch", branch]).await?;
        let current = inspect_source_control(&root, true).await?;
        let target = current
            .branches
            .iter()
            .find(|candidate| candidate.name == branch)
            .cloned()
            .ok_or_else(|| AppError::not_found(format!("Branch {branch} was not found.")))?;
        if target.local {
            git_action(&root, &["switch", "--", branch]).await?;
        } else {
            let refspec = format!("+refs/heads/{branch}:refs/remotes/origin/{branch}");
            let configured = command::git(&root, &["config", "--get-all", "remote.origin.fetch"])
                .await
                .unwrap_or_default();
            if !configured.lines().any(|line| line == refspec) {
                git_action(&root, &["config", "--add", "remote.origin.fetch", &refspec]).await?;
            }
            let remote_ref = format!("refs/heads/{branch}:refs/remotes/origin/{branch}");
            git_action(&root, &["fetch", "origin", &remote_ref, "--depth=1"]).await?;
            let origin = format!("origin/{branch}");
            git_action(&root, &["switch", "--track", "-c", branch, "--", &origin]).await?;
        }
        inspect_source_control(&root, false).await
    }

    pub async fn pull(&self, repository: &RepositoryId) -> AppResult<PullResult> {
        let (root, lock) = self.lock_for(repository).await?;
        let _guard = lock.lock().await;
        let current = inspect_source_control(&root, true).await?;
        let (behind, before) = match &current.checkout {
            Checkout::DetachedHead { .. } => {
                return Err(AppError::conflict(
                    "Cannot pull while HEAD is detached. Switch to a branch first.",
                ));
            }
            Checkout::UntrackedBranch { name, .. } => {
                return Err(AppError::conflict(format!(
                    "Branch {name} does not track a remote branch."
                )));
            }
            Checkout::TrackingBranch { behind, oid, .. } => (*behind, oid.clone()),
        };
        if behind == 0 {
            return Ok(PullResult { pulled_commits: 0 });
        }
        git_action(&root, &["pull", "--ff-only"]).await?;
        let after = command::git(&root, &["rev-parse", "HEAD"])
            .await?
            .trim()
            .to_owned();
        let pulled = command::git(
            &root,
            &["rev-list", "--count", &format!("{before}..{after}")],
        )
        .await?
        .trim()
        .parse()
        .unwrap_or(0);
        Ok(PullResult {
            pulled_commits: pulled,
        })
    }

    async fn has_object(path: &Path, oid: &str) -> AppResult<bool> {
        if !valid_oid(oid) {
            return Ok(false);
        }
        Ok(
            git_result(path, &["cat-file", "-e", &format!("{oid}^{{commit}}")])
                .await?
                .0,
        )
    }

    async fn shallow(path: &Path) -> AppResult<bool> {
        Ok(
            command::git(path, &["rev-parse", "--is-shallow-repository"])
                .await?
                .trim()
                == "true",
        )
    }

    async fn fetch_pull(
        &self,
        repository: &LocalGitRepository,
        number: &str,
        force: bool,
    ) -> AppResult<u64> {
        let now = now_ms();
        let key = format!("{}\0{number}", repository.path.display());
        let mut fetches = self.fetches.lock().await;
        if !force && now.saturating_sub(fetches.get(&key).copied().unwrap_or(0)) < FETCH_INTERVAL_MS
        {
            return Ok(now);
        }
        let shallow = Self::shallow(&repository.path).await?;
        let refspec = format!("+refs/pull/{number}/head:refs/hunker/pull/{number}/head");
        let mut args = vec!["fetch", "--no-tags"];
        if shallow {
            args.push("--depth=1");
        }
        args.extend(["origin", &refspec]);
        command::git(&repository.path, &args).await?;
        fetches.insert(key, now);
        Ok(now)
    }

    async fn prepare(
        &self,
        repository_id: &RepositoryId,
        base: &str,
        head: &str,
        pull: Option<&str>,
    ) -> AppResult<Option<LocalGitRepository>> {
        if !valid_oid(base) || !valid_oid(head) {
            return Ok(None);
        }
        let Some(repository) = self.find(repository_id).await? else {
            return Ok(None);
        };
        let mut base_present = Self::has_object(&repository.path, base).await?;
        let mut head_present = Self::has_object(&repository.path, head).await?;
        if let Some(number) = pull.filter(|_| !base_present || !head_present) {
            let _ = self.fetch_pull(&repository, number, true).await;
        }
        base_present = Self::has_object(&repository.path, base).await?;
        head_present = Self::has_object(&repository.path, head).await?;
        for (oid, present) in [(base, base_present), (head, head_present)] {
            if !present {
                let mut args = vec!["fetch", "--no-tags"];
                if Self::shallow(&repository.path).await? {
                    args.push("--depth=1");
                }
                args.extend(["origin", oid]);
                let _ = command::git(&repository.path, &args).await;
            }
        }
        if Self::has_object(&repository.path, base).await?
            && Self::has_object(&repository.path, head).await?
        {
            Ok(Some(repository))
        } else {
            Ok(None)
        }
    }

    pub async fn load_diff(
        &self,
        target: &GitHubTarget,
        base: &str,
        head: &str,
    ) -> AppResult<Option<(LocalGitRepository, String)>> {
        let Some(repository) = self
            .prepare(&target.repository(), base, head, target.pull_number())
            .await?
        else {
            return Ok(None);
        };
        let diff = command::git(
            &repository.path,
            &[
                "diff",
                "--find-renames",
                "--no-ext-diff",
                "--no-color",
                "--full-index",
                base,
                head,
                "--",
            ],
        )
        .await?;
        Ok(Some((repository, diff)))
    }

    pub async fn load_file_pair(
        &self,
        target: &GitHubTarget,
        base: &str,
        head: &str,
        path: &str,
        previous_path: &str,
        status: FileStatus,
    ) -> AppResult<Option<FilePair>> {
        let file = crate::types::FileChange {
            path: path.to_owned(),
            previous_path: (!previous_path.is_empty()).then(|| previous_path.to_owned()),
            status,
            additions: 0,
            deletions: 0,
            patch: String::new(),
        };
        Ok(self
            .load_file_pairs(target, base, head, &[file])
            .await?
            .and_then(|pairs| pairs.into_iter().next()))
    }

    pub async fn load_file_pairs(
        &self,
        target: &GitHubTarget,
        base: &str,
        head: &str,
        files: &[crate::types::FileChange],
    ) -> AppResult<Option<Vec<FilePair>>> {
        let Some(repository) = self
            .prepare(&target.repository(), base, head, target.pull_number())
            .await?
        else {
            return Ok(None);
        };
        Ok(Some(
            self.load_file_pairs_at(&repository, base, head, files)
                .await?,
        ))
    }

    pub async fn load_file_pairs_at(
        &self,
        repository: &LocalGitRepository,
        base: &str,
        head: &str,
        files: &[crate::types::FileChange],
    ) -> AppResult<Vec<FilePair>> {
        #[derive(Clone)]
        enum ContentSource {
            Empty,
            Batch(usize),
            Inline(String),
        }

        let mut objects = Vec::new();
        let mut positions = Vec::with_capacity(files.len());
        for file in files {
            validate_git_path(&file.path)?;
            if let Some(previous_path) = &file.previous_path {
                validate_git_path(previous_path)?;
            }
            let old_path = file.previous_path.as_deref().unwrap_or(&file.path);
            let old = if file.status == FileStatus::Added {
                ContentSource::Empty
            } else if let Some(text) = gitlink_text(&file.patch, '-') {
                ContentSource::Inline(text)
            } else {
                let position = objects.len();
                objects.push(format!("{base}:{old_path}"));
                ContentSource::Batch(position)
            };
            let new = if file.status == FileStatus::Deleted {
                ContentSource::Empty
            } else if let Some(text) = gitlink_text(&file.patch, '+') {
                ContentSource::Inline(text)
            } else {
                let position = objects.len();
                objects.push(format!("{head}:{}", file.path));
                ContentSource::Batch(position)
            };
            positions.push((old, new));
        }
        let contents = cat_file_batch(&repository.path, &objects).await?;
        let pairs = files
            .iter()
            .zip(positions)
            .map(|(file, (old, new))| FilePair {
                path: file.path.clone(),
                previous_path: file.previous_path.clone(),
                status: file.status,
                old_text: match old {
                    ContentSource::Empty => String::new(),
                    ContentSource::Batch(index) => contents[index].clone(),
                    ContentSource::Inline(text) => text,
                },
                new_text: match new {
                    ContentSource::Empty => String::new(),
                    ContentSource::Batch(index) => contents[index].clone(),
                    ContentSource::Inline(text) => text,
                },
            })
            .collect();
        Ok(pairs)
    }

    pub async fn load_pull_commits(
        &self,
        target: &GitHubTarget,
        metadata: &ReviewMetadata,
    ) -> AppResult<Option<Vec<PullCommit>>> {
        let Some(repository) = self
            .prepare(
                &target.repository(),
                &metadata.base_oid,
                &metadata.head_oid,
                target.pull_number(),
            )
            .await?
        else {
            return Ok(None);
        };
        if !git_result(
            &repository.path,
            &["merge-base", &metadata.base_oid, &metadata.head_oid],
        )
        .await?
        .0
        {
            let Some(number) = target.pull_number() else {
                return Ok(None);
            };
            for deepen in DEEPEN_STEPS {
                if !Self::shallow(&repository.path).await? {
                    return Ok(None);
                }
                let refspec = format!("+refs/pull/{number}/head:refs/hunker/pull/{number}/head");
                if !git_result(
                    &repository.path,
                    &[
                        "fetch",
                        "--no-tags",
                        &format!("--deepen={deepen}"),
                        "origin",
                        &refspec,
                    ],
                )
                .await?
                .0
                {
                    return Ok(None);
                }
                if git_result(
                    &repository.path,
                    &["merge-base", &metadata.base_oid, &metadata.head_oid],
                )
                .await?
                .0
                {
                    break;
                }
            }
        }
        let range = format!("{}..{}", metadata.base_oid, metadata.head_oid);
        let raw = command::git(
            &repository.path,
            &[
                "log",
                "--reverse",
                "--format=%H%x1f%B%x1f%an%x1f%aI%x1e",
                &range,
                "--",
            ],
        )
        .await?;
        Ok(Some(
            raw.split('\x1e')
                .filter_map(|record| {
                    let record = record.trim();
                    if record.is_empty() {
                        return None;
                    }
                    let mut fields = record.split('\x1f');
                    let sha = fields.next()?.to_owned();
                    let message = fields.next()?.trim_end().to_owned();
                    Some(PullCommit {
                        html_url: format!(
                            "https://github.com/{}/{}/commit/{sha}",
                            target.owner(),
                            target.repo()
                        ),
                        sha,
                        message,
                        author: fields.next().unwrap_or("Git user").to_owned(),
                        avatar_url: String::new(),
                        authored_at: fields.next().unwrap_or("").to_owned(),
                    })
                })
                .collect(),
        ))
    }

    pub async fn revision(
        &self,
        target: &GitHubTarget,
        pinned: &str,
    ) -> AppResult<Option<PullRevision>> {
        let Some(number) = target.pull_number() else {
            return Err(AppError::bad_request("A pull request is required."));
        };
        let Some(repository) = self.find(&target.repository()).await? else {
            return Ok(None);
        };
        let checked_at = self.fetch_pull(&repository, number, false).await?;
        let latest = command::git(
            &repository.path,
            &[
                "rev-parse",
                &format!("refs/hunker/pull/{number}/head^{{commit}}"),
            ],
        )
        .await?
        .trim()
        .to_owned();
        Ok(Some(PullRevision {
            repository,
            pinned_head_oid: pinned.to_owned(),
            latest_head_oid: latest,
            checked_at,
        }))
    }
}

fn gitlink_text(patch: &str, marker: char) -> Option<String> {
    let prefix = format!("{marker}Subproject commit ");
    patch
        .lines()
        .find_map(|line| line.strip_prefix(&prefix))
        .map(|oid| format!("Subproject commit {oid}\n"))
}

fn validate_git_path(path: &str) -> AppResult<()> {
    if path.is_empty()
        || path.starts_with('/')
        || path.contains(['\0', '\n', '\r'])
        || Path::new(path)
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        Err(AppError::bad_request("That file path is not valid."))
    } else {
        Ok(())
    }
}

async fn cat_file_batch(repository: &Path, objects: &[String]) -> AppResult<Vec<String>> {
    if objects.is_empty() {
        return Ok(Vec::new());
    }
    let mut child = Command::new("git")
        .args(["cat-file", "--batch"])
        .current_dir(repository)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| AppError::upstream(format!("Could not start git cat-file: {error}")))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::internal("git cat-file did not expose stdin."))?;
    for object in objects {
        stdin
            .write_all(object.as_bytes())
            .await
            .map_err(|error| AppError::upstream(format!("Could not query Git objects: {error}")))?;
        stdin
            .write_all(b"\n")
            .await
            .map_err(|error| AppError::upstream(format!("Could not query Git objects: {error}")))?;
    }
    drop(stdin);
    let output = child
        .wait_with_output()
        .await
        .map_err(|error| AppError::upstream(format!("Could not read Git objects: {error}")))?;
    if !output.status.success() {
        return Err(AppError::upstream(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    parse_cat_file_batch(&output.stdout, objects)
}

fn parse_cat_file_batch(output: &[u8], objects: &[String]) -> AppResult<Vec<String>> {
    let mut cursor = 0;
    let mut values = Vec::with_capacity(objects.len());
    for object in objects {
        let header_end = output[cursor..]
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|position| cursor + position)
            .ok_or_else(|| AppError::upstream("git cat-file returned an incomplete header."))?;
        let header = std::str::from_utf8(&output[cursor..header_end])
            .map_err(|_| AppError::upstream("git cat-file returned an invalid header."))?;
        if header.ends_with(" missing") {
            return Err(AppError::not_found(format!(
                "Git object {object} was not found."
            )));
        }
        let size = header
            .rsplit_once(' ')
            .and_then(|(_, size)| size.parse::<usize>().ok())
            .ok_or_else(|| AppError::upstream("git cat-file returned an invalid object size."))?;
        let content_start = header_end + 1;
        let content_end = content_start
            .checked_add(size)
            .filter(|end| *end < output.len())
            .ok_or_else(|| AppError::upstream("git cat-file returned an incomplete object."))?;
        if output[content_end] != b'\n' {
            return Err(AppError::upstream(
                "git cat-file returned an invalid object boundary.",
            ));
        }
        values.push(
            String::from_utf8(output[content_start..content_end].to_vec())
                .map_err(|_| AppError::upstream("Git returned a non-text file."))?,
        );
        cursor = content_end + 1;
    }
    Ok(values)
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

async fn text_search(root: &Path, query: &str, mode: &str) -> AppResult<SearchResults> {
    let expression = if mode == "regex" {
        Regex::new(query).map_err(|error| AppError::bad_request(error.to_string()))?
    } else {
        Regex::new(&regex::escape(query))
            .map_err(|error| AppError::bad_request(error.to_string()))?
    };
    let all_files = command::checked(
        "rg",
        &["--files", "--hidden", "--glob", "!.git"],
        Some(root),
    )
    .await
    .unwrap_or_default();
    let mut files = Vec::new();
    for path in all_files
        .lines()
        .filter(|path| expression.is_match(path))
        .take(24)
    {
        let size = tokio::fs::metadata(root.join(path))
            .await
            .map_or(0, |metadata| metadata.len());
        files.push(RepositoryFile {
            path: path.to_owned(),
            size,
            git_status: "clean".to_owned(),
        });
    }
    let mut arguments = vec![
        "--json",
        "--line-number",
        "--column",
        "--max-count",
        "4",
        "--max-filesize",
        "2M",
        "--hidden",
        "--glob",
        "!.git",
        "--smart-case",
    ];
    if mode == "literal" {
        arguments.push("--fixed-strings");
    }
    arguments.extend(["--", query, "."]);
    let result = command::output("rg", &arguments, Some(root)).await?;
    if !result.status.success() && result.status.code() != Some(1) {
        return Err(if mode == "regex" {
            AppError::bad_request(String::from_utf8_lossy(&result.stderr).trim().to_owned())
        } else {
            AppError::upstream("ripgrep could not search this repository.")
        });
    }
    let raw = String::from_utf8_lossy(&result.stdout);
    let mut matches = Vec::new();
    for line in raw.lines().take(100) {
        let Ok(record) = serde_json::from_str::<RipgrepRecord>(line) else {
            continue;
        };
        if record.kind != "match" {
            continue;
        }
        let path = record
            .data
            .path
            .text
            .strip_prefix("./")
            .unwrap_or(&record.data.path.text)
            .to_owned();
        let line_content = record
            .data
            .lines
            .text
            .trim_end_matches(['\r', '\n'])
            .to_owned();
        let source = tokio::fs::read_to_string(root.join(&path))
            .await
            .unwrap_or_default();
        let source_lines = source.lines().map(str::to_owned).collect::<Vec<_>>();
        let index = record.data.line_number.saturating_sub(1);
        let ranges = record
            .data
            .submatches
            .into_iter()
            .map(|part| {
                [
                    byte_to_character(&line_content, part.start),
                    byte_to_character(&line_content, part.end),
                ]
            })
            .collect::<Vec<_>>();
        matches.push(RepositorySearchMatch {
            path,
            line: record.data.line_number,
            column: ranges.first().map_or(1, |range| range[0] + 1),
            line_content,
            context_before: source_lines[index.saturating_sub(2)..index.min(source_lines.len())]
                .to_vec(),
            context_after: source_lines
                .get(index + 1..(index + 3).min(source_lines.len()))
                .unwrap_or(&[])
                .to_vec(),
            ranges,
            definition: false,
        });
    }
    Ok(SearchResults { files, matches })
}

async fn fuzzy_search(
    root: &Path,
    query: &str,
    picker: SharedFilePicker,
) -> AppResult<SearchResults> {
    let query_lower = query.to_lowercase();
    let picker_query = query.to_owned();
    let ranked = tokio::task::spawn_blocking(move || -> AppResult<Vec<String>> {
        use std::time::Duration;
        if !picker.wait_for_scan(Duration::from_secs(15)) {
            return Err(AppError::internal(
                "FFF did not finish indexing the repository.",
            ));
        }
        let guard = picker
            .read()
            .map_err(|error| AppError::internal(format!("FFF index unavailable: {error}")))?;
        let picker = guard
            .as_ref()
            .ok_or_else(|| AppError::internal("FFF index unavailable."))?;
        let parsed = QueryParser::default().parse(&picker_query);
        let result = picker.fuzzy_search(
            &parsed,
            None,
            FuzzySearchOptions {
                pagination: PaginationArgs {
                    offset: 0,
                    limit: 24,
                },
                ..FuzzySearchOptions::default()
            },
        );
        Ok(result
            .items
            .into_iter()
            .map(|item| item.relative_path(picker))
            .collect())
    })
    .await
    .map_err(|error| AppError::internal(format!("FFF search task failed: {error}")))??;
    let mut matches = Vec::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| entry.file_name() != ".git")
        .flatten()
        .filter(|entry| entry.file_type().is_file())
        .take(20_000)
    {
        let Ok(relative) = entry.path().strip_prefix(root) else {
            continue;
        };
        let path = relative.to_string_lossy().into_owned();
        if matches.len() < 36 {
            let content = tokio::fs::read_to_string(entry.path())
                .await
                .unwrap_or_default();
            let source_lines = content.lines().map(str::to_owned).collect::<Vec<_>>();
            for (index, line) in source_lines
                .iter()
                .enumerate()
                .filter(|(_, line)| line.to_lowercase().contains(&query_lower))
                .take(4)
            {
                let start = line.to_lowercase().find(&query_lower).unwrap_or(0);
                matches.push(RepositorySearchMatch {
                    path: path.clone(),
                    line: index + 1,
                    column: start + 1,
                    line_content: line.clone(),
                    context_before: source_lines[index.saturating_sub(2)..index].to_vec(),
                    context_after: source_lines
                        .get(index + 1..(index + 3).min(source_lines.len()))
                        .unwrap_or(&[])
                        .to_vec(),
                    ranges: vec![[start, start + query.chars().count()]],
                    definition: false,
                });
            }
        }
    }
    Ok(SearchResults {
        files: ranked
            .into_iter()
            .map(|path| RepositoryFile {
                size: std::fs::metadata(root.join(&path)).map_or(0, |metadata| metadata.len()),
                path,
                git_status: "clean".to_owned(),
            })
            .collect(),
        matches,
    })
}

fn byte_to_character(value: &str, byte: usize) -> usize {
    value.get(..byte).unwrap_or(value).chars().count()
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

async fn inspect_source_control(root: &Path, refresh: bool) -> AppResult<SourceControlStatus> {
    let checked_at = now_ms();
    let remote = if refresh {
        let fetch = git_result(root, &["fetch", "--prune", "--quiet", "origin"]).await?;
        let list = git_result(root, &["ls-remote", "--heads", "origin"]).await?;
        if fetch.0 && list.0 {
            RemoteState::RemoteCurrent { checked_at }
        } else {
            RemoteState::RemoteUnavailable {
                checked_at,
                error: [fetch.1, list.1]
                    .into_iter()
                    .filter(|value| !value.trim().is_empty())
                    .collect::<Vec<_>>()
                    .join("\n"),
            }
        }
    } else {
        RemoteState::RemoteCurrent { checked_at }
    };
    let local_raw = command::git(
        root,
        &[
            "for-each-ref",
            "--format=%(refname:short)%00%(objectname)",
            "refs/heads",
        ],
    )
    .await?;
    let local_names = local_raw
        .lines()
        .filter_map(|line| line.split_once('\0').map(|(name, _)| name.to_owned()))
        .collect::<BTreeSet<_>>();
    let remote_raw = command::git(
        root,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/remotes/origin",
        ],
    )
    .await
    .unwrap_or_default();
    let remote_names = remote_raw
        .lines()
        .filter_map(|line| line.strip_prefix("origin/"))
        .filter(|name| *name != "HEAD")
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
    let branches = local_names
        .union(&remote_names)
        .map(|name| Branch {
            name: name.clone(),
            local: local_names.contains(name),
            remote: remote_names.contains(name),
        })
        .collect();
    let oid = command::git(root, &["rev-parse", "HEAD"])
        .await?
        .trim()
        .to_owned();
    let symbolic = git_result(root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).await?;
    let checkout = if symbolic.0 {
        let name = symbolic.1.trim().to_owned();
        let upstream = command::git(
            root,
            &[
                "for-each-ref",
                "--format=%(upstream:short)",
                &format!("refs/heads/{name}"),
            ],
        )
        .await
        .unwrap_or_default()
        .trim()
        .to_owned();
        if upstream.is_empty() {
            Checkout::UntrackedBranch { name, oid }
        } else {
            let counts = command::git(
                root,
                &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
            )
            .await
            .unwrap_or_default();
            let mut values = counts
                .split_whitespace()
                .filter_map(|value| value.parse::<usize>().ok());
            Checkout::TrackingBranch {
                name,
                oid,
                upstream,
                ahead: values.next().unwrap_or(0),
                behind: values.next().unwrap_or(0),
            }
        }
    } else {
        Checkout::DetachedHead { oid }
    };
    let staged = command::git(root, &["diff", "--cached", "--name-only", "-z"])
        .await?
        .split('\0')
        .filter(|value| !value.is_empty())
        .count();
    let unstaged = command::git(root, &["diff", "--name-only", "-z"])
        .await?
        .split('\0')
        .filter(|value| !value.is_empty())
        .count();
    let untracked = command::git(root, &["ls-files", "--others", "--exclude-standard", "-z"])
        .await?
        .split('\0')
        .filter(|value| !value.is_empty())
        .count();
    Ok(SourceControlStatus {
        path: root.to_string_lossy().into_owned(),
        checkout,
        branches,
        changes: WorkingTreeChanges {
            staged,
            unstaged,
            untracked,
        },
        remote,
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

#[derive(Deserialize)]
struct RipgrepText {
    text: String,
}
#[derive(Deserialize)]
struct RipgrepSubmatch {
    start: usize,
    end: usize,
}
#[derive(Deserialize)]
struct RipgrepData {
    path: RipgrepText,
    lines: RipgrepText,
    line_number: usize,
    submatches: Vec<RipgrepSubmatch>,
}
#[derive(Deserialize)]
struct RipgrepRecord {
    #[serde(rename = "type")]
    kind: String,
    data: RipgrepData,
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
    fn parses_batched_git_objects_without_losing_embedded_newlines() {
        let objects = vec!["base:a.txt".to_owned(), "head:a.txt".to_owned()];
        let output = b"1111111111111111111111111111111111111111 blob 5\nhello\n2222222222222222222222222222222222222222 blob 6\nworld\n\n";
        assert_eq!(
            parse_cat_file_batch(output, &objects).unwrap(),
            vec!["hello".to_owned(), "world\n".to_owned()]
        );
    }

    #[test]
    fn reads_gitlink_revisions_from_the_superproject_patch() {
        assert_eq!(
            gitlink_text(
                "@@ -1 +0,0 @@\n-Subproject commit de2a9a69099993087e57c64df58537c765ac0224",
                '-'
            ),
            Some("Subproject commit de2a9a69099993087e57c64df58537c765ac0224\n".to_owned())
        );
    }
}
