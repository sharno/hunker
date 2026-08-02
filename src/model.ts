import { Schema as S } from "effect";
import { AsyncData } from "foldkit";
import { ts } from "foldkit/schema";
import { Popover } from "@foldkit/ui";

import * as GitHubLocation from "./features/github-location";

export const FileChange = S.Struct({
  path: S.String,
  previousPath: S.String,
  status: S.Literals(["modified", "added", "deleted", "renamed"]),
  additions: S.Number,
  deletions: S.Number,
  patch: S.String,
});
export type FileChange = typeof FileChange.Type;

export const ReviewBacking = S.Struct({
  source: S.Literals(["github", "local"]),
  baseOid: S.String,
  headOid: S.String,
  headRef: S.String,
  path: S.String,
});
export type ReviewBacking = typeof ReviewBacking.Type;

export const ReviewMeta = S.Struct({
  title: S.String,
  repository: S.String,
  number: S.String,
  author: S.String,
  base: S.String,
  head: S.String,
  url: S.String,
  backing: ReviewBacking,
});
export type ReviewMeta = typeof ReviewMeta.Type;

export const ReviewRevisionIdle = ts("Idle");
export const ReviewRevisionChecking = ts("Checking");
export const ReviewRevisionCurrent = ts("Current", { checkedAt: S.Number });
export const ReviewRevisionAvailable = ts("Available", {
  latestHeadOid: S.String,
  checkedAt: S.Number,
});
export const ReviewRevisionFailed = ts("Failed", { error: S.String });
export const ReviewRevision = S.Union([
  ReviewRevisionIdle,
  ReviewRevisionChecking,
  ReviewRevisionCurrent,
  ReviewRevisionAvailable,
  ReviewRevisionFailed,
]);
export type ReviewRevision = typeof ReviewRevision.Type;

export const PullCommit = S.Struct({
  sha: S.String,
  message: S.String,
  author: S.String,
  avatarUrl: S.String,
  authoredAt: S.String,
  htmlUrl: S.String,
});
export type PullCommit = typeof PullCommit.Type;

export const PullCommits = AsyncData.Schema(S.Array(PullCommit), S.String);

export const CommitDiffData = S.Struct({
  sha: S.String,
  files: S.Array(FileChange),
});
export const CommitDiff = AsyncData.Schema(CommitDiffData, S.String);

export const RepositoryFile = S.Struct({
  path: S.String,
  size: S.Number,
  gitStatus: S.String,
});
export type RepositoryFile = typeof RepositoryFile.Type;

export const RepositorySearchMatch = S.Struct({
  path: S.String,
  line: S.Number,
  column: S.Number,
  lineContent: S.String,
  contextBefore: S.Array(S.String),
  contextAfter: S.Array(S.String),
  ranges: S.Array(S.Tuple([S.Number, S.Number])),
  definition: S.Boolean,
});
export type RepositorySearchMatch = typeof RepositorySearchMatch.Type;

export const RepositoryFilesError = S.Struct({
  message: S.String,
  missing: S.Boolean,
});
export const RepositoryFiles = AsyncData.Schema(
  S.Array(RepositoryFile),
  RepositoryFilesError,
);

export const RepositorySearchData = S.Struct({
  query: S.String,
  files: S.Array(RepositoryFile),
  matches: S.Array(RepositorySearchMatch),
});
export const RepositorySearch = AsyncData.Schema(
  RepositorySearchData,
  S.String,
);

export const RepositoryFileData = S.Struct({
  path: S.String,
  content: S.String,
  truncated: S.Boolean,
});
export const RepositoryFileContent = AsyncData.Schema(
  RepositoryFileData,
  S.String,
);

export const RepositoryClone = AsyncData.Schema(
  S.Struct({ path: S.String }),
  S.String,
);

export const RepositoryBrowser = S.Struct({
  owner: S.String,
  name: S.String,
  query: S.String,
  selectedPath: S.String,
  files: RepositoryFiles.schema,
  search: RepositorySearch.schema,
  file: RepositoryFileContent.schema,
  clone: RepositoryClone.schema,
});
export type RepositoryBrowser = typeof RepositoryBrowser.Type;

