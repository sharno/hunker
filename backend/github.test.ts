import { expect, test } from "vitest";
import { Effect } from "effect";

import {
  decodePullCommits,
  decodeRepositoryPullRequests,
  parseGitHubUrl,
} from "./github";

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

test("decodes repository pull requests and distinguishes merged PRs", () => {
  expect(
    decodeRepositoryPullRequests([
      {
        number: 42,
        title: "Refine the diff viewer",
        state: "closed",
        draft: false,
        user: { login: "review-agent", avatar_url: "https://avatar.test/42" },
        updated_at: "2026-08-02T12:00:00Z",
        merged_at: "2026-08-02T13:00:00Z",
        base: { ref: "main" },
        head: { label: "review-agent:feature/review" },
        labels: [{ name: "frontend" }],
      },
    ]),
  ).toEqual([
    {
      number: 42,
      title: "Refine the diff viewer",
      author: "review-agent",
      avatarUrl: "https://avatar.test/42",
      state: "merged",
      draft: false,
      updatedAt: "2026-08-02T12:00:00Z",
      base: "main",
      head: "review-agent:feature/review",
      labels: ["frontend"],
    },
  ]);
});
