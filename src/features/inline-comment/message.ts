import { Schema as S } from "effect";
import { m } from "foldkit/message";

import { GitHubReviewComment } from "../github-review-comment";
import { Target } from "./model";

export const OpenedInlineComment = m("OpenedInlineComment", {
  target: Target,
});
export const UpdatedInlineCommentBody = m("UpdatedInlineCommentBody", {
  body: S.String,
});
export const CancelledInlineComment = m("CancelledInlineComment");
export const SubmittedInlineComment = m("SubmittedInlineComment");
export const SucceededPostInlineComment = m("SucceededPostInlineComment", {
  target: Target,
  comment: GitHubReviewComment,
});
export const FailedPostInlineComment = m("FailedPostInlineComment", {
  target: Target,
  error: S.String,
});

export const Message = S.Union([
  OpenedInlineComment,
  UpdatedInlineCommentBody,
  CancelledInlineComment,
  SubmittedInlineComment,
  SucceededPostInlineComment,
  FailedPostInlineComment,
]);
export type Message = typeof Message.Type;