export const SourceRange = S.Struct({
  startLine: S.Number,
  endLine: S.Number,
  startColumn: S.Number,
  endColumn: S.Number,
});
export type SourceRange = typeof SourceRange.Type;

export const SemanticInserted = ts("Inserted", {
  kind: S.String,
  label: S.String,
  newRange: SourceRange,
  confidence: S.Number,
});
export const SemanticDeleted = ts("Deleted", {
  kind: S.String,
  label: S.String,
  oldRange: SourceRange,
  confidence: S.Number,
});
export const SemanticUpdated = ts("Updated", {
  kind: S.String,
  label: S.String,
  oldRange: SourceRange,
  newRange: SourceRange,
  confidence: S.Number,
});
export const SemanticRenamed = ts("Renamed", {
  kind: S.String,
  oldLabel: S.String,
  newLabel: S.String,
  oldRange: SourceRange,
  newRange: SourceRange,
  confidence: S.Number,
});
export const SemanticChange = S.Union([
  SemanticInserted,
  SemanticDeleted,
  SemanticUpdated,
  SemanticRenamed,
]);
export type SemanticChange = typeof SemanticChange.Type;

export const SemanticParsed = ts("Parsed", {
  path: S.String,
  language: S.String,
  semanticEqual: S.Boolean,
  changes: S.Array(SemanticChange),
});
export const SemanticUnsupported = ts("Unsupported", {
  path: S.String,
  reason: S.String,
});
export const SemanticParseFailed = ts("ParseFailed", {
  path: S.String,
  language: S.String,
  reason: S.String,
});
export const SemanticResult = S.Union([
  SemanticParsed,
  SemanticUnsupported,
  SemanticParseFailed,
]);
export type SemanticResult = typeof SemanticResult.Type;

// This is a single-flight scheduler; completed semantic data lives in
// semanticResults, so it is intentionally not a second remote-data cache.
export const SemanticRequestIdle = ts("Idle");
export const SemanticRequestLoading = ts("Loading", { path: S.String });
export const SemanticRequestFailed = ts("Failed", {
  path: S.String,
  error: S.String,
});
export const SemanticRequest = S.Union([
  SemanticRequestIdle,
  SemanticRequestLoading,
  SemanticRequestFailed,
]);
export type SemanticRequest = typeof SemanticRequest.Type;

export const MovedBlock = S.Struct({
  fromPath: S.String,
  toPath: S.String,
  fromLine: S.Number,
  toLine: S.Number,
  lineCount: S.Number,
  preview: S.String,
  kind: S.String,
  label: S.String,
  confidence: S.Number,
  changed: S.Boolean,
});
export type MovedBlock = typeof MovedBlock.Type;

export const ReviewMoves = AsyncData.Schema(S.Array(MovedBlock), S.String);

export const CharacterRange = S.Struct({
  start: S.Number,
  end: S.Number,
});
export type CharacterRange = typeof CharacterRange.Type;

export const InlineDiffMode = S.Literals(["token", "character", "off"]);
export type InlineDiffMode = typeof InlineDiffMode.Type;

export const CharacterDiffRow = S.Struct({
  oldLine: S.NullOr(S.Number),
  newLine: S.NullOr(S.Number),
  oldRanges: S.Array(CharacterRange),
  newRanges: S.Array(CharacterRange),
});
export type CharacterDiffRow = typeof CharacterDiffRow.Type;

export const CharacterDiffResult = S.Struct({
  path: S.String,
  ignoreWhitespace: S.Boolean,
  mode: S.Literals(["token", "character"]),
  rows: S.Array(CharacterDiffRow),
});
export type CharacterDiffResult = typeof CharacterDiffResult.Type;

const CharacterDiffKeyFields = {
  path: S.String,
  ignoreWhitespace: S.Boolean,
  mode: S.Literals(["token", "character"]),
};
export const CharacterDiffState = AsyncData.Schema(
  CharacterDiffResult,
  S.String,
);
export const CharacterDiffEntry = S.Struct({
  ...CharacterDiffKeyFields,
  state: CharacterDiffState.schema,
});
export type CharacterDiffEntry = typeof CharacterDiffEntry.Type;

