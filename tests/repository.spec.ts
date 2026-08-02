import { expect, test } from "@playwright/test";
import { Schema as S } from "effect";

import {
  localRepositoryUrl,
  repositoryOptionsFromSearch,
  repositoryRouteFromPathname,
} from "../src/page/repository";
import { HunkerSettings } from "../src/settings";
import { settingsResponse } from "./fixtures";

const settingsWrite = S.Struct({ settings: HunkerSettings });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/settings", (route) => {
    const body: unknown = route.request().postDataJSON();
    const decoded =
      body === null ? undefined : S.decodeUnknownSync(settingsWrite)(body);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json:
        decoded === undefined
          ? settingsResponse
          : { ...settingsResponse, settings: decoded.settings },
    });
  });
});

const repository = "example/hunker-demo";
const files = [
  { path: "src/greet.ts", size: 143, gitStatus: "clean" },
  { path: "src/message.ts", size: 82, gitStatus: "clean" },
  { path: "README.md", size: 512, gitStatus: "clean" },
];

test("round-trips repository routes and browser options", () => {
  expect(repositoryRouteFromPathname("/radarlabs/server")).toEqual({
    owner: "radarlabs",
    name: "server",
  });
  expect(repositoryRouteFromPathname("/repo/radarlabs/server")).toEqual({
    owner: "radarlabs",
    name: "server",
  });
  expect(repositoryRouteFromPathname("/radarlabs/server/commits/main")).toEqual(
    {
      owner: "radarlabs",
      name: "server",
    },
  );
  expect(repositoryRouteFromPathname("/repo/%E0%A4%A/server")).toBeUndefined();
  expect(
    localRepositoryUrl(
      { owner: "radarlabs", name: "server" },
      {
        query: "config key",
        searchMode: "regex",
        file: "src/config.ts",
        tab: "files",
      },
    ),
  ).toBe("/radarlabs/server/blob/HEAD/src/config.ts?q=config+key&search=regex");
  expect(
    repositoryOptionsFromSearch("?q=config+key&file=src%2Fconfig.ts"),
  ).toEqual({
    query: "config key",
    searchMode: "literal",
    file: "src/config.ts",
    tab: "files",
  });
  expect(repositoryOptionsFromSearch("?view=commits").tab).toBe("commits");
  expect(repositoryOptionsFromSearch("?search=fuzzy").searchMode).toBe("fuzzy");
});

test("offers a temporary or configured clone when a repository is missing", async ({
  page,
}) => {
  let fileRequests = 0;
  await page.route("**/api/repository/files?**", (route) => {
    fileRequests += 1;
    return fileRequests === 1
      ? route.fulfill({
          status: 404,
          contentType: "application/json",
          json: { error: "Local repository not found." },
        })
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          json: { files },
        });
  });
  await page.route("**/api/repository/clone", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      repository,
      destination: "temporary",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { path: "/tmp/hunker/repositories/example/hunker-demo" },
    });
  });

  await page.goto("/example/hunker-demo");
  await expect(
    page.getByRole("heading", {
      name: "Clone this repository for local browsing",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clone to /tmp" }).click();
  await expect(page.locator(".repository-file-row")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Expand src", exact: true }),
  ).toBeVisible();
  expect(fileRequests).toBe(2);
});

test("opens repository links without accepting a late response from the previous repo", async ({
  page,
}) => {
  const firstGate = Promise.withResolvers<void>();
  await page.route("**/api/repository/files?**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const requested = requestUrl.searchParams.get("repository");
    if (requested === "example/first") await firstGate.promise;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        files: [
          {
            path: requested === "example/first" ? "first.ts" : "second.ts",
            size: 10,
            gitStatus: "clean",
          },
        ],
      },
    });
  });

  await page.goto("/example/first");
  await page
    .getByPlaceholder("Paste any GitHub URL")
    .fill("https://github.com/example/second");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL("/example/second");
  await expect(page.locator(".repository-file-row")).toContainText("second.ts");

  firstGate.resolve();
  await expect(page.locator(".repository-file-row")).toContainText("second.ts");
  await expect(page.locator(".repository-file-row")).not.toContainText(
    "first.ts",
  );
});

