import { Effect } from "effect";
import { HttpClientRequest } from "effect/unstable/http";

import {
  executeGitHub,
  executeGitHubRequest,
  type PullTarget,
} from "./github";

export type ReviewComment = Readonly<{
  id: number;
  rootId: number;
  path: string;
  body: string;
  author: string;
  htmlUrl: string;
  createdAt: string;
  line: number | null;
  side: "LEFT" | "RIGHT";
}>;

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

const repositoryApiUrl = (target: PullTarget) =>
  `https://api.github.com/repos/${target.owner}/${target.repo}`;

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const stringField = (record: Readonly<Record<string, unknown>>, key: string) =>
  typeof record[key] === "string" ? record[key] : "";

const numberField = (record: Readonly<Record<string, unknown>>, key: string) =>
  typeof record[key] === "number" ? record[key] : undefined;

const reviewComment = (value: unknown): ReviewComment | undefined => {
  const comment = asRecord(value);
  const id = numberField(comment, "id");
  const path = stringField(comment, "path");
  if (id === undefined || path === "") return undefined;
  const user = asRecord(comment.user);
  const sideValue = stringField(comment, "side") || stringField(comment, "original_side");
  return {
    id,
    rootId: numberField(comment, "in_reply_to_id") ?? id,
    path,
    body: stringField(comment, "body"),
    author: stringField(user, "login") || "GitHub user",
    htmlUrl: stringField(comment, "html_url"),
    createdAt: stringField(comment, "created_at"),
    line: numberField(comment, "line") ?? numberField(comment, "original_line") ?? null,
    side: sideValue === "LEFT" ? "LEFT" : "RIGHT",
  };
};

const decodeComments = (value: unknown): ReadonlyArray<ReviewComment> =>
  Array.isArray(value) ? value.flatMap(item => {
    const comment = reviewComment(item);
    return comment === undefined ? [] : [comment];
  }) : [];

export const loadReviewComments = (target: PullTarget) =>
  Effect.gen(function* () {
    const response = yield* executeGitHub(
      `${repositoryApiUrl(target)}/pulls/${target.number}/comments?per_page=100`,
      "application/vnd.github+json",
    );
    return decodeComments(yield* response.json);
  });

export const replyToReviewComment = (
  target: PullTarget,
  commentId: number,
  body: string,
) =>
  Effect.gen(function* () {
    const request = HttpClientRequest.post(
      `${repositoryApiUrl(target)}/pulls/${target.number}/comments/${commentId}/replies`,
    ).pipe(HttpClientRequest.bodyJsonUnsafe({ body }));
    const response = yield* executeGitHubRequest(request, "application/vnd.github+json");
    const comment = reviewComment(yield* response.json);
    return comment;
  });

export const submitPullRequestReview = (
  target: PullTarget,
  body: string,
  event: ReviewEvent,
) => {
  const request = HttpClientRequest.post(
    `${repositoryApiUrl(target)}/pulls/${target.number}/reviews`,
  ).pipe(HttpClientRequest.bodyJsonUnsafe({ body, event }));
  return executeGitHubRequest(request, "application/vnd.github+json");
};
