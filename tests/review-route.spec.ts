import { expect, test } from "@playwright/test";

import {
  defaultReviewOptions,
  githubUrlFromPathname,
  localReviewUrl,
  localPathFromGitHubUrl,
  reviewOptionsFromSearch,
  reviewRouteFromPathname,
} from "../src/review-route";

test("round-trips pull and compare review routes", () => {
  expect(reviewRouteFromPathname("/radarlabs/server/pull/7848")).toEqual({
    _tag: "Pull",
    owner: "radarlabs",
    repository: "server",
    number: "7848",
  });
  expect(githubUrlFromPathname("/radarlabs/server/pull/7848")).toBe(
    "https://github.com/radarlabs/server/pull/7848",
  );
  expect(localPathFromGitHubUrl("https://github.com/radarlabs/server/pull/7848")).toBe(
    "/radarlabs/server/pull/7848",
  );
  expect(
    localPathFromGitHubUrl("https://github.com/radarlabs/server/compare/main...feature"),
  ).toBe("/radarlabs/server/compare/main...feature");
});

test("round-trips a complete review configuration through the query string", () => {
  const options = {
    reviewScope: "full",
    viewMode: "unified",
    ignoreWhitespace: false,
    semantic: false,
    characterDiff: false,
    sidebarCollapsed: true,
    showGitHubReviews: false,
    selectedPath: "src/message with spaces.ts",
  } as const;
  const href = localReviewUrl(
    "https://github.com/example/hunker-demo/pull/42",
    options,
  );

  expect(href).toBe(
    "/example/hunker-demo/pull/42?scope=full&view=unified&whitespace=show&semantic=off&characters=off&sidebar=collapsed&reviews=hide&file=src%2Fmessage+with+spaces.ts",
  );
  expect(reviewOptionsFromSearch(new URL(href!, "http://hunker.local").search)).toEqual(
    options,
  );
});

test("uses defaults for absent or invalid review options", () => {
  expect(reviewOptionsFromSearch("?scope=wat&semantic=maybe&sidebar=nope")).toEqual(
    defaultReviewOptions,
  );
});
