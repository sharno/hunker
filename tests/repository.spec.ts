import { expect, test } from "@playwright/test";

import {
  localRepositoryUrl,
  repositoryOptionsFromSearch,
  repositoryRouteFromPathname,
} from "../src/features/repository";

const repository = "example/hunker-demo";
const files = [
  { path: "src/greet.ts", size: 143, gitStatus: "clean" },
  { path: "src/message.ts", size: 82, gitStatus: "clean" },
  { path: "README.md", size: 512, gitStatus: "clean" },
];

test("round-trips repository routes and browser options", () => {
  expect(repositoryRouteFromPathname("/repo/radarlabs/server")).toEqual({
    owner: "radarlabs",
    name: "server",
  });
  expect(repositoryRouteFromPathname("/repo/%E0%A4%A/server")).toBeUndefined();
  expect(
    localRepositoryUrl(
      { owner: "radarlabs", name: "server" },
      { query: "config key", file: "src/config.ts" },
    ),
  ).toBe("/repo/radarlabs/server?q=config+key&file=src%2Fconfig.ts");
  expect(repositoryOptionsFromSearch("?q=config+key&file=src%2Fconfig.ts")).toEqual({
    query: "config key",
    file: "src/config.ts",
  });
});

test("browses local files and shows fuzzy content results with context", async ({ page }) => {
  await page.route("**/api/repository/files?**", route => {
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get("repository")).toBe(repository);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { files },
    });
  });
  await page.route("**/api/repository/search?**", route =>
    route.fulfill({
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
    }),
  );
  await page.route("**/api/repository/file?**", route =>
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

  await page.goto("/repo/example/hunker-demo");
  await expect(page.getByRole("navigation", { name: "Repository files" })).toContainText(
    "src/greet.ts",
  );
  await expect(page.locator(".repository-file-row")).toHaveCount(3);

  await page.getByRole("searchbox", {
    name: "Search repository files and contents",
  }).fill("gret person");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(url => url.searchParams.get("q") === "gret person");
  await expect(page.locator(".repository-filename-results")).toContainText(
    "src/greet.ts",
  );
  const match = page.locator(".repository-search-match");
  await expect(match).toContainText("export function greet");
  await expect(match).toContainText("const prefix");
  await expect(match).toContainText("return `hello ${person}`");
  await expect(match).toContainText("4");

  await match.click();
  await expect(page).toHaveURL(url => url.searchParams.get("file") === "src/greet.ts");
  await expect(page.locator(".repository-file-view")).toContainText("src/greet.ts");
  await expect(page.locator(".repository-source .hljs-keyword").first()).toHaveText(
    "export",
  );

  await page.getByRole("button", { name: "← Search results" }).click();
  await expect(page.locator(".repository-search-match")).toBeVisible();
  await expect(page).toHaveURL(url =>
    url.searchParams.get("q") === "gret person" &&
    url.searchParams.get("file") === null,
  );
});
