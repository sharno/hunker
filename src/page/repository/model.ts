import { Schema as S } from "effect";
import { AsyncData } from "foldkit";

import { RepositorySearchMode } from "../../features/code-search";
import {
  PullRequestFilter,
  RepositoryPullRequestsPage,
} from "../../features/repository-pulls";

export const File = S.Struct({
  path: S.String,
  size: S.Number,
  gitStatus: S.String,
});
export type File = typeof File.Type;

export const SearchMatch = S.Struct({
  path: S.String,
  line: S.Number,
  column: S.Number,
  lineContent: S.String,
  contextBefore: S.Array(S.String),
  contextAfter: S.Array(S.String),
  ranges: S.Array(S.Tuple([S.Number, S.Number])),
  definition: S.Boolean,
});
export type SearchMatch = typeof SearchMatch.Type;

export const FilesError = S.Struct({
  message: S.String,
  missing: S.Boolean,
});
export const Files = AsyncData.Schema(S.Array(File), FilesError);

export const SearchData = S.Struct({
  query: S.String,
  mode: RepositorySearchMode,
  files: S.Array(File),
  matches: S.Array(SearchMatch),
});
export const Search = AsyncData.Schema(SearchData, S.String);

export const FileData = S.Struct({
  path: S.String,
  content: S.String,
  truncated: S.Boolean,
});
export const FileContent = AsyncData.Schema(FileData, S.String);

export const Clone = AsyncData.Schema(S.Struct({ path: S.String }), S.String);

export const Commit = S.Struct({
  sha: S.String,
  parents: S.Array(S.String),
  authorName: S.String,
  authorEmail: S.String,
  authoredAt: S.String,
  subject: S.String,
});
export type Commit = typeof Commit.Type;

export const CommitsData = S.Struct({
  ref: S.String,
  shallow: S.Boolean,
  commits: S.Array(Commit),
});
export const Commits = AsyncData.Schema(CommitsData, S.String);

export const PullRequests = AsyncData.Schema(
  RepositoryPullRequestsPage,
  S.String,
);

export const Model = S.Struct({
  owner: S.String,
  name: S.String,
  tab: S.Literals(["files", "pulls", "commits"]),
  pullRequestFilter: PullRequestFilter,
  query: S.String,
  searchMode: RepositorySearchMode,
  selectedPath: S.String,
  collapsedFolders: S.Array(S.String),
  files: Files.schema,
  search: Search.schema,
  file: FileContent.schema,
  clone: Clone.schema,
  commits: Commits.schema,
  pullRequests: PullRequests.schema,
});
export type Model = typeof Model.Type;

export const empty = (): Model =>
  Model.make({
    owner: "",
    name: "",
    tab: "files",
    pullRequestFilter: "open",
    query: "",
    searchMode: "literal",
    selectedPath: "",
    collapsedFolders: [],
    files: Files.Idle(),
    search: Search.Idle(),
    file: FileContent.Idle(),
    clone: Clone.Idle(),
    commits: Commits.Idle(),
    pullRequests: PullRequests.Idle(),
  });
