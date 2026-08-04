import { Effect, Schema as S } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Command } from "foldkit";

import { provideBrowserHttp, requestError, responseFailure } from "../../api";
import { HunkerSettings, SettingsDocument } from "../../settings";
import {
  FailedFetchSettings,
  FailedSaveSettings,
  SucceededFetchSettings,
  SucceededSaveSettings,
} from "./message";

export const FetchSettings = Command.define("FetchSettings", {
  messages: [SucceededFetchSettings, FailedFetchSettings],
  execute: Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(
      HttpClientRequest.get("/api/settings"),
    );
    const data: unknown = yield* response.json;
    if (response.status < 200 || response.status >= 300) {
      return yield* responseFailure(data, "Could not load Hunker settings.");
    }
    return SucceededFetchSettings({
      document: yield* S.decodeUnknownEffect(SettingsDocument)(data),
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        FailedFetchSettings({
          error: requestError(error, "Could not load Hunker settings."),
        }),
      ),
    ),
    provideBrowserHttp,
  ),
});

export const SaveSettings = Command.define("SaveSettings", {
  args: { settings: HunkerSettings },
  messages: [SucceededSaveSettings, FailedSaveSettings],
  execute: ({ settings }) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const response = yield* client.execute(
        HttpClientRequest.put("/api/settings").pipe(
          HttpClientRequest.bodyJsonUnsafe({ settings }),
        ),
      );
      const data: unknown = yield* response.json;
      if (response.status < 200 || response.status >= 300) {
        return yield* responseFailure(data, "Could not save Hunker settings.");
      }
      return SucceededSaveSettings({
        document: yield* S.decodeUnknownEffect(SettingsDocument)(data),
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          FailedSaveSettings({
            error: requestError(error, "Could not save Hunker settings."),
          }),
        ),
      ),
      provideBrowserHttp,
    ),
});
