import { Array as EffectArray, Clock, Effect, Schema as S } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Command, Navigation } from "foldkit";

import {
  ApiRequestFailed,
  provideBrowserHttp,
  requestError,
  responseFailure,
} from "./api";
import {
  CharacterDiffResult,
  CompletedNavigate,
  FailedFetchCharacterDiff,
  FailedFetchFullFile,
  FailedFetchGitHubReviews,
  FailedFetchMoves,
  FailedPostReviewReply,
  FailedFetchReview,
  FailedPostPullRequestReview,
  FailedFetchSemantic,
  GitHubReviewComment,
  MovedBlock,
  ReviewBacking,
  SemanticResult,
  SucceededFetchCharacterDiff,
  SucceededFetchFullFile,
  SucceededFetchGitHubReviews,
  SucceededFetchMoves,
  SucceededFetchReview,
  SucceededFetchSemantic,
  SucceededPostReviewReply,
  SucceededPostPullRequestReview,
} from "./domain";
import { parseGitDiff } from "./diff";

const ApiReview = S.Struct({
  title: S.String,
  repository: S.String,
  number: S.String,
  author: S.String,
  base: S.String,
  head: S.String,
  url: S.String,
  backing: ReviewBacking,
  diff: S.String,
});

export const FetchReview = Command.define("FetchReview", {
  args: { url: S.String },
  messages: [SucceededFetchReview, FailedFetchReview],
  execute: ({ url }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const cacheBust = String(yield* Clock.currentTimeMillis);
      const request = HttpClientRequest.get(
        `/api/diff?url=${encodeURIComponent(url)}&refresh=${cacheBust}`,
      );
      const response = yield* client.execute(request);
      const data: unknown = yield* response.json;

      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(data, "Could not load that change.");
      }
      const { diff, ...meta } = yield* S.decodeUnknownEffect(ApiReview)(data);
      const files = parseGitDiff(diff);
      return yield* EffectArray.match(files, {
        onEmpty: () =>
          Effect.fail(
            new ApiRequestFailed({
              message: "This change has no reviewable text diff.",
            }),
          ),
        onNonEmpty: () =>
          Effect.succeed(
            SucceededFetchReview({ requestedUrl: url, meta, files }),
          ),
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedFetchReview({
            requestedUrl: url,
            error: requestError(error, "Could not load that change."),
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});

export const Navigate = Command.define("Navigate", {
  args: {
    href: S.String,
    method: S.Literals(["push", "replace", "load"]),
  },
  messages: [CompletedNavigate],
  execute: ({ href, method }) =>
    (method === "load"
      ? Navigation.load(href)
      : method === "replace"
        ? Navigation.replaceUrl(href)
        : Navigation.pushUrl(href)
    ).pipe(Effect.as(CompletedNavigate())),
});

export const FetchSemantic = Command.define("FetchSemantic", {
  args: {
    url: S.String,
    baseOid: S.String,
    headOid: S.String,
    path: S.String,
    previousPath: S.String,
    status: S.Literals(["modified", "added", "deleted", "renamed"]),
  },
  messages: [SucceededFetchSemantic, FailedFetchSemantic],
  execute: ({ url, baseOid, headOid, path, previousPath, status }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const query = new URLSearchParams({
        url,
        baseOid,
        headOid,
        path,
        previousPath,
        status,
      });
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/semantic?${query.toString()}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(data, "Could not run semantic analysis.");
      }
      const result = yield* S.decodeUnknownEffect(SemanticResult)(data);
      return SucceededFetchSemantic({ requestedUrl: url, path, result });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedFetchSemantic({
            requestedUrl: url,
            path,
            error: requestError(error, "Could not run semantic analysis."),
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});

const MoveResponse = S.Struct({ moves: S.Array(MovedBlock) });
const FullFileResponse = S.Struct({ oldText: S.String, newText: S.String });
const GitHubReviewsResponse = S.Struct({
  comments: S.Array(GitHubReviewComment),
});
const GitHubReplyResponse = S.Struct({ comment: GitHubReviewComment });

export const FetchCharacterDiff = Command.define("FetchCharacterDiff", {
  args: {
    url: S.String,
    baseOid: S.String,
    headOid: S.String,
    path: S.String,
    previousPath: S.String,
    status: S.Literals(["modified", "added", "deleted", "renamed"]),
    ignoreWhitespace: S.Boolean,
    mode: S.Literals(["token", "character"]),
  },
  messages: [SucceededFetchCharacterDiff, FailedFetchCharacterDiff],
  execute: ({
    url,
    baseOid,
    headOid,
    path,
    previousPath,
    status,
    ignoreWhitespace,
    mode,
  }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const query = new URLSearchParams({
        url,
        baseOid,
        headOid,
        path,
        previousPath,
        status,
        whitespace: ignoreWhitespace ? "ignore" : "show",
        mode,
      });
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/characters?${query.toString()}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(
          data,
          "Could not calculate character changes.",
        );
      }
      const result = yield* S.decodeUnknownEffect(CharacterDiffResult)(data);
      return SucceededFetchCharacterDiff({ requestedUrl: url, result });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedFetchCharacterDiff({
            requestedUrl: url,
            path,
            ignoreWhitespace,
            mode,
            error: requestError(
              error,
              "Could not calculate character changes.",
            ),
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});

export const FetchFullFile = Command.define("FetchFullFile", {
  args: {
    url: S.String,
    baseOid: S.String,
    headOid: S.String,
    path: S.String,
    previousPath: S.String,
    status: S.Literals(["modified", "added", "deleted", "renamed"]),
  },
  messages: [SucceededFetchFullFile, FailedFetchFullFile],
  execute: ({ url, baseOid, headOid, path, previousPath, status }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const query = new URLSearchParams({
        url,
        baseOid,
        headOid,
        path,
        previousPath,
        status,
      });
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/file?${query.toString()}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(
          data,
          "Could not load the complete file.",
        );
      }
      const pair = yield* S.decodeUnknownEffect(FullFileResponse)(data);
      return SucceededFetchFullFile({ requestedUrl: url, path, ...pair });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedFetchFullFile({
            requestedUrl: url,
            path,
            error: requestError(error, "Could not load the complete file."),
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});

export const FetchGitHubReviews = Command.define("FetchGitHubReviews", {
  args: { url: S.String },
  messages: [SucceededFetchGitHubReviews, FailedFetchGitHubReviews],
  execute: ({ url }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/reviews?url=${encodeURIComponent(url)}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(data, "Could not load GitHub reviews.");
      }
      const decoded = yield* S.decodeUnknownEffect(GitHubReviewsResponse)(data);
      return SucceededFetchGitHubReviews({
        requestedUrl: url,
        comments: decoded.comments,
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedFetchGitHubReviews({
            requestedUrl: url,
            error: requestError(error, "Could not load GitHub reviews."),
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});

export const PostReviewReply = Command.define("PostReviewReply", {
  args: { url: S.String, commentId: S.Number, body: S.String },
  messages: [SucceededPostReviewReply, FailedPostReviewReply],
  execute: ({ url, commentId, body }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const request = HttpClientRequest.post("/api/reviews/reply").pipe(
        HttpClientRequest.bodyJsonUnsafe({ url, commentId, body }),
      );
      const response = yield* client.execute(request);
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(data, "Could not post reply.");
      }
      const decoded = yield* S.decodeUnknownEffect(GitHubReplyResponse)(data);
      return SucceededPostReviewReply({ comment: decoded.comment });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedPostReviewReply({
            commentId,
            error: requestError(error, "Could not post reply."),
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});

export const PostPullRequestReview = Command.define("PostPullRequestReview", {
  args: {
    url: S.String,
    body: S.String,
    event: S.Literals(["COMMENT", "APPROVE", "REQUEST_CHANGES"]),
  },
  messages: [SucceededPostPullRequestReview, FailedPostPullRequestReview],
  execute: ({ url, body, event }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const request = HttpClientRequest.post("/api/reviews/submit").pipe(
        HttpClientRequest.bodyJsonUnsafe({ url, body, event }),
      );
      const response = yield* client.execute(request);
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(
          data,
          "Could not submit the GitHub review.",
        );
      }
      return SucceededPostPullRequestReview({ event });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedPostPullRequestReview({
            error: requestError(error, "Could not submit the GitHub review."),
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});

export const FetchMoves = Command.define("FetchMoves", {
  args: { url: S.String, baseOid: S.String, headOid: S.String },
  messages: [SucceededFetchMoves, FailedFetchMoves],
  execute: ({ url, baseOid, headOid }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const query = new URLSearchParams({ url, baseOid, headOid });
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/moves?${query.toString()}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(
          data,
          "Could not scan this review for moved code.",
        );
      }
      const decoded = yield* S.decodeUnknownEffect(MoveResponse)(data);
      return SucceededFetchMoves({ requestedUrl: url, moves: decoded.moves });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedFetchMoves({
            requestedUrl: url,
            error: requestError(
              error,
              "Could not scan this review for moved code.",
            ),
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});
