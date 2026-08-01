import { Schema as S } from "effect";
import { m } from "foldkit/message";

export const FileChange = S.Struct({
  path: S.String,
  previousPath: S.String,
  status: S.Literals(["modified", "added", "deleted", "renamed"]),
  additions: S.Number,
  deletions: S.Number,
  patch: S.String,
});
export type FileChange = typeof FileChange.Type;

export const ReviewMeta = S.Struct({
  title: S.String,
  repository: S.String,
  number: S.String,
  author: S.String,
  base: S.String,
  head: S.String,
  url: S.String,
});
export type ReviewMeta = typeof ReviewMeta.Type;

export const PullCommit = S.Struct({
  sha: S.String,
  message: S.String,
  author: S.String,
  avatarUrl: S.String,
  authoredAt: S.String,
  htmlUrl: S.String,
});
export type PullCommit = typeof PullCommit.Type;

export const PullCommits = S.Union([
  S.TaggedStruct("Idle", {}),
  S.TaggedStruct("Loading", {}),
  S.TaggedStruct("Ready", { commits: S.Array(PullCommit) }),
  S.TaggedStruct("Failed", { error: S.String }),
]);
export type PullCommits = typeof PullCommits.Type;

export const CommitDiff = S.Union([
  S.TaggedStruct("Idle", {}),
  S.TaggedStruct("Loading", { sha: S.String }),
  S.TaggedStruct("Ready", { sha: S.String, files: S.Array(FileChange) }),
  S.TaggedStruct("Failed", { sha: S.String, error: S.String }),
]);
export type CommitDiff = typeof CommitDiff.Type;

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

export const RepositoryFiles = S.Union([
  S.TaggedStruct("Idle", {}),
  S.TaggedStruct("Loading", {}),
  S.TaggedStruct("Ready", { files: S.Array(RepositoryFile) }),
  S.TaggedStruct("Failed", { error: S.String }),
]);

export const RepositorySearch = S.Union([
  S.TaggedStruct("Idle", {}),
  S.TaggedStruct("Loading", { query: S.String }),
  S.TaggedStruct("Ready", {
    query: S.String,
    files: S.Array(RepositoryFile),
    matches: S.Array(RepositorySearchMatch),
  }),
  S.TaggedStruct("Failed", { query: S.String, error: S.String }),
]);

export const RepositoryFileContent = S.Union([
  S.TaggedStruct("Idle", {}),
  S.TaggedStruct("Loading", { path: S.String }),
  S.TaggedStruct("Ready", {
    path: S.String,
    content: S.String,
    truncated: S.Boolean,
  }),
  S.TaggedStruct("Failed", { path: S.String, error: S.String }),
]);

export const RepositoryBrowser = S.Struct({
  owner: S.String,
  name: S.String,
  query: S.String,
  selectedPath: S.String,
  files: RepositoryFiles,
  search: RepositorySearch,
  file: RepositoryFileContent,
});
export type RepositoryBrowser = typeof RepositoryBrowser.Type;

export const SourceRange = S.Struct({
  startLine: S.Number,
  endLine: S.Number,
  startColumn: S.Number,
  endColumn: S.Number,
});
export type SourceRange = typeof SourceRange.Type;

export const SemanticChange = S.Union([
  S.TaggedStruct("Inserted", {
    kind: S.String,
    label: S.String,
    newRange: SourceRange,
    confidence: S.Number,
  }),
  S.TaggedStruct("Deleted", {
    kind: S.String,
    label: S.String,
    oldRange: SourceRange,
    confidence: S.Number,
  }),
  S.TaggedStruct("Updated", {
    kind: S.String,
    label: S.String,
    oldRange: SourceRange,
    newRange: SourceRange,
    confidence: S.Number,
  }),
  S.TaggedStruct("Renamed", {
    kind: S.String,
    oldLabel: S.String,
    newLabel: S.String,
    oldRange: SourceRange,
    newRange: SourceRange,
    confidence: S.Number,
  }),
]);
export type SemanticChange = typeof SemanticChange.Type;

