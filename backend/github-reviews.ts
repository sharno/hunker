import { Effect, Option, Schema as S } from "effect";
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

const GitHubReviewCommentResponse = S.Struct({
  id: S.Number,
  path: S.String,
  body: S.String,
  user: S.NullOr(S.Struct({ login: S.String })),
  html_url: S.String,
  created_at: S.String,
  in_reply_to_id: S.optional(S.Number),
  line: S.NullOr(S.Number),
  original_line: S.NullOr(S.Number),
  side: S.NullOr(S.String),
  original_side: S.NullOr(S.String),
});

const GitHubReviewCommentsResponse = S.Array(GitHubReviewCommentResponse);

const reviewComment = (
  comment: S.Schema.Type<typeof GitHubReviewCommentResponse>,
): ReviewComment => {
  const sideValue = comment.side ?? comment.original_side;
  return {
    id: comment.id,
    rootId: comment.in_reply_to_id ?? comment.id,
    path: comment.path,
    body: comment.body,
    author: comment.user?.login ?? "GitHub user",
    htmlUrl: comment.html_url,
    createdAt: comment.created_at,
    line: comment.line ?? comment.original_line,
    side: sideValue === "LEFT" ? "LEFT" : "RIGHT",
    resolved: false,
  };
};

const decodeComments = (value: unknown): ReadonlyArray<ReviewComment> =>
  Option.match(S.decodeUnknownOption(GitHubReviewCommentsResponse)(value), {
    onNone: () => [],
    onSome: (comments) => comments.map(reviewComment),
  });

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

const GitHubReviewThreadsResponse = S.Struct({
  data: S.Struct({
    repository: S.NullOr(
      S.Struct({
        pullRequest: S.NullOr(
          S.Struct({
            reviewThreads: S.Struct({
              nodes: S.Array(
                S.Struct({
                  isResolved: S.Boolean,
                  comments: S.Struct({
                    nodes: S.Array(
                      S.Struct({
                        fullDatabaseId: S.NullOr(S.Union([S.String, S.Number])),
                      }),
                    ),
                  }),
                }),
              ),
              pageInfo: S.Struct({
                hasNextPage: S.Boolean,
                endCursor: S.NullOr(S.String),
              }),
            }),
          }),
        ),
      }),
    ),
  }),
});

export const decodeResolvedThreadsPage = (
  value: unknown,
): ResolvedThreadsPage => {
  const decoded = Option.getOrUndefined(
    S.decodeUnknownOption(GitHubReviewThreadsResponse)(value),
  );
  const reviewThreads = decoded?.data.repository?.pullRequest?.reviewThreads;
  if (reviewThreads === undefined) {
    return { resolutions: [], nextCursor: null };
  }
  const resolutions = reviewThreads.nodes.flatMap((thread) => {
    const rawId = thread.comments.nodes[0]?.fullDatabaseId;
    const id =
      rawId === null || rawId === undefined ? Number.NaN : Number(rawId);
    return Number.isSafeInteger(id)
      ? ([[id, thread.isResolved]] satisfies ReadonlyArray<
          readonly [number, boolean]
        >)
      : [];
  });
  const nextCursor = reviewThreads.pageInfo.hasNextPage
    ? reviewThreads.pageInfo.endCursor
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
    return comments.map((comment) =>
      Object.assign({}, comment, {
        resolved: resolutions.get(comment.rootId) ?? false,
      }),
    );
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
    const value: unknown = yield* response.json;
    return Option.map(
      S.decodeUnknownOption(GitHubReviewCommentResponse)(value),
      reviewComment,
    ).pipe(Option.getOrUndefined);
  });

export const createReviewComment = (
  target: PullTarget,
  input: Readonly<{
    commitId: string;
    path: string;
    line: number;
    side: "LEFT" | "RIGHT";
    body: string;
  }>,
) =>
  Effect.gen(function* () {
    const request = HttpClientRequest.post(
      `${repositoryApiUrl(target)}/pulls/${target.number}/comments`,
    ).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        body: input.body,
        commit_id: input.commitId,
        path: input.path,
        line: input.line,
        side: input.side,
      }),
    );
    const response = yield* executeGitHubRequest(
      request,
      "application/vnd.github+json",
    );
    const value: unknown = yield* response.json;
    return Option.map(
      S.decodeUnknownOption(GitHubReviewCommentResponse)(value),
      reviewComment,
    ).pipe(Option.getOrUndefined);
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
