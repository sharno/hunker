import { Effect, Schema as S } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Command } from "foldkit";

import { requestError, responseFailure } from "../../api";
import { FailedFetchRepositories, SucceededFetchRepositories } from "./message";
import { RepositoryCatalog } from "./model";

export const FetchRepositories = Command.define("FetchRepositories", {
  messages: [SucceededFetchRepositories, FailedFetchRepositories],
  execute: Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(
      HttpClientRequest.get("/api/repositories"),
    );
    const data: unknown = yield* response.json;
    if (response.status < 200 || response.status >= 300) {
      return yield* responseFailure(data, "Could not discover repositories.");
    }
    return SucceededFetchRepositories({
      catalog: yield* S.decodeUnknownEffect(RepositoryCatalog)(data),
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        FailedFetchRepositories({
          error: requestError(error, "Could not discover repositories."),
        }),
      ),
    ),
  ),
});
