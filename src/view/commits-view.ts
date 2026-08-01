import type { Html, HtmlBuilder } from "foldkit/html";

import {
  ReturnedToCommitList,
  SelectedCommit,
  SelectedReviewTab,
} from "../domain";
import type { Message, Model, PullCommit } from "../domain";

const commitTitle = (commit: PullCommit) =>
  commit.message.split("\n")[0] ?? commit.message;

const commitDescription = (commit: PullCommit) =>
  commit.message.split("\n").slice(1).join(" ").trim();

const authoredDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
};

const commitRow = (
  commit: PullCommit,
  h: HtmlBuilder<Message>,
): Html => {
  const description = commitDescription(commit);
  return h.button(
    [
      h.Key(commit.sha),
      h.Type("button"),
      h.Class("commit-row"),
      h.OnClick(SelectedCommit({ sha: commit.sha })),
    ],
    [
      h.span([h.Class("commit-avatar")], [commit.author.slice(0, 2).toUpperCase()]),
      h.span([h.Class("commit-copy")], [
        h.strong([], [commitTitle(commit)]),
        description === "" ? h.empty : h.span([], [description]),
        h.small([], [
          `${commit.author} committed ${authoredDate(commit.authoredAt)}`,
        ]),
      ]),
      h.code([h.Class("commit-sha")], [commit.sha.slice(0, 7)]),
      h.span([h.Class("commit-open-arrow")], ["→"]),
    ],
  );
};

export const commitListView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const state = model.commits;
  if (state._tag === "Idle" || state._tag === "Loading") {
    return h.section([h.Class("commits-state")], [
      h.span([h.Class("semantic-icon")], ["◌"]),
      h.strong([], ["Loading commits…"]),
      h.span([], ["Reading the pull request history from GitHub."]),
    ]);
  }
  if (state._tag === "Failed") {
    return h.section([h.Class("commits-state is-error"), h.Role("alert")], [
      h.span([h.Class("semantic-icon")], ["!"]),
      h.strong([], ["Could not load commits"]),
      h.span([], [state.error]),
      h.button(
        [
          h.Type("button"),
          h.Class("context-button"),
          h.OnClick(SelectedReviewTab({ value: "commits" })),
        ],
        ["Retry"],
      ),
    ]);
  }
  return h.section([h.Class("commits-browser")], [
    h.div([h.Class("commits-heading")], [
      h.div([], [
        h.h2([], [`${state.commits.length} ${state.commits.length === 1 ? "commit" : "commits"}`]),
        h.p([], ["Select a commit to review only the change against its parent."]),
      ]),
      h.span([], ["Oldest → newest"]),
    ]),
    state.commits.length === 0
      ? h.div([h.Class("commits-empty")], ["This pull request has no commits."])
      : h.div(
          [h.Class("commit-list")],
          state.commits.map(commit => commitRow(commit, h)),
        ),
  ]);
};

export const commitDetailHeader = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const commit =
    model.commits._tag === "Ready"
      ? model.commits.commits.find(item => item.sha === model.selectedCommit)
      : undefined;
  return h.section([h.Class("commit-detail-header")], [
    h.button(
      [
        h.Type("button"),
        h.Class("commit-back"),
        h.OnClick(ReturnedToCommitList()),
      ],
      ["← All commits"],
    ),
    h.code([], [model.selectedCommit.slice(0, 7)]),
    h.div([], [
      h.strong([], [commit === undefined ? "Commit diff" : commitTitle(commit)]),
      commit === undefined
        ? h.empty
        : h.span([], [`${commit.author} · ${authoredDate(commit.authoredAt)}`]),
    ]),
    commit?.htmlUrl
      ? h.a(
          [
            h.Href(commit.htmlUrl),
            h.Target("_blank"),
            h.Rel("noreferrer"),
          ],
          ["Open on GitHub ↗"],
        )
      : h.empty,
  ]);
};

export const commitDiffStateView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const state = model.commitDiff;
  if (state._tag === "Loading") {
    return h.section([h.Class("commits-state")], [
      h.span([h.Class("semantic-icon")], ["◌"]),
      h.strong([], [`Loading ${state.sha.slice(0, 7)}…`]),
      h.span([], ["Fetching this commit's patch from GitHub."]),
    ]);
  }
  if (state._tag === "Failed") {
    return h.section([h.Class("commits-state is-error"), h.Role("alert")], [
      h.span([h.Class("semantic-icon")], ["!"]),
      h.strong([], ["Could not load commit diff"]),
      h.span([], [state.error]),
      h.button(
        [
          h.Type("button"),
          h.Class("context-button"),
          h.OnClick(SelectedCommit({ sha: state.sha })),
        ],
        ["Retry"],
      ),
    ]);
  }
  return h.empty;
};
