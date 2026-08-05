import { Effect, Schema as S } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Command } from "foldkit";

import { requestError, responseFailure } from "../../api";
import { GitHubReviewComment } from "../github-review-comment";
import { FailedPostInlineComment, SucceededPostInlineComment } from "./message";
import { Target } from "./model";

const Response = S.Struct({ comment: GitHubReviewComment });

export const PostInlineComment = Command.define("PostInlineComment", {
  args: { target: Target, body: S.NonEmptyString },
  messages: [SucceededPostInlineComment, FailedPostInlineComment],
  execute: ({ target, body }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.execute(
        HttpClientRequest.post("/api/reviews/comment").pipe(
          HttpClientRequest.bodyJsonUnsafe({ ...target, body }),
        ),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(data, "Could not post inline comment.");
      }
      const decoded = yield* S.decodeUnknownEffect(Response)(data);
      return SucceededPostInlineComment({ target, comment: decoded.comment });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedPostInlineComment({
            target,
            error: requestError(error, "Could not post inline comment."),
          }),
        ),
      ),
    ),
});
