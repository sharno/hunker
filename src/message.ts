import { Schema as S } from "effect";
import { Url } from "foldkit";
import { m } from "foldkit/message";
import { UrlRequest } from "foldkit/navigation";
import { Popover } from "@foldkit/ui";

import * as GitHubLocation from "./features/github-location";
import * as Repository from "./page/repository";
import * as Settings from "./page/settings";
import {
  CharacterDiffResult,
  FileChange,
  GitHubReviewComment,
  InlineDiffMode,
  MovedBlock,
  PullCommit,
  ReviewEvent,
  ReviewMeta,
  SemanticResult,
} from "./model";

export const GotGitHubLocationMessage = m("GotGitHubLocationMessage", {
  message: GitHubLocation.Message,
});
export const GotRepositoryMessage = m("GotRepositoryMessage", {
  message: Repository.Message,
});
export const GotSettingsMessage = m("GotSettingsMessage", {
  message: Settings.Message,
});
export const ClickedRefreshReview = m("ClickedRefreshReview");
export const TickedRevisionPoll = m("TickedRevisionPoll");
export const ClickedCheckReviewRevision = m("ClickedCheckReviewRevision");
export const SucceededCheckReviewRevision = m("SucceededCheckReviewRevision", {
  requestedUrl: S.String,
  pinnedHeadOid: S.String,
  latestHeadOid: S.String,
  checkedAt: S.Number,
  current: S.Boolean,
});
export const FailedCheckReviewRevision = m("FailedCheckReviewRevision", {
  requestedUrl: S.String,
  error: S.String,
});
export const GotDiffOptionsPopoverMessage = m("GotDiffOptionsPopoverMessage", {
  message: Popover.Message,
});
export const GotOpenReviewPopoverMessage = m("GotOpenReviewPopoverMessage", {
  message: Popover.Message,
});
export const UpdatedToolbarCompact = m("UpdatedToolbarCompact", {
  value: S.Boolean,
});
export const ChangedUrl = m("ChangedUrl", { url: Url.Url });
export const ClickedLink = m("ClickedLink", {
  request: UrlRequest,
});
export const CompletedNavigate = m("CompletedNavigate");
export const SucceededFetchReview = m("SucceededFetchReview", {
  requestedUrl: S.String,
  meta: ReviewMeta,
  files: S.Array(FileChange),
});
export const FailedFetchReview = m("FailedFetchReview", {
  requestedUrl: S.String,
  error: S.String,
});
export const SucceededFetchCommits = m("SucceededFetchCommits", {
  requestedUrl: S.String,
  commits: S.Array(PullCommit),
});
export const FailedFetchCommits = m("FailedFetchCommits", {
  requestedUrl: S.String,
  error: S.String,
});
export const SucceededFetchCommitDiff = m("SucceededFetchCommitDiff", {
  sha: S.String,
  files: S.Array(FileChange),
});
export const FailedFetchCommitDiff = m("FailedFetchCommitDiff", {
  sha: S.String,
  error: S.String,
});
export const SucceededFetchSemantic = m("SucceededFetchSemantic", {
  requestedUrl: S.String,
  path: S.String,
  result: SemanticResult,
});
export const FailedFetchSemantic = m("FailedFetchSemantic", {
  requestedUrl: S.String,
  path: S.String,
  error: S.String,
});
export const SucceededFetchMoves = m("SucceededFetchMoves", {
  requestedUrl: S.String,
  moves: S.Array(MovedBlock),
});
export const FailedFetchMoves = m("FailedFetchMoves", {
  requestedUrl: S.String,
  error: S.String,
});
export const SucceededFetchCharacterDiff = m("SucceededFetchCharacterDiff", {
  requestedUrl: S.String,
  result: CharacterDiffResult,
});
export const FailedFetchCharacterDiff = m("FailedFetchCharacterDiff", {
  requestedUrl: S.String,
  path: S.String,
  ignoreWhitespace: S.Boolean,
  mode: S.Literals(["token", "character"]),
  error: S.String,
});
export const UpdatedFilter = m("UpdatedFilter", { value: S.String });
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
export const ToggledFileTreeFolder = m("ToggledFileTreeFolder", {
  path: S.String,
});
export const ToggledReviewed = m("ToggledReviewed", { path: S.String });
export const ToggledFileCollapse = m("ToggledFileCollapse", { path: S.String });
export const ToggledHunkCollapse = m("ToggledHunkCollapse", {
  path: S.String,
  hunkId: S.String,
});
export const ToggledFullFile = m("ToggledFullFile", { path: S.String });
export const SucceededFetchFullFile = m("SucceededFetchFullFile", {
  requestedUrl: S.String,
  path: S.String,
  oldText: S.String,
  newText: S.String,
});
export const FailedFetchFullFile = m("FailedFetchFullFile", {
  requestedUrl: S.String,
  path: S.String,
  error: S.String,
});
export const ToggledGitHubReviews = m("ToggledGitHubReviews");
export const ToggledReviewThreadCollapse = m("ToggledReviewThreadCollapse", {
  threadId: S.Number,
});
export const SucceededFetchGitHubReviews = m("SucceededFetchGitHubReviews", {
  requestedUrl: S.String,
  comments: S.Array(GitHubReviewComment),
});
export const FailedFetchGitHubReviews = m("FailedFetchGitHubReviews", {
  requestedUrl: S.String,
  error: S.String,
});
export const UpdatedReplyDraft = m("UpdatedReplyDraft", {
  commentId: S.Number,
  body: S.String,
});
export const SubmittedReply = m("SubmittedReply", { commentId: S.Number });
export const SucceededPostReviewReply = m("SucceededPostReviewReply", {
  comment: GitHubReviewComment,
});
export const FailedPostReviewReply = m("FailedPostReviewReply", {
  commentId: S.Number,
  error: S.String,
});
export const UpdatedReviewBody = m("UpdatedReviewBody", { body: S.String });
export const SubmittedReview = m("SubmittedReview", {
  event: ReviewEvent,
});
export const SucceededPostPullRequestReview = m(
  "SucceededPostPullRequestReview",
  {
    event: ReviewEvent,
  },
);
export const FailedPostPullRequestReview = m("FailedPostPullRequestReview", {
  error: S.String,
});

