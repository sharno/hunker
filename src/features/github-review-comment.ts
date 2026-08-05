import { Schema as S } from "effect";

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
