import { Schema as S } from "effect";
import { ts } from "foldkit/schema";

export const Branch = S.Struct({
  name: S.NonEmptyString,
  local: S.Boolean,
  remote: S.Boolean,
});
export type Branch = typeof Branch.Type;

export const TrackingBranch = ts("TrackingBranch", {
  name: S.NonEmptyString,
  oid: S.NonEmptyString,
  upstream: S.NonEmptyString,
  ahead: S.Number,
  behind: S.Number,
});
export const UntrackedBranch = ts("UntrackedBranch", {
  name: S.NonEmptyString,
  oid: S.NonEmptyString,
});
export const DetachedHead = ts("DetachedHead", {
  oid: S.NonEmptyString,
});
export const Checkout = S.Union([
  TrackingBranch,
  UntrackedBranch,
  DetachedHead,
]);
export type Checkout = typeof Checkout.Type;

export const RemoteCurrent = ts("RemoteCurrent", { checkedAt: S.Number });
export const RemoteUnavailable = ts("RemoteUnavailable", {
  checkedAt: S.Number,
  error: S.String,
});
export const RemoteState = S.Union([RemoteCurrent, RemoteUnavailable]);

export const WorkingTreeChanges = S.Struct({
  staged: S.Number,
  unstaged: S.Number,
  untracked: S.Number,
});

export const Status = S.Struct({
  path: S.String,
  checkout: Checkout,
  branches: S.Array(Branch),
  changes: WorkingTreeChanges,
  remote: RemoteState,
});
export type Status = typeof Status.Type;

export const Resting = ts("Resting");
export const Refreshing = ts("Refreshing");
export const Switching = ts("Switching", { branch: S.NonEmptyString });
export const Pulling = ts("Pulling");
export const Succeeded = ts("Succeeded", { message: S.String });
export const Blocked = ts("Blocked", {
  operation: S.Literals(["refresh", "switch", "pull"]),
  message: S.String,
});
export const Action = S.Union([
  Resting,
  Refreshing,
  Switching,
  Pulling,
  Succeeded,
  Blocked,
]);
export type Action = typeof Action.Type;

export const Idle = ts("Idle");
export const Loading = ts("Loading", { repository: S.NonEmptyString });
export const Ready = ts("Ready", {
  repository: S.NonEmptyString,
  status: Status,
  action: Action,
});
export const Failed = ts("Failed", {
  repository: S.NonEmptyString,
  error: S.String,
});
export const State = S.Union([Idle, Loading, Ready, Failed]);

export const Model = S.Struct({ state: State });
export type Model = typeof Model.Type;

export const empty = (): Model => Model.make({ state: Idle() });
