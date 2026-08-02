import { Effect } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
} from "effect/unstable/http";

import {
  executeGitHub,
  executeGitHubRequest,
  GitHubFetchFailed,
  type PullTarget,
} from "./github";
import { GitHubAuth } from "./github-auth";

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
  resolved: boolean;
}>;

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

const repositoryApiUrl = (target: PullTarget) =>
  `https://api.github.com/repos/${target.owner}/${target.repo}`;

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

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
  const sideValue =
    stringField(comment, "side") || stringField(comment, "original_side");
  return {
    id,
    rootId: numberField(comment, "in_reply_to_id") ?? id,
    path,
    body: stringField(comment, "body"),
    author: stringField(user, "login") || "GitHub user",
    htmlUrl: stringField(comment, "html_url"),
    createdAt: stringField(comment, "created_at"),
    line:
      numberField(comment, "line") ??
      numberField(comment, "original_line") ??
      null,
    side: sideValue === "LEFT" ? "LEFT" : "RIGHT",
    resolved: false,
  };
};

const decodeComments = (value: unknown): ReadonlyArray<ReviewComment> =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const comment = reviewComment(item);
        return comment === undefined ? [] : [comment];
      })
    : [];

const reviewThreadsQuery = `
  query HunkerReviewThreads($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $cursor) {
          nodes {
            isResolved
            comments(first: 1) {
              nodes { fullDatabaseId }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

type ResolvedThreadsPage = Readonly<{
  resolutions: ReadonlyArray<readonly [number, boolean]>;
  nextCursor: string | null;
}>;

export const decodeResolvedThreadsPage = (
  value: unknown,
): ResolvedThreadsPage => {
  const data = asRecord(asRecord(value).data);
  const repository = asRecord(data.repository);
  const pullRequest = asRecord(repository.pullRequest);
  const reviewThreads = asRecord(pullRequest.reviewThreads);
  const nodes = Array.isArray(reviewThreads.nodes) ? reviewThreads.nodes : [];
  const resolutions = nodes.flatMap((node) => {
    const thread = asRecord(node);
    const comments = asRecord(thread.comments);
    const root = Array.isArray(comments.nodes)
      ? asRecord(comments.nodes[0])
      : {};
    const rawId = root.fullDatabaseId;
    const id =
      typeof rawId === "string" || typeof rawId === "number"
        ? Number(rawId)
        : Number.NaN;
    return Number.isSafeInteger(id) && typeof thread.isResolved === "boolean"
      ? [[id, thread.isResolved] as const]
      : [];
  });
  const pageInfo = asRecord(reviewThreads.pageInfo);
  const nextCursor =
    pageInfo.hasNextPage === true && typeof pageInfo.endCursor === "string"
      ? pageInfo.endCursor
      : null;
  return { resolutions, nextCursor };
};

const loadResolvedThreads = (target: PullTarget) => {
  const loadPage = (
    cursor: string | null,
  ): Effect.Effect<
    ReadonlyMap<number, boolean>,
    GitHubFetchFailed | HttpClientError.HttpClientError,
    HttpClient.HttpClient | GitHubAuth
  > =>
    Effect.gen(function* () {
      const request = HttpClientRequest.post(
        "https://api.github.com/graphql",
      ).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          query: reviewThreadsQuery,
          variables: {
            owner: target.owner,
            repo: target.repo,
            number: Number(target.number),
            cursor,
          },
        }),
      );
      const response = yield* executeGitHubRequest(request, "application/json");
      const page = decodeResolvedThreadsPage(yield* response.json);
      if (page.nextCursor === null) return new Map(page.resolutions);
      const remaining = yield* loadPage(page.nextCursor);
      return new Map([...page.resolutions, ...remaining]);
    });
  return loadPage(null);
};

export const loadReviewComments = (target: PullTarget) =>
  Effect.gen(function* () {
    const response = yield* executeGitHub(
      `${repositoryApiUrl(target)}/pulls/${target.number}/comments?per_page=100`,
      "application/vnd.github+json",
    );
    const comments = decodeComments(yield* response.json);
    const resolutions = yield* loadResolvedThreads(target).pipe(
      Effect.catch((error) =>
        Effect.logWarning(
          `GitHub review thread resolution state unavailable: ${error.message}`,
        ).pipe(Effect.as(new Map<number, boolean>())),
      ),
    );
    return comments.map((comment) => ({
      ...comment,
      resolved: resolutions.get(comment.rootId) ?? false,
    }));
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
    const response = yield* executeGitHubRequest(
      request,
      "application/vnd.github+json",
    );
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
