import { Submodel } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { button } from "../../../view/control";
import { withTailwind } from "../../../view/tailwind";
import {
  ClickedPull,
  ClickedRefresh,
  type Message,
  SelectedBranch,
} from "./message";
import type { Action, Checkout, Model } from "./model";

const branchName = (checkout: Checkout) =>
  checkout._tag === "DetachedHead" ? "" : checkout.name;

const branchLabel = (checkout: Checkout) =>
  checkout._tag === "DetachedHead"
    ? `Detached at ${checkout.oid.slice(0, 7)}`
    : checkout.name;

const pullLabel = (checkout: Checkout, action: Action) => {
  if (action._tag === "Pulling") return "Pulling…";
  if (checkout._tag === "DetachedHead") return "Detached HEAD";
  if (checkout._tag === "UntrackedBranch") return "No upstream";
  return checkout.behind === 0 ? "Up to date" : `Pull ${checkout.behind} ↓`;
};

const isBusy = (action: Action) =>
  action._tag === "Refreshing" ||
  action._tag === "Switching" ||
  action._tag === "Pulling";

const feedback = (
  action: Action,
  h: HtmlBuilder<Message>,
): Html | undefined => {
  if (action._tag === "Blocked") {
    return h.span(
      [h.Class("source-control-feedback is-error"), h.Role("alert")],
      [action.message],
    );
  }
  if (action._tag === "Succeeded") {
    return h.span(
      [h.Class("source-control-feedback is-success"), h.Role("status")],
      [action.message],
    );
  }
  return undefined;
};

export const view = Submodel.defineView<Model, Message>((model, html) => {
  const h = withTailwind(html);
  if (model.state._tag === "Idle") return h.empty;
  if (model.state._tag === "Loading") {
    return h.section(
      [h.Class("repository-source-control"), h.Role("status")],
      [h.span([h.Class("source-control-loading")], ["Reading Git state…"])],
    );
  }
  if (model.state._tag === "Failed") {
    return h.section(
      [h.Class("repository-source-control")],
      [
        h.span(
          [h.Class("source-control-feedback is-error"), h.Role("alert")],
          [model.state.error],
        ),
        button(h, [h.Type("button"), h.OnClick(ClickedRefresh())], ["Retry"]),
      ],
    );
  }
  const { action, status } = model.state;
  const { checkout, changes } = status;
  const branch = branchName(checkout);
  const busy = isBusy(action);
  const canPull = checkout._tag === "TrackingBranch" && checkout.behind > 0;
  const actionFeedback = feedback(action, h);
  return h.section(
    [h.Class("repository-source-control")],
    [
      h.label(
        [h.Class("source-control-branch")],
        [
          h.span([], [action._tag === "Switching" ? "Switching…" : "Branch"]),
          h.select(
            [
              h.Value(branch),
              h.Disabled(busy),
              h.AriaLabel("Checked-out repository branch"),
              h.OnChange((value) => SelectedBranch({ branch: value })),
            ],
            [
              ...(checkout._tag === "DetachedHead"
                ? [h.option([h.Value("")], [branchLabel(checkout)])]
                : []),
              ...status.branches.map((candidate) =>
                h.option(
                  [h.Key(candidate.name), h.Value(candidate.name)],
                  [`${candidate.name}${candidate.local ? "" : " · remote"}`],
                ),
              ),
            ],
          ),
        ],
      ),
      checkout._tag === "TrackingBranch" && checkout.ahead > 0
        ? h.span(
            [h.Class("source-control-count is-ahead")],
            [`${checkout.ahead} ↑`],
          )
        : h.empty,
      checkout._tag === "TrackingBranch" && checkout.behind > 0
        ? h.span(
            [h.Class("source-control-count is-behind")],
            [`${checkout.behind} ↓`],
          )
        : h.empty,
      h.span(
        [h.Class("source-control-changes")],
        [
          `${changes.staged} staged · ${changes.unstaged} changed · ${changes.untracked} untracked`,
        ],
      ),
      status.remote._tag === "RemoteUnavailable"
        ? h.span(
            [
              h.Class("source-control-remote-error"),
              h.Title(status.remote.error),
            ],
            ["Remote unavailable"],
          )
        : h.empty,
      actionFeedback ?? h.span([h.Class("source-control-path")], [status.path]),
      button(
        h,
        [
          h.Type("button"),
          h.Class("source-control-refresh"),
          h.Disabled(busy),
          h.AriaLabel("Refresh repository source control"),
          h.OnClick(ClickedRefresh()),
        ],
        [action._tag === "Refreshing" ? "Refreshing…" : "↻"],
      ),
      button(
        h,
        [
          h.Type("button"),
          h.Class("source-control-pull"),
          h.Disabled(busy || !canPull),
          h.OnClick(ClickedPull()),
        ],
        [pullLabel(checkout, action)],
      ),
    ],
  );
});
