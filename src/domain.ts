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
  phase: S.Literals(["ready", "loading", "error"]),
  error: S.String,
  prUrl: S.String,
  filter: S.String,
  meta: ReviewMeta,
  files: S.Array(FileChange),
  selectedPath: S.String,
  sidebarCollapsed: S.Boolean,
  reviewScope: S.Literals(["file", "full"]),
  viewMode: S.Literals(["unified", "split"]),
  ignoreWhitespace: S.Boolean,
  semantic: S.Boolean,
  characterDiff: S.Boolean,
  reviewedPaths: S.Array(S.String),
  semanticResults: S.Array(SemanticResult),
  semanticRequest: SemanticRequest,
  reviewMoves: ReviewMoves,
  collapsedPaths: S.Array(S.String),
  collapsedHunks: S.Array(S.String),
  fullFileStates: S.Array(FullFileState),
  showGitHubReviews: S.Boolean,
  githubReviews: GitHubReviews,
  replyDrafts: S.Array(ReplyDraft),
  replyStates: S.Array(ReplyState),
  reviewBody: S.String,
  reviewSubmission: ReviewSubmission,
});
export type Model = typeof Model.Type;

export const ChangedPrUrl = m("ChangedPrUrl", { value: S.String });
export const SubmittedPrUrl = m("SubmittedPrUrl");
export const RefreshedReview = m("RefreshedReview");
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
  meta: ReviewMeta,
  files: S.Array(FileChange),
});
export const FailedReview = m("FailedReview", { error: S.String });
export const LoadedSemantic = m("LoadedSemantic", {
  path: S.String,
  result: SemanticResult,
});
export const FailedSemantic = m("FailedSemantic", {
  path: S.String,
  error: S.String,
});
export const LoadedMoves = m("LoadedMoves", { moves: S.Array(MovedBlock) });
export const FailedMoves = m("FailedMoves", { error: S.String });
export const ChangedFilter = m("ChangedFilter", { value: S.String });
export const SelectedFile = m("SelectedFile", { path: S.String });
export const SelectedViewMode = m("SelectedViewMode", {
  value: S.Literals(["unified", "split"]),
});
export const SelectedReviewScope = m("SelectedReviewScope", {
  value: S.Literals(["file", "full"]),
});
export const ToggledWhitespace = m("ToggledWhitespace");
export const ToggledSemantic = m("ToggledSemantic");
export const ToggledCharacterDiff = m("ToggledCharacterDiff");
export const ToggledSidebar = m("ToggledSidebar");
export const ToggledReviewed = m("ToggledReviewed", { path: S.String });
export const ToggledFileCollapse = m("ToggledFileCollapse", { path: S.String });
export const ToggledHunkCollapse = m("ToggledHunkCollapse", {
  path: S.String,
  hunkId: S.String,
});
export const ToggledFullFile = m("ToggledFullFile", { path: S.String });
export const LoadedFullFile = m("LoadedFullFile", {
  path: S.String,
  oldText: S.String,
  newText: S.String,
});
export const FailedFullFile = m("FailedFullFile", {
  path: S.String,
  error: S.String,
});
export const ToggledGitHubReviews = m("ToggledGitHubReviews");
export const LoadedGitHubReviews = m("LoadedGitHubReviews", {
  comments: S.Array(GitHubReviewComment),
});
export const FailedGitHubReviews = m("FailedGitHubReviews", { error: S.String });
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
  ChangedBrowserUrl,
  RequestedNavigation,
  CompletedNavigation,
  LoadedReview,
  FailedReview,
  LoadedSemantic,
  FailedSemantic,
  LoadedMoves,
  FailedMoves,
  ChangedFilter,
  SelectedFile,
  SelectedViewMode,
  SelectedReviewScope,
  ToggledWhitespace,
  ToggledSemantic,
  ToggledCharacterDiff,
  ToggledSidebar,
  ToggledReviewed,
  ToggledFileCollapse,
  ToggledHunkCollapse,
  ToggledFullFile,
  LoadedFullFile,
  FailedFullFile,
  ToggledGitHubReviews,
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