test("lists local repository commits and links them to commit review", async ({
  page,
}) => {
  await page.route("**/api/repository/files?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { files },
    }),
  );
  await page.route("**/api/repository/commits?**", (route) => {
    expect(new URL(route.request().url()).searchParams.get("repository")).toBe(
      repository,
    );
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        ref: "main",
        shallow: false,
        commits: [
          {
            sha: "abcdef1234567890abcdef1234567890abcdef12",
            parents: ["1234567890abcdef1234567890abcdef12345678"],
            authorName: "Octo Cat",
            authorEmail: "octo@example.com",
            authoredAt: "2026-08-02T12:00:00Z",
            subject: "Add repository commit history",
          },
        ],
      },
    });
  });

  await page.goto("/example/hunker-demo");
  await page.getByRole("button", { name: "Commits", exact: true }).click();
  await expect(page).toHaveURL("/example/hunker-demo/commits");
  const commit = page.getByRole("link", {
    name: /Add repository commit history/,
  });
  await expect(commit).toContainText("abcdef1");
  await expect(commit).toHaveAttribute(
    "href",
    "/example/hunker-demo/commit/abcdef1234567890abcdef1234567890abcdef12",
  );
  await expect(page.getByText("On main")).toBeVisible();
});

test("uses literal search by default and keeps FFF as an explicit mode", async ({
  page,
}) => {
  const searchModes: Array<string | null> = [];
  await page.route("**/api/repository/files?**", (route) => {
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get("repository")).toBe(repository);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { files },
    });
  });
  await page.route("**/api/repository/search?**", (route) => {
    searchModes.push(new URL(route.request().url()).searchParams.get("mode"));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        files: [files[0]],
        matches: [
          {
            path: "src/greet.ts",
            line: 3,
            column: 9,
            lineContent: "  return `hello ${person}`;",
            contextBefore: [
              "export function greet(person: string) {",
              "  const prefix = 'hello';",
            ],
            contextAfter: ["}", ""],
            ranges: [[10, 15]],
            definition: false,
          },
        ],
      },
    });
  });
  await page.route("**/api/repository/file?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        path: "src/greet.ts",
        content:
          "export function greet(person: string) {\n  return `hello ${person}`;\n}\n",
        truncated: false,
      },
    }),
  );

  await page.goto("/example/hunker-demo");
  await expect(
    page.getByRole("navigation", { name: "Repository files" }),
  ).not.toContainText("greet.ts");
  await expect(page.locator(".repository-file-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Expand src", exact: true }).click();
  await expect(page.locator(".repository-file-row")).toHaveCount(3);
  await page.getByRole("button", { name: "Collapse src", exact: true }).click();
  await expect(page.locator(".repository-file-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Expand src", exact: true }).click();
  await expect(page.locator(".repository-file-row")).toHaveCount(3);

  const mode = page.getByRole("combobox", {
    name: "Repository search mode",
  });
  await expect(mode).toHaveValue("literal");
  await mode.selectOption("fuzzy");

  await page
    .getByRole("searchbox", {
      name: "Search repository files and contents",
    })
    .fill("gret person");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("q") === "gret person" &&
      url.searchParams.get("search") === "fuzzy",
  );
  expect(searchModes).toEqual(["fuzzy"]);
  await expect(page.locator(".repository-filename-results")).toContainText(
    "src/greet.ts",
  );
  const match = page.locator(".repository-search-match");
  await expect(match).toContainText("export function greet");
  await expect(match).toContainText("const prefix");
  await expect(match).toContainText("return `hello ${person}`");
  await expect(match).toContainText("4");

  await match.click();
  await expect(page).toHaveURL(
    (url) => url.pathname === "/example/hunker-demo/blob/HEAD/src/greet.ts",
  );
  await expect(page.locator(".repository-file-view")).toContainText(
    "src/greet.ts",
  );
  await expect(
    page.locator(".repository-source .hljs-keyword").first(),
  ).toHaveText("export");

  await page.getByRole("button", { name: "← Search results" }).click();
  await expect(page.locator(".repository-search-match")).toBeVisible();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("q") === "gret person" &&
      url.pathname === "/example/hunker-demo",
  );
});
