import { Effect, Schema as S, Stream } from "effect";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
} from "effect/unstable/http";
import { Command, Http, Subscription } from "foldkit";

import {
  CheckedReviewRevision,
  FailedRevisionCheck,
  RequestedRevisionCheck,
} from "../domain";
import type { Message, Model } from "../domain";
import { isPullRequestUrl } from "../review-route";

const errorMessage = (value: unknown, fallback: string) =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).error === "string"
    ? String((value as Record<string, unknown>).error)
    : fallback;

const transportError = (error: unknown) =>
  HttpClientError.isHttpClientError(error) &&
  error.reason._tag === "TransportError"
    ? "Hunker’s local backend is offline. Start it with `bun run dev`, then retry."
    : error instanceof Error
      ? error.message
      : "Could not check the local PR revision.";

export const CheckReviewRevision = Command.define("CheckReviewRevision", {
  args: { url: S.String, headOid: S.String },
  messages: [CheckedReviewRevision, FailedRevisionCheck],
  execute: ({ url, headOid }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const query = new URLSearchParams({ url, headOid });
      const response = yield* client.execute(
        HttpClientRequest.get(`/api/revision?${query.toString()}`),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.fail(
          new Error(errorMessage(data, "Could not check the local PR revision.")),
        );
      }
      if (typeof data !== "object" || data === null) {
        return yield* Effect.fail(new Error("Git returned an unexpected revision status."));
      }
      const record = data as Record<string, unknown>;
      if (
        record.source !== "local" ||
        typeof record.pinnedHeadOid !== "string" ||
        typeof record.latestHeadOid !== "string" ||
        typeof record.checkedAt !== "number" ||
        typeof record.current !== "boolean"
      ) {
        return yield* Effect.fail(new Error("This review is no longer locally backed."));
      }
      return CheckedReviewRevision({
        requestedUrl: url,
        pinnedHeadOid: record.pinnedHeadOid,
        latestHeadOid: record.latestHeadOid,
        checkedAt: record.checkedAt,
        current: record.current,
      });
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          FailedRevisionCheck({
            requestedUrl: url,
            error: transportError(error),
          }),
        ),
      ),
      Effect.provide(Http.layer),
    ),
});

const revisionPoll = Stream.tick("2 minutes").pipe(
  Stream.drop(1),
  Stream.map(() => RequestedRevisionCheck()),
);

export const revisionSubscriptions = Subscription.make<Model, Message>()(entry => ({
  localRevisionPoll: entry(
    { active: S.Boolean, url: S.String, headOid: S.String },
    {
      modelToDependencies: model => ({
        active:
          model.page === "review" &&
          model.phase === "ready" &&
          model.meta.backing.source === "local" &&
          isPullRequestUrl(model.meta.url),
        url: model.meta.url,
        headOid: model.meta.backing.headOid,
      }),
      dependenciesToStream: ({ active }) =>
        active ? revisionPoll : Stream.empty,
    },
  ),
}));
