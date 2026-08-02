import { Option } from "effect";
import { Command, given, message, model, story } from "foldkit/story";
import { fromString } from "foldkit/url";
import { describe, expect, test } from "vitest";

import {
  ChangedUrl,
  CompletedNavigate,
  FailedFetchReview,
  GotSettingsMessage,
  ReviewFailed,
  ReviewMeta,
  SucceededFetchReview,
  ToggledSidebar,
} from "./domain";
import { sampleFiles, sampleMeta } from "./sample";
import { FetchReview, Navigate } from "./command";
import { init, update } from "./state";
import * as Settings from "./page/settings";
import { defaultHunkerSettings } from "./settings";

const urlOrThrow = (raw: string) =>
  Option.getOrThrowWith(
    fromString(raw),
    () => new Error(`Could not parse test URL: ${raw}`),
  );

const pendingHome = init(urlOrThrow("http://localhost/"))[0];
const home = update(
  pendingHome,
  GotSettingsMessage({
    message: Settings.SucceededFetchSettings({
      document: {
        settings: defaultHunkerSettings,
        configPath: "/tmp/hunker-story-settings.json",
      },
    }),
  }),
)[0];
const reviewUrl = "https://github.com/example/hunker-demo/pull/42";
const localReviewUrl =
  "http://localhost/example/hunker-demo/pull/42?semantic=off&inline=off&reviews=hide";
const reviewMeta = ReviewMeta.make({
  ...sampleMeta,
  repository: "example/hunker-demo",
  number: "42",
  url: reviewUrl,
});

describe("review update", () => {
  test("sidebar toggles remain pure local state transitions", () => {
    const collapsed = update(home, ToggledSidebar())[0];
    expect(collapsed.sidebarCollapsed).toBe(true);
    const expanded = update(collapsed, ToggledSidebar())[0];
    expect(expanded.sidebarCollapsed).toBe(false);
  });

  test("a review route loads and accepts the matching successful response", () => {
    story(
      update,
      given(home),
      message(ChangedUrl({ url: urlOrThrow(localReviewUrl) })),
      Command.expectExact(FetchReview),
      Command.resolve(
        FetchReview,
        SucceededFetchReview({
          requestedUrl: reviewUrl,
          meta: reviewMeta,
          files: sampleFiles,
        }),
      ),
      model((state) => {
        expect(state.phase._tag).toBe("Ready");
        expect(state.meta.url).toBe(reviewUrl);
        expect(state.files).toStrictEqual(sampleFiles);
      }),
      Command.resolve(Navigate, CompletedNavigate()),
    );
  });

  test("a review route surfaces the matching failed response", () => {
    story(
      update,
      given(home),
      message(ChangedUrl({ url: urlOrThrow(localReviewUrl) })),
      Command.resolve(
        FetchReview,
        FailedFetchReview({
          requestedUrl: reviewUrl,
          error: "GitHub was unavailable",
        }),
      ),
      model((state) => {
        expect(state.phase).toStrictEqual(
          ReviewFailed({ error: "GitHub was unavailable" }),
        );
      }),
    );
  });
});
