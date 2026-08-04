import { Array } from "effect";
import { AsyncData } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";

import { button, textarea } from "./control";
import {
  UpdatedReplyDraft,
  UpdatedReviewBody,
  SubmittedReply,
  SubmittedReview,
  ToggledReviewThreadCollapse,
} from "../domain";
import type {
  GitHubReviewComment,
  Message,
  Model,
  ReplyDraft,
  ReplyState,
} from "../domain";
import type { DiffLine } from "../diff";
import { isPullRequestUrl } from "../review-route";
import { markdownSummary, markdownView } from "./markdown-view";

export type GitHubReviewInteraction = Readonly<{
  comments: ReadonlyArray<GitHubReviewComment>;
  replyDrafts: ReadonlyArray<ReplyDraft>;
  replyStates: ReadonlyArray<ReplyState>;
  collapsedThreads: ReadonlyArray<number>;
}>;

const rootComments = (comments: ReadonlyArray<GitHubReviewComment>) =>
  comments.filter((comment) => comment.id === comment.rootId);

const repliesFor = (
  root: GitHubReviewComment,
  comments: ReadonlyArray<GitHubReviewComment>,
) =>
  comments.filter(
    (comment) => comment.rootId === root.id && comment.id !== root.id,
  );

const commentMatchesLine = (
  comment: GitHubReviewComment,
  path: string,
  oldNumber: number | null,
  newNumber: number | null,
) =>
  comment.path === path &&
  comment.line !== null &&
  (comment.side === "LEFT"
    ? comment.line === oldNumber
    : comment.line === newNumber);

const commentMeta = (comment: GitHubReviewComment) => {
  const date = comment.createdAt.slice(0, 10);
  return date === "" ? `@${comment.author}` : `@${comment.author} · ${date}`;
};

