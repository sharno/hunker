import { Schema as S } from "effect";
import { m } from "foldkit/message";

import { Status } from "./model";

export const Ticked = m("Ticked");
export const ClickedRefresh = m("ClickedRefresh");
export const SelectedBranch = m("SelectedBranch", {
  branch: S.NonEmptyString,
});
export const ClickedPull = m("ClickedPull");
export const SucceededFetch = m("SucceededFetch", {
  repository: S.NonEmptyString,
  status: Status,
});
export const FailedFetch = m("FailedFetch", {
  repository: S.NonEmptyString,
  error: S.String,
});
export const SucceededSwitch = m("SucceededSwitch", {
  repository: S.NonEmptyString,
  branch: S.NonEmptyString,
  status: Status,
});
export const FailedSwitch = m("FailedSwitch", {
  repository: S.NonEmptyString,
  branch: S.NonEmptyString,
  error: S.String,
});
export const SucceededPull = m("SucceededPull", {
  repository: S.NonEmptyString,
  pulledCommits: S.Number,
  status: Status,
});
export const FailedPull = m("FailedPull", {
  repository: S.NonEmptyString,
  error: S.String,
});

export const Message = S.Union([
  Ticked,
  ClickedRefresh,
  SelectedBranch,
  ClickedPull,
  SucceededFetch,
  FailedFetch,
  SucceededSwitch,
  FailedSwitch,
  SucceededPull,
  FailedPull,
]);
export type Message = typeof Message.Type;
