import { expect, test } from "@playwright/test";
import { Effect } from "effect";

import { decodePullCommits, parseGitHubUrl } from "../backend/github";

test("parses commit URLs as first-class diff targets", async () => {
  await expect(
    Effect.runPromise(
      parseGitHubUrl(
        "https://github.com/example/hunker/commit/abcdef1234567890abcdef1234567890abcdef12",
      ),
    ),
  ).resolves.toEqual({
    _tag: "CommitTarget",
    owner: "example",
    repo: "hunker",
    sha: "abcdef1234567890abcdef1234567890abcdef12",
  });
});

test("decodes the commit metadata used by the commits view", () => {
  expect(
    decodePullCommits([
      {
        sha: "abcdef1234567890",
        html_url: "https://github.com/example/hunker/commit/abcdef1",
        author: {
          login: "octocat",
          avatar_url: "https://example.com/avatar.png",
        },
        commit: {
          message: "Add commit view\n\nKeep commit navigation local.",
          author: { name: "Octo Cat", date: "2026-08-01T12:00:00Z" },
        },
      },
    ]),
  ).toEqual([
    {
      sha: "abcdef1234567890",
      message: "Add commit view\n\nKeep commit navigation local.",
      author: "octocat",
      avatarUrl: "https://example.com/avatar.png",
      authoredAt: "2026-08-01T12:00:00Z",
      htmlUrl: "https://github.com/example/hunker/commit/abcdef1",
    },
  ]);
});
