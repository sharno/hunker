import { Schema as S } from "effect";
import { ts } from "foldkit/schema";

export const LineNumber = S.Int.check(S.isGreaterThan(0));

export const Target = S.Struct({
  pullUrl: S.NonEmptyString,
  commitId: S.NonEmptyString,
  path: S.NonEmptyString,
  line: LineNumber,
  side: S.Literals(["LEFT", "RIGHT"]),
});
export type Target = typeof Target.Type;

export const Closed = ts("Closed");
export const Editing = ts("Editing", {
  target: Target,
  body: S.String,
});
export const Posting = ts("Posting", {
  target: Target,
  body: S.NonEmptyString,
});
export const PostFailed = ts("PostFailed", {
  target: Target,
  body: S.String,
  error: S.String,
});
export const State = S.Union([Closed, Editing, Posting, PostFailed]);

export const Model = S.Struct({ state: State });
export type Model = typeof Model.Type;

export const empty = (): Model => Model.make({ state: Closed() });

export const sameTarget = (left: Target, right: Target) =>
  left.pullUrl === right.pullUrl &&
  left.commitId === right.commitId &&
  left.path === right.path &&
  left.line === right.line &&
  left.side === right.side;
