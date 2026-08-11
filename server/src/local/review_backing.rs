use std::path::Path;

use crate::{
    command,
    error::{AppError, AppResult},
    github::{GitHubTarget, PullNumber, ReviewMetadata},
    types::{FilePair, FileStatus, LocalGitRepository, PullCommit, RepositorySlug},
};

use super::{
    DEEPEN_STEPS, FETCH_INTERVAL_MS, Local, PullRevision, git_result, now_ms, objects, valid_oid,
};

impl Local {
    async fn has_object(path: &Path, oid: &str) -> AppResult<bool> {
        if !valid_oid(oid) {
            return Ok(false);
        }
        let (present, output, _) =
            git_result(path, &["cat-file", "-e", &format!("{oid}^{{commit}}")]).await?;
        if present {
            Ok(true)
        } else if output.contains("Not a valid object name") {
            Ok(false)
        } else {
            Err(AppError::upstream(if output.trim().is_empty() {
                format!("Git could not inspect object {oid}.")
            } else {
                output.trim().to_owned()
            }))
        }
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
        number: &PullNumber,
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
        repository_id: &RepositorySlug,
        base: &str,
        head: &str,
        pull: Option<&PullNumber>,
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
            self.fetch_pull(&repository, number, true).await?;
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
                command::git(&repository.path, &args).await?;
            }
        }
        if Self::has_object(&repository.path, base).await?
            && Self::has_object(&repository.path, head).await?
        {
            Ok(Some(repository))
        } else {
            Err(AppError::upstream(
                "Local Git could not materialize the requested immutable revision.",
            ))
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
            objects::validate_git_path(&file.path)?;
            if let Some(previous_path) = &file.previous_path {
                objects::validate_git_path(previous_path)?;
            }
            let old_path = file.previous_path.as_deref().unwrap_or(&file.path);
            let old = if file.status == FileStatus::Added {
                ContentSource::Empty
            } else if let Some(text) = objects::gitlink_text(&file.patch, '-') {
                ContentSource::Inline(text)
            } else {
                let position = objects.len();
                objects.push(format!("{base}:{old_path}"));
                ContentSource::Batch(position)
            };
            let new = if file.status == FileStatus::Deleted {
                ContentSource::Empty
            } else if let Some(text) = objects::gitlink_text(&file.patch, '+') {
                ContentSource::Inline(text)
            } else {
                let position = objects.len();
                objects.push(format!("{head}:{}", file.path));
                ContentSource::Batch(position)
            };
            positions.push((old, new));
        }
        let contents = objects::cat_file_batch(&repository.path, &objects).await?;
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