const commentView = (
  comment: GitHubReviewComment,
  reply: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.article(
    [
      h.Key(`review-comment-${comment.id}`),
      h.Class(`github-review-comment${reply ? " is-reply" : ""}`),
    ],
    [
      reply
        ? h.div(
            [h.Class("github-review-comment-header")],
            [
              h.strong([], [commentMeta(comment)]),
              comment.htmlUrl === ""
                ? h.empty
                : h.a(
                    [
                      h.Href(comment.htmlUrl),
                      h.Target("_blank"),
                      h.Rel("noopener noreferrer"),
                      h.Class("github-review-link"),
                    ],
                    ["Open on GitHub ↗"],
                  ),
            ],
          )
        : h.empty,
      markdownView(comment.body, h),
    ],
  );

const threadView = (
  root: GitHubReviewComment,
  interaction: GitHubReviewInteraction,
  h: HtmlBuilder<Message>,
): Html => {
  const draft =
    interaction.replyDrafts.find((item) => item.commentId === root.id)?.body ??
    "";
  const replyState = interaction.replyStates.find(
    (item) => item.commentId === root.id,
  );
  const loading = replyState?._tag === "Loading";
  const collapsed = interaction.collapsedThreads.includes(root.id);
  const summary = markdownSummary(root.body);
  return h.section(
    [
      h.Key(`review-thread-${root.id}`),
      h.Id(`discussion_r${root.id}`),
      h.Class(`github-review-thread${collapsed ? " is-collapsed" : ""}`),
    ],
    [
      h.div(
        [h.Class("github-review-thread-heading")],
        [
          button(
            h,
            [
              h.Type("button"),
              h.Class("github-review-thread-toggle"),
              h.AriaExpanded(!collapsed),
              h.AriaLabel(
                `${collapsed ? "Expand" : "Collapse"} review thread from ${root.author}`,
              ),
              h.OnClick(ToggledReviewThreadCollapse({ threadId: root.id })),
            ],
            [
              h.span([h.Class("collapse-chevron")], [collapsed ? "›" : "⌄"]),
              h.strong([], [commentMeta(root)]),
              root.resolved
                ? h.span([h.Class("github-review-resolved")], ["Resolved"])
                : h.empty,
              collapsed
                ? h.span([h.Class("github-review-summary")], [summary])
                : h.empty,
            ],
          ),
          root.htmlUrl === ""
            ? h.empty
            : h.a(
                [
                  h.Href(root.htmlUrl),
                  h.Target("_blank"),
                  h.Rel("noopener noreferrer"),
                  h.Class("github-review-link"),
                ],
                ["Open on GitHub ↗"],
              ),
        ],
      ),
      ...(collapsed
        ? []
        : [
            commentView(root, false, h),
            ...repliesFor(root, interaction.comments).map((comment) =>
              commentView(comment, true, h),
            ),
            h.form(
              [
                h.Class("github-reply-form"),
                h.OnSubmit(SubmittedReply({ commentId: root.id })),
              ],
              [
                textarea(`review-reply-${root.id}`, h, [
                  h.Value(draft),
                  h.Rows(2),
                  h.Placeholder(`Reply to @${root.author}`),
                  h.AriaLabel(`Reply to review from ${root.author}`),
                  h.OnInput((body) =>
                    UpdatedReplyDraft({ commentId: root.id, body }),
                  ),
                ]),
                h.div(
                  [h.Class("github-reply-actions")],
                  [
                    replyState?._tag === "Failed"
                      ? h.span(
                          [h.Class("github-review-error"), h.Role("alert")],
                          [replyState.error],
                        )
                      : h.empty,
                    button(
                      h,
                      [
                        h.Type("submit"),
                        h.Class("github-reply-button"),
                        h.Disabled(loading || draft.trim() === ""),
                      ],
                      [loading ? "Posting…" : "Reply"],
                    ),
                  ],
                ),
              ],
            ),
          ]),
    ],
  );
};

const threadGroup = (
  roots: ReadonlyArray<GitHubReviewComment>,
  interaction: GitHubReviewInteraction,
  className: string,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Array.match(roots, {
    onEmpty: () => [],
    onNonEmpty: (threads) => [
      h.div(
        [h.Class(className)],
        Array.map(threads, (root) => threadView(root, interaction, h)),
      ),
    ],
  });

export const inlineReviewThreads = (
  path: string,
  oldNumber: number | null,
  newNumber: number | null,
  interaction: GitHubReviewInteraction,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  threadGroup(
    rootComments(interaction.comments).filter((comment) =>
      commentMatchesLine(comment, path, oldNumber, newNumber),
    ),
    interaction,
    "inline-review-threads",
    h,
  );

export const detachedReviewThreads = (
  path: string,
  lines: ReadonlyArray<DiffLine>,
  interaction: GitHubReviewInteraction,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const unplaced = rootComments(interaction.comments).filter(
    (comment) =>
      comment.path === path &&
      !lines.some((line) =>
        commentMatchesLine(comment, path, line.oldNumber, line.newNumber),
      ),
  );
  return threadGroup(unplaced, interaction, "detached-review-threads", h);
};

const submissionText = (event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES") =>
  event === "APPROVE"
    ? "Approval posted to GitHub."
    : event === "REQUEST_CHANGES"
      ? "Change request posted to GitHub."
      : "Review comment posted to GitHub.";

export const reviewComposerView = (
  model: Model,
  h: HtmlBuilder<Message>,
): Html => {
  if (!isPullRequestUrl(model.meta.url)) return h.empty;
  const loading = AsyncData.isPending(model.reviewSubmission);
  const hasBody = model.reviewBody.trim() !== "";
  const status = AsyncData.match(model.reviewSubmission, {
    onIdle: () =>
      h.span([], ["Comment and Request changes require a summary."]),
    onLoading: () => h.span([], ["Posting review…"]),
    onRefreshing: () => h.span([], ["Posting review…"]),
    onFailure: (error) =>
      h.span([h.Class("github-review-error"), h.Role("alert")], [error]),
    onStale: ({ error }) =>
      h.span([h.Class("github-review-error"), h.Role("alert")], [error]),
    onSuccess: (event) =>
      h.span(
        [h.Class("github-review-success"), h.Role("status")],
        [submissionText(event)],
      ),
  });
  return h.section(
    [h.Class("github-review-composer")],
    [
      h.div(
        [h.Class("github-review-composer-heading")],
        [
          h.div(
            [],
            [
              h.strong([], ["Submit GitHub review"]),
              h.span([], ["Posts through your local gh authentication."]),
            ],
          ),
          h.span([h.Class("github-review-mark")], ["GH"]),
        ],
      ),
      textarea("review-summary", h, [
        h.Value(model.reviewBody),
        h.Rows(4),
        h.Placeholder("Review summary"),
        h.AriaLabel("GitHub review summary"),
        h.OnInput((body) => UpdatedReviewBody({ body })),
      ]),
      h.div(
        [h.Class("github-review-submit-row")],
        [
          status,
          h.div(
            [h.Class("github-review-submit-actions")],
            [
              button(
                h,
                [
                  h.Type("button"),
                  h.Disabled(loading || !hasBody),
                  h.OnClick(SubmittedReview({ event: "COMMENT" })),
                ],
                ["Comment"],
              ),
              button(
                h,
                [
                  h.Type("button"),
                  h.Class("request-changes-button"),
                  h.Disabled(loading || !hasBody),
                  h.OnClick(SubmittedReview({ event: "REQUEST_CHANGES" })),
                ],
                ["Request changes"],
              ),
              button(
                h,
                [
                  h.Type("button"),
                  h.Class("approve-button"),
                  h.Disabled(loading),
                  h.OnClick(SubmittedReview({ event: "APPROVE" })),
                ],
                [loading ? "Posting…" : "Approve"],
              ),
            ],
          ),
        ],
      ),
    ],
  );
};