export const FullFileData = S.Struct({
  oldText: S.String,
  newText: S.String,
});
export const FullFileState = AsyncData.Schema(FullFileData, S.String);
export const FullFileEntry = S.Struct({
  path: S.String,
  state: FullFileState.schema,
});
export type FullFileEntry = typeof FullFileEntry.Type;

export const GitHubReviewComment = S.Struct({
  id: S.Number,
  rootId: S.Number,
  path: S.String,
  body: S.String,
  author: S.String,
  htmlUrl: S.String,
  createdAt: S.String,
  line: S.NullOr(S.Number),
  side: S.Literals(["LEFT", "RIGHT"]),
  resolved: S.Boolean,
});
export type GitHubReviewComment = typeof GitHubReviewComment.Type;

export const GitHubReviews = AsyncData.Schema(
  S.Array(GitHubReviewComment),
  S.String,
);

export const ReplyDraft = S.Struct({ commentId: S.Number, body: S.String });
export type ReplyDraft = typeof ReplyDraft.Type;
// Reply state is a keyed in-flight operation; successful replies are stored in
// githubReviews and therefore do not need a duplicated success cache here.
export const ReplyLoading = ts("Loading", { commentId: S.Number });
export const ReplyFailed = ts("Failed", {
  commentId: S.Number,
  error: S.String,
});
export const ReplyState = S.Union([ReplyLoading, ReplyFailed]);
export type ReplyState = typeof ReplyState.Type;

export const ReviewEvent = S.Literals([
  "COMMENT",
  "APPROVE",
  "REQUEST_CHANGES",
]);
export const ReviewSubmission = AsyncData.Schema(ReviewEvent, S.String);

export const ReviewReady = ts("Ready");
export const ReviewLoading = ts("Loading");
export const ReviewFailed = ts("Failed", { error: S.String });
export const ReviewPhase = S.Union([ReviewReady, ReviewLoading, ReviewFailed]);

export const Model = S.Struct({
  page: S.Literals(["review", "repository"]),
  phase: ReviewPhase,
  githubLocation: GitHubLocation.Model,
  prUrl: S.String,
  filter: S.String,
  meta: ReviewMeta,
  reviewRevision: ReviewRevision,
  files: S.Array(FileChange),
  pullRequestFiles: S.Array(FileChange),
  reviewTab: S.Literals(["files", "commits"]),
  commits: PullCommits.schema,
  selectedCommit: S.String,
  commitDiff: CommitDiff.schema,
  repositoryBrowser: RepositoryBrowser,
  diffOptionsPopover: Popover.Model,
  openReviewPopover: Popover.Model,
  toolbarCompact: S.Boolean,
  selectedPath: S.String,
  sidebarCollapsed: S.Boolean,
  reviewScope: S.Literals(["file", "full"]),
  viewMode: S.Literals(["unified", "split"]),
  ignoreWhitespace: S.Boolean,
  semantic: S.Boolean,
  inlineDiffMode: InlineDiffMode,
  syntaxHighlighting: S.Boolean,
  reviewedPaths: S.Array(S.String),
  semanticResults: S.Array(SemanticResult),
  semanticRequest: SemanticRequest,
  reviewMoves: ReviewMoves.schema,
  characterDiffStates: S.Array(CharacterDiffEntry),
  collapsedPaths: S.Array(S.String),
  collapsedHunks: S.Array(S.String),
  fullFileStates: S.Array(FullFileEntry),
  showGitHubReviews: S.Boolean,
  githubReviews: GitHubReviews.schema,
  collapsedReviewThreads: S.Array(S.Number),
  replyDrafts: S.Array(ReplyDraft),
  replyStates: S.Array(ReplyState),
  reviewBody: S.String,
  reviewSubmission: ReviewSubmission.schema,
});
export type Model = typeof Model.Type;
