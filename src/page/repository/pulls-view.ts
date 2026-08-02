import { Option } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { pullRouter } from "../../app-route";
import type {
  PullRequestFilter,
  RepositoryPullRequest,
} from "../../features/repository-pulls";
import { button } from "../../view/control";
import {
  ClickedLoadMorePullRequests,
  type Message,
  SelectedPullRequestFilter,
} from "./message";
import type { Model } from "./model";

const updatedDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
};

const pullRequestStateLabel = (pullRequest: RepositoryPullRequest) =>
  pullRequest.draft
    ? "Draft"
    : pullRequest.state === "merged"
      ? "Merged"
      : pullRequest.state === "closed"
        ? "Closed"
        : "Open";

const pullRequestFilterLabel = (state: PullRequestFilter) =>
  state === "all" ? "All" : state === "closed" ? "Closed" : "Open";
const pullRequestFilters: ReadonlyArray<PullRequestFilter> = [
  "open",
  "closed",
  "all",
];

const pullRequestRow = (
  model: Model,
  pullRequest: RepositoryPullRequest,
  h: HtmlBuilder<Message>,
): Html =>
  h.a(
    [
      h.Key(String(pullRequest.number)),
      h.Class("repository-pull-row"),
      h.Href(
        pullRouter({
          owner: model.owner,
          repository: model.name,
          number: pullRequest.number,
        }),
      ),
    ],
    [
      pullRequest.avatarUrl === ""
        ? h.span(
            [h.Class("repository-pull-avatar")],
            [pullRequest.author.slice(0, 2).toUpperCase()],
          )
        : h.img([
            h.Class("repository-pull-avatar"),
            h.Src(pullRequest.avatarUrl),
            h.Alt(""),
          ]),
      h.span(
        [h.Class("repository-pull-copy")],
        [
          h.span(
            [h.Class("repository-pull-title")],
            [
              h.strong([], [pullRequest.title]),
              h.code([], [`#${pullRequest.number}`]),
            ],
          ),
          h.small(
            [],
            [
              `${pullRequest.author} updated ${updatedDate(pullRequest.updatedAt)} · ${pullRequest.head} → ${pullRequest.base}`,
            ],
          ),
          pullRequest.labels.length === 0
            ? h.empty
            : h.span(
                [h.Class("repository-pull-labels")],
                pullRequest.labels.map((label) => h.span([], [label])),
              ),
        ],
      ),
      h.span(
        [
          h.Class(
            `repository-pull-state is-${pullRequest.draft ? "draft" : pullRequest.state}`,
          ),
        ],
        [pullRequestStateLabel(pullRequest)],
      ),
      h.span([h.Class("commit-open-arrow")], ["→"]),
    ],
  );

export const repositoryPullRequestsView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  const data = Option.getOrUndefined(AsyncData.getData(model.pullRequests));
  const stateView =
    data === undefined
      ? AsyncData.isPending(model.pullRequests)
        ? h.div(
            [h.Class("commits-state"), h.Role("status")],
            [
              h.span([h.Class("semantic-icon")], ["◌"]),
              h.strong([], ["Loading pull requests…"]),
              h.span([], ["Reading pull requests through your GitHub login."]),
            ],
          )
        : AsyncData.isFailure(model.pullRequests)
          ? h.div(
              [h.Class("commits-state is-error"), h.Role("alert")],
              [
                h.span([h.Class("semantic-icon")], ["!"]),
                h.strong([], ["Could not load pull requests"]),
                h.span([], [model.pullRequests.error]),
                button(
                  h,
                  [
                    h.Type("button"),
                    h.Class("context-button"),
                    h.OnClick(
                      SelectedPullRequestFilter({
                        state: model.pullRequestFilter,
                      }),
                    ),
                  ],
                  ["Retry"],
                ),
              ],
            )
          : h.empty
      : h.div(
          [h.Class("repository-pull-list")],
          [
            ...(data.pullRequests.length === 0
              ? [
                  h.div(
                    [h.Class("commits-empty")],
                    [
                      `No ${pullRequestFilterLabel(model.pullRequestFilter).toLowerCase()} pull requests.`,
                    ],
                  ),
                ]
              : data.pullRequests.map((pullRequest) =>
                  pullRequestRow(model, pullRequest, h),
                )),
            AsyncData.isStale(model.pullRequests)
              ? h.div(
                  [h.Class("repository-pull-page-error"), h.Role("alert")],
                  [model.pullRequests.error],
                )
              : h.empty,
            data.hasMore
              ? button(
                  h,
                  [
                    h.Type("button"),
                    h.Class("repository-pull-load-more"),
                    h.Disabled(AsyncData.isPending(model.pullRequests)),
                    h.OnClick(ClickedLoadMorePullRequests()),
                  ],
                  [
                    AsyncData.isPending(model.pullRequests)
                      ? "Loading more…"
                      : "Load more",
                  ],
                )
              : h.empty,
          ],
        );
  return h.section(
    [h.Class("repository-pulls-browser")],
    [
      h.div(
        [h.Class("repository-pulls-heading")],
        [
          h.div(
            [],
            [
              h.span([], ["GitHub"]),
              h.h1([], [`Pull requests for ${model.owner}/${model.name}`]),
              h.p([], ["Open a pull request directly in Hunker’s diff view."]),
            ],
          ),
          h.div(
            [h.Class("segmented repository-pull-filters")],
            pullRequestFilters.map((state) =>
              button(
                h,
                [
                  h.Type("button"),
                  h.Class(
                    `segmented-button${model.pullRequestFilter === state ? " is-active" : ""}`,
                  ),
                  h.OnClick(SelectedPullRequestFilter({ state })),
                ],
                [pullRequestFilterLabel(state)],
              ),
            ),
          ),
        ],
      ),
      stateView,
    ],
  );
};
