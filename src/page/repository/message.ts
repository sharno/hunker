import { Schema as S } from "effect";
import { m } from "foldkit/message";

import { RepositorySearchMode } from "../../features/code-search";
import {
  PullRequestFilter,
  RepositoryPullRequest,
} from "../../features/repository-pulls";
import { Commit, File, SearchMatch } from "./model";
import * as SourceControl from "./source-control";

export const CompletedNavigate = m("CompletedNavigate");
export const GotSourceControlMessage = m("GotSourceControlMessage", {
  message: SourceControl.Message,
});
export const SucceededFetchRepositoryFiles = m(
  "SucceededFetchRepositoryFiles",
  {
    repository: S.String,
    files: S.Array(File),
  },
);
export const FailedFetchRepositoryFiles = m("FailedFetchRepositoryFiles", {
  repository: S.String,
  error: S.String,
  missing: S.Boolean,
});
export const ClickedCloneRepository = m("ClickedCloneRepository", {
  destination: S.Literals(["temporary", "configured"]),
});
export const SucceededCloneRepository = m("SucceededCloneRepository", {
  repository: S.String,
  path: S.String,
});
export const FailedCloneRepository = m("FailedCloneRepository", {
  repository: S.String,
  error: S.String,
});
export const UpdatedRepositoryQuery = m("UpdatedRepositoryQuery", {
  value: S.String,
});
export const SelectedRepositorySearchMode = m("SelectedRepositorySearchMode", {
  mode: RepositorySearchMode,
});
export const SubmittedRepositorySearch = m("SubmittedRepositorySearch");
export const SucceededSearchRepository = m("SucceededSearchRepository", {
  repository: S.String,
  query: S.String,
  mode: RepositorySearchMode,
  files: S.Array(File),
  matches: S.Array(SearchMatch),
});
export const FailedSearchRepository = m("FailedSearchRepository", {
  repository: S.String,
  query: S.String,
  mode: RepositorySearchMode,
  error: S.String,
});
export const SelectedRepositoryFile = m("SelectedRepositoryFile", {
  path: S.String,
});
export const ClickedCloseRepositoryFile = m("ClickedCloseRepositoryFile");
export const SucceededFetchRepositoryFile = m("SucceededFetchRepositoryFile", {
  repository: S.String,
  path: S.String,
  content: S.String,
  truncated: S.Boolean,
});
export const FailedFetchRepositoryFile = m("FailedFetchRepositoryFile", {
  repository: S.String,
  path: S.String,
  error: S.String,
});
export const ToggledRepositoryFolder = m("ToggledRepositoryFolder", {
  path: S.String,
});
export const SelectedRepositoryTab = m("SelectedRepositoryTab", {
  tab: S.Literals(["files", "pulls", "commits"]),
});
export const SelectedPullRequestFilter = m("SelectedPullRequestFilter", {
  state: PullRequestFilter,
});
export const ClickedLoadMorePullRequests = m("ClickedLoadMorePullRequests");
export const SucceededFetchRepositoryPullRequests = m(
  "SucceededFetchRepositoryPullRequests",
  {
    repository: S.String,
    state: PullRequestFilter,
    page: S.Number,
    hasMore: S.Boolean,
    pullRequests: S.Array(RepositoryPullRequest),
  },
);
export const FailedFetchRepositoryPullRequests = m(
  "FailedFetchRepositoryPullRequests",
  {
    repository: S.String,
    state: PullRequestFilter,
    page: S.Number,
    error: S.String,
  },
);
export const SucceededFetchRepositoryCommits = m(
  "SucceededFetchRepositoryCommits",
  {
    repository: S.String,
    ref: S.String,
    shallow: S.Boolean,
    commits: S.Array(Commit),
  },
);
export const FailedFetchRepositoryCommits = m("FailedFetchRepositoryCommits", {
  repository: S.String,
  error: S.String,
});

export const Message = S.Union([
  CompletedNavigate,
  GotSourceControlMessage,
  SucceededFetchRepositoryFiles,
  FailedFetchRepositoryFiles,
  ClickedCloneRepository,
  SucceededCloneRepository,
  FailedCloneRepository,
  UpdatedRepositoryQuery,
  SelectedRepositorySearchMode,
  SubmittedRepositorySearch,
  SucceededSearchRepository,
  FailedSearchRepository,
  SelectedRepositoryFile,
  ClickedCloseRepositoryFile,
  SucceededFetchRepositoryFile,
  FailedFetchRepositoryFile,
  ToggledRepositoryFolder,
  SelectedRepositoryTab,
  SelectedPullRequestFilter,
  ClickedLoadMorePullRequests,
  SucceededFetchRepositoryPullRequests,
  FailedFetchRepositoryPullRequests,
  SucceededFetchRepositoryCommits,
  FailedFetchRepositoryCommits,
]);
export type Message = typeof Message.Type;
