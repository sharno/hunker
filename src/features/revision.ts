import { Effect, Option, Schema as S, Stream } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Command, Subscription } from "foldkit";

import { requestError, responseFailure } from "../api";
import {
  SucceededCheckReviewRevision,
  FailedCheckReviewRevision,
  TickedRevisionPoll,
} from "../domain";
import type { Message, Model } from "../domain";
import { isPullRequestUrl, reviewRouteFromAppRoute } from "../review-route";

const RevisionResponse = S.Struct({
  source: S.Literal("local"),
  pinnedHeadOid: S.String,
  latestHeadOid: S.String,
  checkedAt: S.Number,
  current: S.Boolean,
});

export const CheckReviewRevision = Command.define("CheckReviewRevision", {
  args: { url: S.String, headOid: S.String },
  messages: [SucceededCheckReviewRevision, FailedCheckReviewRevision],
  execute: ({ url, headOid }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const query = new URLSearchParams({ url, headOid });
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/revision?${query.toString()}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(
          data,
          "Could not check the local PR revision.",
        );
      }
      const revision = yield* S.decodeUnknownEffect(RevisionResponse)(data);
      return SucceededCheckReviewRevision({
        requestedUrl: url,
        pinnedHeadOid: revision.pinnedHeadOid,
        latestHeadOid: revision.latestHeadOid,
        checkedAt: revision.checkedAt,
        current: revision.current,
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedCheckReviewRevision({
            requestedUrl: url,
            error: requestError(
              error,
              "Could not check the local PR revision.",
            ),
          }),
        ),
      ),
    ),
});

const revisionPoll = Stream.tick("2 minutes").pipe(
  Stream.drop(1),
  Stream.map(() => TickedRevisionPoll()),
);

export const revisionSubscriptions = Subscription.make<Model, Message>()(
  (entry) => ({
    localRevisionPoll: entry(
      {
        maybeRevision: S.Option(S.Struct({ url: S.String, headOid: S.String })),
      },
      {
        modelToDependencies: (model) => ({
          maybeRevision:
            reviewRouteFromAppRoute(model.location) !== undefined &&
            model.reviewState._tag === "Ready" &&
            model.meta.backing.source === "local" &&
            isPullRequestUrl(model.meta.url)
              ? Option.some({
                  url: model.meta.url,
                  headOid: model.meta.backing.headOid,
                })
              : Option.none(),
        }),
        dependenciesToStream: ({ maybeRevision }) =>
          Option.match(maybeRevision, {
            onNone: () => Stream.empty,
            onSome: () => revisionPoll,
          }),
      },
    ),
  }),
);