export const Message = S.Union([
  GotGitHubLocationMessage,
  GotRepositoryMessage,
  GotSettingsMessage,
  ClickedRefreshReview,
  TickedRevisionPoll,
  ClickedCheckReviewRevision,
  SucceededCheckReviewRevision,
  FailedCheckReviewRevision,
  GotDiffOptionsPopoverMessage,
  GotOpenReviewPopoverMessage,
  UpdatedToolbarCompact,
  ChangedUrl,
  ClickedLink,
  CompletedNavigate,
  SucceededFetchReview,
  FailedFetchReview,
  SucceededFetchCommits,
  FailedFetchCommits,
  SucceededFetchCommitDiff,
  FailedFetchCommitDiff,
  SucceededFetchSemantic,
  FailedFetchSemantic,
  SucceededFetchMoves,
  FailedFetchMoves,
  SucceededFetchCharacterDiff,
  FailedFetchCharacterDiff,
  UpdatedFilter,
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
  ToggledFileTreeFolder,
  ToggledReviewed,
  ToggledFileCollapse,
  ToggledHunkCollapse,
  ToggledFullFile,
  SucceededFetchFullFile,
  FailedFetchFullFile,
  ToggledGitHubReviews,
  ToggledReviewThreadCollapse,
  SucceededFetchGitHubReviews,
  FailedFetchGitHubReviews,
  UpdatedReplyDraft,
  SubmittedReply,
  SucceededPostReviewReply,
  FailedPostReviewReply,
  UpdatedReviewBody,
  SubmittedReview,
  SucceededPostPullRequestReview,
  FailedPostPullRequestReview,
]);
export type Message = typeof Message.Type;