export const SemanticResult = S.Union([
  S.TaggedStruct("Parsed", {
    path: S.String,
    language: S.String,
    semanticEqual: S.Boolean,
    changes: S.Array(SemanticChange),
  }),
  S.TaggedStruct("Unsupported", {
    path: S.String,
    reason: S.String,
  }),
  S.TaggedStruct("ParseFailed", {
    path: S.String,
    language: S.String,
    reason: S.String,
  }),
]);
export type SemanticResult = typeof SemanticResult.Type;

export const SemanticRequest = S.Union([
  S.TaggedStruct("Idle", {}),
  S.TaggedStruct("Loading", { path: S.String }),
  S.TaggedStruct("Failed", { path: S.String, error: S.String }),
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

export const ReviewMoves = S.Union([
  S.TaggedStruct("Idle", {}),
  S.TaggedStruct("Loading", {}),
  S.TaggedStruct("Ready", { moves: S.Array(MovedBlock) }),
  S.TaggedStruct("Failed", { error: S.String }),
]);
export type ReviewMoves = typeof ReviewMoves.Type;

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

export const CharacterDiffState = S.Union([
  S.TaggedStruct("Loading", {
    path: S.String,
    ignoreWhitespace: S.Boolean,
    mode: S.Literals(["token", "character"]),
  }),
  S.TaggedStruct("Ready", { result: CharacterDiffResult }),
  S.TaggedStruct("Failed", {
    path: S.String,
    ignoreWhitespace: S.Boolean,
    mode: S.Literals(["token", "character"]),
    error: S.String,
  }),
]);
export type CharacterDiffState = typeof CharacterDiffState.Type;

export const FullFileState = S.Union([
  S.TaggedStruct("Loading", { path: S.String }),
  S.TaggedStruct("Ready", {
    path: S.String,
    oldText: S.String,
    newText: S.String,
  }),
  S.TaggedStruct("Failed", { path: S.String, error: S.String }),
]);
export type FullFileState = typeof FullFileState.Type;

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

export const GitHubReviews = S.Union([
  S.TaggedStruct("Idle", {}),
  S.TaggedStruct("Loading", {}),
  S.TaggedStruct("Ready", { comments: S.Array(GitHubReviewComment) }),
  S.TaggedStruct("Failed", { error: S.String }),
]);
export type GitHubReviews = typeof GitHubReviews.Type;

export const ReplyDraft = S.Struct({ commentId: S.Number, body: S.String });
export type ReplyDraft = typeof ReplyDraft.Type;
export const ReplyState = S.Union([
  S.TaggedStruct("Loading", { commentId: S.Number }),
  S.TaggedStruct("Failed", { commentId: S.Number, error: S.String }),
]);
export type ReplyState = typeof ReplyState.Type;

export const ReviewSubmission = S.Union([
  S.TaggedStruct("Idle", {}),
  S.TaggedStruct("Loading", {
    event: S.Literals(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
  }),
  S.TaggedStruct("Succeeded", {
    event: S.Literals(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
  }),
  S.TaggedStruct("Failed", { error: S.String }),
]);
export type ReviewSubmission = typeof ReviewSubmission.Type;

export const Model = S.Struct({
  page: S.Literals(["review", "repository"]),
  phase: S.Literals(["ready", "loading", "error"]),
  error: S.String,
  prUrl: S.String,
  filter: S.String,
  meta: ReviewMeta,
  files: S.Array(FileChange),
  pullRequestFiles: S.Array(FileChange),
  reviewTab: S.Literals(["files", "commits"]),
  commits: PullCommits,
  selectedCommit: S.String,
  commitDiff: CommitDiff,
  repositoryBrowser: RepositoryBrowser,
  toolbarMenu: S.Literals(["none", "options", "open-review"]),
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
  reviewMoves: ReviewMoves,
  characterDiffStates: S.Array(CharacterDiffState),
  collapsedPaths: S.Array(S.String),
  collapsedHunks: S.Array(S.String),
  fullFileStates: S.Array(FullFileState),
  showGitHubReviews: S.Boolean,
  githubReviews: GitHubReviews,
  collapsedReviewThreads: S.Array(S.Number),
  replyDrafts: S.Array(ReplyDraft),
  replyStates: S.Array(ReplyState),
  reviewBody: S.String,
  reviewSubmission: ReviewSubmission,
});
export type Model = typeof Model.Type;

export const ChangedPrUrl = m("ChangedPrUrl", { value: S.String });
export const SubmittedPrUrl = m("SubmittedPrUrl");
export const RefreshedReview = m("RefreshedReview");
export const ToggledToolbarMenu = m("ToggledToolbarMenu", {
  value: S.Literals(["options", "open-review"]),
});
export const ClosedToolbarMenus = m("ClosedToolbarMenus");
export const ChangedToolbarCompact = m("ChangedToolbarCompact", {
  value: S.Boolean,
});
export const ChangedBrowserUrl = m("ChangedBrowserUrl", {
  pathname: S.String,
  search: S.String,
});
export const RequestedNavigation = m("RequestedNavigation", {
  href: S.String,
  external: S.Boolean,
});
export const CompletedNavigation = m("CompletedNavigation");
export const LoadedReview = m("LoadedReview", {
  requestedUrl: S.String,
  meta: ReviewMeta,
  files: S.Array(FileChange),
});
export const FailedReview = m("FailedReview", {
  requestedUrl: S.String,
  error: S.String,
});
export const LoadedCommits = m("LoadedCommits", {
  requestedUrl: S.String,
  commits: S.Array(PullCommit),
});
export const FailedCommits = m("FailedCommits", {
  requestedUrl: S.String,
  error: S.String,
});
export const LoadedCommitDiff = m("LoadedCommitDiff", {
  sha: S.String,
  files: S.Array(FileChange),
});
export const FailedCommitDiff = m("FailedCommitDiff", {
  sha: S.String,
  error: S.String,
});
export const LoadedRepositoryFiles = m("LoadedRepositoryFiles", {
  files: S.Array(RepositoryFile),
});
export const FailedRepositoryFiles = m("FailedRepositoryFiles", { error: S.String });
export const ChangedRepositoryQuery = m("ChangedRepositoryQuery", { value: S.String });
export const SubmittedRepositorySearch = m("SubmittedRepositorySearch");
export const LoadedRepositorySearch = m("LoadedRepositorySearch", {
  query: S.String,
  files: S.Array(RepositoryFile),
  matches: S.Array(RepositorySearchMatch),
});
export const FailedRepositorySearch = m("FailedRepositorySearch", {
  query: S.String,
  error: S.String,
});
export const SelectedRepositoryFile = m("SelectedRepositoryFile", {
  path: S.String,
});
export const ClosedRepositoryFile = m("ClosedRepositoryFile");
export const LoadedRepositoryFile = m("LoadedRepositoryFile", {
  path: S.String,
  content: S.String,
  truncated: S.Boolean,
});
export const FailedRepositoryFile = m("FailedRepositoryFile", {
  path: S.String,
  error: S.String,
});
export const LoadedSemantic = m("LoadedSemantic", {
  requestedUrl: S.String,
  path: S.String,
  result: SemanticResult,
});
export const FailedSemantic = m("FailedSemantic", {
  requestedUrl: S.String,
  path: S.String,
  error: S.String,
});
export const LoadedMoves = m("LoadedMoves", {
  requestedUrl: S.String,
  moves: S.Array(MovedBlock),
});
export const FailedMoves = m("FailedMoves", {
  requestedUrl: S.String,
  error: S.String,
});
export const LoadedCharacterDiff = m("LoadedCharacterDiff", {
  requestedUrl: S.String,
  result: CharacterDiffResult,
});
export const FailedCharacterDiff = m("FailedCharacterDiff", {
  requestedUrl: S.String,
  path: S.String,
  ignoreWhitespace: S.Boolean,
  mode: S.Literals(["token", "character"]),
  error: S.String,
});
export const ChangedFilter = m("ChangedFilter", { value: S.String });
export const SelectedFile = m("SelectedFile", { path: S.String });
export const SelectedReviewTab = m("SelectedReviewTab", {
  value: S.Literals(["files", "commits"]),
});
export const SelectedCommit = m("SelectedCommit", { sha: S.String });
export const ReturnedToCommitList = m("ReturnedToCommitList");
export const SelectedViewMode = m("SelectedViewMode", {
  value: S.Literals(["unified", "split"]),
});
export const SelectedReviewScope = m("SelectedReviewScope", {
  value: S.Literals(["file", "full"]),
});
export const ToggledWhitespace = m("ToggledWhitespace");
export const ToggledSemantic = m("ToggledSemantic");
export const SelectedInlineDiffMode = m("SelectedInlineDiffMode", {
  value: InlineDiffMode,
});
export const ToggledSyntaxHighlighting = m("ToggledSyntaxHighlighting");
export const ToggledSidebar = m("ToggledSidebar");
export const ToggledReviewed = m("ToggledReviewed", { path: S.String });
export const ToggledFileCollapse = m("ToggledFileCollapse", { path: S.String });
export const ToggledHunkCollapse = m("ToggledHunkCollapse", {
  path: S.String,
  hunkId: S.String,
});
export const ToggledFullFile = m("ToggledFullFile", { path: S.String });
export const LoadedFullFile = m("LoadedFullFile", {
  requestedUrl: S.String,
  path: S.String,
  oldText: S.String,
  newText: S.String,
});
export const FailedFullFile = m("FailedFullFile", {
  requestedUrl: S.String,
  path: S.String,
  error: S.String,
});
export const ToggledGitHubReviews = m("ToggledGitHubReviews");
export const ToggledReviewThreadCollapse = m("ToggledReviewThreadCollapse", {
  threadId: S.Number,
});
export const LoadedGitHubReviews = m("LoadedGitHubReviews", {
  requestedUrl: S.String,
  comments: S.Array(GitHubReviewComment),
});
export const FailedGitHubReviews = m("FailedGitHubReviews", {
  requestedUrl: S.String,
  error: S.String,
});
export const ChangedReplyDraft = m("ChangedReplyDraft", {
  commentId: S.Number,
  body: S.String,
});
export const SubmittedReply = m("SubmittedReply", { commentId: S.Number });
export const PostedReply = m("PostedReply", { comment: GitHubReviewComment });
export const FailedReply = m("FailedReply", {
  commentId: S.Number,
  error: S.String,
});
export const ChangedReviewBody = m("ChangedReviewBody", { body: S.String });
export const SubmittedReview = m("SubmittedReview", {
  event: S.Literals(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
});
export const PostedReview = m("PostedReview", {
  event: S.Literals(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
});
export const FailedReviewSubmission = m("FailedReviewSubmission", { error: S.String });

export const Message = S.Union([
  ChangedPrUrl,
  SubmittedPrUrl,
  RefreshedReview,
  ToggledToolbarMenu,
  ClosedToolbarMenus,
  ChangedToolbarCompact,
  ChangedBrowserUrl,
  RequestedNavigation,
  CompletedNavigation,
  LoadedReview,
  FailedReview,
  LoadedCommits,
  FailedCommits,
  LoadedCommitDiff,
  FailedCommitDiff,
  LoadedRepositoryFiles,
  FailedRepositoryFiles,
  ChangedRepositoryQuery,
  SubmittedRepositorySearch,
  LoadedRepositorySearch,
  FailedRepositorySearch,
  SelectedRepositoryFile,
  ClosedRepositoryFile,
  LoadedRepositoryFile,
  FailedRepositoryFile,
  LoadedSemantic,
  FailedSemantic,
  LoadedMoves,
  FailedMoves,
  LoadedCharacterDiff,
  FailedCharacterDiff,
  ChangedFilter,
  SelectedFile,
  SelectedReviewTab,
  SelectedCommit,
  ReturnedToCommitList,
  SelectedViewMode,
  SelectedReviewScope,
  ToggledWhitespace,
  ToggledSemantic,
  SelectedInlineDiffMode,
  ToggledSyntaxHighlighting,
  ToggledSidebar,
  ToggledReviewed,
  ToggledFileCollapse,
  ToggledHunkCollapse,
  ToggledFullFile,
  LoadedFullFile,
  FailedFullFile,
  ToggledGitHubReviews,
  ToggledReviewThreadCollapse,
  LoadedGitHubReviews,
  FailedGitHubReviews,
  ChangedReplyDraft,
  SubmittedReply,
  PostedReply,
  FailedReply,
  ChangedReviewBody,
  SubmittedReview,
  PostedReview,
  FailedReviewSubmission,
]);
export type Message = typeof Message.Type;
