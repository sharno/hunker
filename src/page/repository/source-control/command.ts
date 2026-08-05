import { Effect, Schema as S } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Command } from "foldkit";

import { requestError, responseFailure } from "../../../api";
import {
  FailedFetch,
  FailedPull,
  FailedSwitch,
  SucceededFetch,
  SucceededPull,
  SucceededSwitch,
} from "./message";
import { Status } from "./model";

const statusResponse = S.Struct({ status: Status });
const pullResponse = S.Struct({ status: Status, pulledCommits: S.Number });

export const Fetch = Command.define("Fetch", {
  args: { repository: S.NonEmptyString },
  messages: [SucceededFetch, FailedFetch],
  execute: ({ repository }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const query = new URLSearchParams({ repository });
      const response = yield* client.execute(
        HttpClientRequest.get(
          `/api/repository/source-control?${query.toString()}`,
        ),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(
          data,
          "Could not inspect repository source control.",
        );
      }
      const decoded = yield* S.decodeUnknownEffect(statusResponse)(data);
      return SucceededFetch({ repository, status: decoded.status });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedFetch({
            repository,
            error: requestError(error, "Could not inspect source control."),
          }),
        ),
      ),
    ),
});

export const Switch = Command.define("Switch", {
  args: { repository: S.NonEmptyString, branch: S.NonEmptyString },
  messages: [SucceededSwitch, FailedSwitch],
  execute: ({ repository, branch }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.execute(
        HttpClientRequest.post("/api/repository/branch").pipe(
          HttpClientRequest.bodyJsonUnsafe({ repository, branch }),
        ),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(data, `Could not switch to ${branch}.`);
      }
      const decoded = yield* S.decodeUnknownEffect(statusResponse)(data);
      return SucceededSwitch({ repository, branch, status: decoded.status });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedSwitch({
            repository,
            branch,
            error: requestError(error, `Could not switch to ${branch}.`),
          }),
        ),
      ),
    ),
});

export const Pull = Command.define("Pull", {
  args: { repository: S.NonEmptyString },
  messages: [SucceededPull, FailedPull],
  execute: ({ repository }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.execute(
        HttpClientRequest.post("/api/repository/pull").pipe(
          HttpClientRequest.bodyJsonUnsafe({ repository }),
        ),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(data, "Could not pull this branch.");
      }
      const decoded = yield* S.decodeUnknownEffect(pullResponse)(data);
      return SucceededPull({ repository, ...decoded });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedPull({
            repository,
            error: requestError(error, "Could not pull this branch."),
          }),
        ),
      ),
    ),
});
