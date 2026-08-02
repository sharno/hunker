import { Array, Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { button } from "./control";
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

const commitRow = (commit: PullCommit, h: HtmlBuilder<Message>): Html => {
  const description = commitDescription(commit);
  return button(
    h,
    [
      h.Key(commit.sha),
      h.Type("button"),
      h.Class("commit-row"),
      h.OnClick(SelectedCommit({ sha: commit.sha })),
    ],
    [
      h.span(
        [h.Class("commit-avatar")],
        [commit.author.slice(0, 2).toUpperCase()],
      ),
      h.span(
        [h.Class("commit-copy")],
        [
          h.strong([], [commitTitle(commit)]),
          description === "" ? h.empty : h.span([], [description]),
          h.small(
            [],
            [`${commit.author} committed ${authoredDate(commit.authoredAt)}`],
          ),
        ],
      ),
      h.code([h.Class("commit-sha")], [commit.sha.slice(0, 7)]),
      h.span([h.Class("commit-open-arrow")], ["→"]),
    ],
  );
};

export const commitListView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const loadingView = () =>
    h.section(
      [h.Class("commits-state")],
      [
        h.span([h.Class("semantic-icon")], ["◌"]),
        h.strong([], ["Loading commits…"]),
        h.span([], ["Reading the pull request history from GitHub."]),
      ],
    );
  const failureView = (error: string) =>
    h.section(
      [h.Class("commits-state is-error"), h.Role("alert")],
      [
        h.span([h.Class("semantic-icon")], ["!"]),
        h.strong([], ["Could not load commits"]),
        h.span([], [error]),
        button(
          h,
          [
            h.Type("button"),
            h.Class("context-button"),
            h.OnClick(SelectedReviewTab({ value: "commits" })),
          ],
          ["Retry"],
        ),
      ],
    );
  const successView = (commits: ReadonlyArray<PullCommit>) =>
    h.section(
      [h.Class("commits-browser")],
      [
        h.div(
          [h.Class("commits-heading")],
          [
            h.div(
              [],
              [
                h.h2(
                  [],
                  [
                    `${commits.length} ${commits.length === 1 ? "commit" : "commits"}`,
                  ],
                ),
                h.p(
                  [],
                  [
                    "Select a commit to review only the change against its parent.",
                  ],
                ),
              ],
            ),
            h.span([], ["Oldest → newest"]),
          ],
        ),
        Array.match(commits, {
          onEmpty: () =>
            h.div(
              [h.Class("commits-empty")],
              ["This pull request has no commits."],
            ),
          onNonEmpty: (items) =>
            h.div(
              [h.Class("commit-list")],
              Array.map(items, (commit) => commitRow(commit, h)),
            ),
        }),
      ],
    );
  return AsyncData.matchDataSplitEmpty(model.commits, {
    onIdle: loadingView,
    onLoading: loadingView,
    onFailure: failureView,
    onData: successView,
  });
};

export const commitDetailHeader = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const commit = Option.getOrUndefined(
    AsyncData.getData(model.commits).pipe(
      Option.flatMap((commits) =>
        Array.findFirst(commits, (item) => item.sha === model.selectedCommit),
      ),
    ),
  );
  return h.section(
    [h.Class("commit-detail-header")],
    [
      button(
        h,
        [
          h.Type("button"),
          h.Class("commit-back"),
          h.OnClick(ReturnedToCommitList()),
        ],
        ["← All commits"],
      ),
      h.code([], [model.selectedCommit.slice(0, 7)]),
      h.div(
        [],
        [
          h.strong(
            [],
            [commit === undefined ? "Commit diff" : commitTitle(commit)],
          ),
          commit === undefined
            ? h.empty
            : h.span(
                [],
                [`${commit.author} · ${authoredDate(commit.authoredAt)}`],
              ),
        ],
      ),
      commit?.htmlUrl
        ? h.a(
            [
              h.Href(commit.htmlUrl),
              h.Target("_blank"),
              h.Rel("noopener noreferrer"),
            ],
            ["Open on GitHub ↗"],
          )
        : h.empty,
    ],
  );
};

export const commitDiffStateView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const state = model.commitDiff;
  if (AsyncData.isPending(state)) {
    return h.section(
      [h.Class("commits-state")],
      [
        h.span([h.Class("semantic-icon")], ["◌"]),
        h.strong([], [`Loading ${model.selectedCommit.slice(0, 7)}…`]),
        h.span([], ["Fetching this commit's patch from GitHub."]),
      ],
    );
  }
  if (AsyncData.isFailure(state)) {
    return h.section(
      [h.Class("commits-state is-error"), h.Role("alert")],
      [
        h.span([h.Class("semantic-icon")], ["!"]),
        h.strong([], ["Could not load commit diff"]),
        h.span([], [state.error]),
        button(
          h,
          [
            h.Type("button"),
            h.Class("context-button"),
            h.OnClick(SelectedCommit({ sha: model.selectedCommit })),
          ],
          ["Retry"],
        ),
      ],
    );
  }
  return h.empty;
};
