import { Schema as S } from "effect";
import { m } from "foldkit/message";

export const FileChange = S.Struct({
  path: S.String,
  previousPath: S.String,
  status: S.Literals(["modified", "added", "deleted", "renamed"]),
  additions: S.Number,
  deletions: S.Number,
  patch: S.String,
  insight: S.String,
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

export const SemanticChange = S.Struct({
  start: S.Number,
  end: S.Number,
  content: S.String,
  highlight: S.String,
});
export type SemanticChange = typeof SemanticChange.Type;

export const SemanticSide = S.Struct({
  lineNumber: S.Number,
  changes: S.Array(SemanticChange),
});
export type SemanticSide = typeof SemanticSide.Type;

export const SemanticChunkLine = S.Struct({
  lhs: S.optional(SemanticSide),
  rhs: S.optional(SemanticSide),
});

export const SemanticResult = S.Struct({
  path: S.String,
  language: S.String,
  status: S.String,
  oldText: S.String,
  newText: S.String,
  alignedLines: S.Array(S.Tuple([S.NullOr(S.Number), S.NullOr(S.Number)])),
  chunks: S.Array(S.Array(SemanticChunkLine)),
});
export type SemanticResult = typeof SemanticResult.Type;

export const SemanticRequest = S.Union([
  S.TaggedStruct("Idle", {}),
  S.TaggedStruct("Loading", { path: S.String }),
  S.TaggedStruct("Failed", { path: S.String, error: S.String }),
]);
export type SemanticRequest = typeof SemanticRequest.Type;

export const Model = S.Struct({
  phase: S.Literals(["ready", "loading", "error"]),
  error: S.String,
  prUrl: S.String,
  filter: S.String,
  meta: ReviewMeta,
  files: S.Array(FileChange),
  selectedPath: S.String,
  viewMode: S.Literals(["unified", "split"]),
  ignoreWhitespace: S.Boolean,
  semantic: S.Boolean,
  characterDiff: S.Boolean,
  reviewedPaths: S.Array(S.String),
  semanticResults: S.Array(SemanticResult),
  semanticRequest: SemanticRequest,
});
export type Model = typeof Model.Type;

export const ChangedPrUrl = m("ChangedPrUrl", { value: S.String });
export const SubmittedPrUrl = m("SubmittedPrUrl");
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
export const ChangedFilter = m("ChangedFilter", { value: S.String });
export const SelectedFile = m("SelectedFile", { path: S.String });
export const SelectedViewMode = m("SelectedViewMode", {
  value: S.Literals(["unified", "split"]),
});
export const ToggledWhitespace = m("ToggledWhitespace");
export const ToggledSemantic = m("ToggledSemantic");
export const ToggledCharacterDiff = m("ToggledCharacterDiff");
export const ToggledReviewed = m("ToggledReviewed", { path: S.String });

export const Message = S.Union([
  ChangedPrUrl,
  SubmittedPrUrl,
  LoadedReview,
  FailedReview,
  LoadedSemantic,
  FailedSemantic,
  ChangedFilter,
  SelectedFile,
  SelectedViewMode,
  ToggledWhitespace,
  ToggledSemantic,
  ToggledCharacterDiff,
  ToggledReviewed,
]);
export type Message = typeof Message.Type;
