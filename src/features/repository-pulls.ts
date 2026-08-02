import { Schema as S } from "effect";

export const PullRequestFilter = S.Literals(["open", "closed", "all"]);
export type PullRequestFilter = typeof PullRequestFilter.Type;

export const RepositoryPullRequest = S.Struct({
  number: S.Number,
  title: S.String,
  author: S.String,
  avatarUrl: S.String,
  state: S.Literals(["open", "closed", "merged"]),
  draft: S.Boolean,
  updatedAt: S.String,
  base: S.String,
  head: S.String,
  labels: S.Array(S.String),
});
export type RepositoryPullRequest = typeof RepositoryPullRequest.Type;

export const RepositoryPullRequestsPage = S.Struct({
  state: PullRequestFilter,
  page: S.Number,
  hasMore: S.Boolean,
  pullRequests: S.Array(RepositoryPullRequest),
});
export type RepositoryPullRequestsPage = typeof RepositoryPullRequestsPage.Type;
