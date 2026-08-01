import { expect, test } from "@playwright/test";

import {
  githubUrlFromPathname,
  localPathFromGitHubUrl,
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
