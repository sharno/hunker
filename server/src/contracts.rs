use std::{fs, path::Path};

use crate::{
    api::{repository::SourceControlResponse, review::CommentsResponse},
    error::{AppError, AppResult},
    github::{CommentSide, ReviewComment, repository_pulls_contract_fixture},
    local,
    types::{FileChange, FileStatus, ReviewBacking, ReviewDocument},
};

const FIXTURE_PATH: &str = "elm/src/Hunker/Generated/ContractFixtures.elm";

pub fn write() -> AppResult<()> {
    let path = Path::new(FIXTURE_PATH);
    let parent = path
        .parent()
        .ok_or_else(|| AppError::internal("Contract fixture path has no parent."))?;
    fs::create_dir_all(parent).map_err(|error| {
        AppError::internal(format!(
            "Could not create contract fixture directory: {error}"
        ))
    })?;
    fs::write(path, render()?)
        .map_err(|error| AppError::internal(format!("Could not write contract fixtures: {error}")))
}

pub fn check() -> AppResult<()> {
    let expected = render()?;
    let actual = fs::read_to_string(FIXTURE_PATH).map_err(|error| {
        AppError::internal(format!(
            "Could not read {FIXTURE_PATH}: {error}. Run bun run contracts:write."
        ))
    })?;
    if actual == expected {
        Ok(())
    } else {
        Err(AppError::internal(
            "Rust/Elm contract fixtures are stale. Run bun run contracts:write.",
        ))
    }
}

fn render() -> AppResult<String> {
    let fixtures = [
        ("reviewDocument", json(&review_document())?),
        (
            "repositoryPulls",
            json(&repository_pulls_contract_fixture())?,
        ),
        (
            "sourceControl",
            json(&SourceControlResponse {
                status: local::source_control_contract_fixture(),
            })?,
        ),
        ("reviewComments", json(&review_comments())?),
    ];
    let mut output = String::from(
        "module Hunker.Generated.ContractFixtures exposing (repositoryPulls, reviewComments, reviewDocument, sourceControl)\n\n\n",
    );
    for (index, (name, value)) in fixtures.into_iter().enumerate() {
        output.push_str(name);
        output.push_str(" : String\n");
        output.push_str(name);
        output.push_str(" =\n    ");
        output.push_str(&serde_json::to_string(&value).map_err(|error| {
            AppError::internal(format!("Could not serialize contract fixture: {error}"))
        })?);
        output.push('\n');
        if index < 3 {
            output.push_str("\n\n");
        }
    }
    Ok(output)
}

fn json<T: serde::Serialize>(value: &T) -> AppResult<String> {
    serde_json::to_string(value).map_err(|error| {
        AppError::internal(format!("Could not serialize contract fixture: {error}"))
    })
}

fn review_document() -> ReviewDocument {
    ReviewDocument {
        title: "Keep Rust and Elm contracts aligned".to_owned(),
        repository: "acme/hunker".to_owned(),
        number: "42".to_owned(),
        author: "agent".to_owned(),
        base: "main".to_owned(),
        head: "typed-contracts".to_owned(),
        url: "https://github.com/acme/hunker/pull/42".to_owned(),
        files: vec![FileChange {
            path: "src/main.rs".to_owned(),
            previous_path: None,
            status: FileStatus::Modified,
            additions: 1,
            deletions: 1,
            patch: "@@ -1 +1 @@\n-old\n+new".to_owned(),
        }],
        backing: ReviewBacking::GitHub {
            base_oid: "1111111111111111111111111111111111111111".to_owned(),
            head_oid: "2222222222222222222222222222222222222222".to_owned(),
            head_ref: "typed-contracts".to_owned(),
        },
    }
}

fn review_comments() -> CommentsResponse {
    CommentsResponse {
        comments: vec![ReviewComment {
            id: 7,
            root_id: 7,
            path: "src/main.rs".to_owned(),
            body: "Please keep this typed.".to_owned(),
            author: "reviewer".to_owned(),
            html_url: "https://github.com/acme/hunker/pull/42#discussion_r7".to_owned(),
            created_at: "2026-08-10T12:00:00Z".to_owned(),
            line: Some(12),
            side: CommentSide::Right,
            resolved: false,
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_an_elm_module_from_rust_domain_values() {
        let source = render().unwrap();
        assert!(source.contains("reviewDocument : String"));
        assert!(source.contains("\\\"_tag\\\":\\\"GitHub\\\""));
        assert!(source.contains("repositoryPulls : String"));
    }
}
