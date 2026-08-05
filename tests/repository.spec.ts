import { expect, test } from "@playwright/test";

import {
  characterDiffResponse,
  commitDiffResponse,
  semanticResponse,
  settingsResponse,
} from "./fixtures";

const sourceControlStatus = (branch: string, behind: number) => ({
  path: "/tmp/hunker-demo",
  checkout: {
    _tag: "TrackingBranch",
    name: branch,
    oid: "2222222222222222222222222222222222222222",
    upstream: `origin/${branch}`,
    ahead: 0,
    behind,
  },
  branches: [
    { name: "main", local: true, remote: true },
    {
      name: "feature/source-control",
      local: branch === "feature/source-control",
      remote: true,
    },
  ],
  changes: { staged: 1, unstaged: 2, untracked: 3 },
  remote: { _tag: "RemoteCurrent", checkedAt: 1 },
});

test.beforeEach(async ({ page }) => {
  await page.route("**/api/repository/source-control?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { status: sourceControlStatus("main", 0) },
    }),
  );
});

test("keeps the active repository when an earlier browser request finishes late", async ({
  page,
}) => {
  await page.route("**/api/settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: settingsResponse,
    }),
  );
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
  await page.route("**/api/repository/file?**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.searchParams.get("path") ?? "unknown.ts";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        path,
        content: `export const source = "${path}";\n`,
        truncated: false,
      },
    });
  });

  await page.goto("/example/first");
  await page
    .getByPlaceholder("Paste any GitHub URL")
    .fill("https://github.com/example/second");
  await page.getByRole("button", { name: "Open", exact: true }).click();

  await expect(page).toHaveURL("/example/second");
  await expect(page.locator(".repository-toolbar")).toHaveCSS(
    "position",
    "sticky",
  );
  await expect(page.locator(".repository-view-tabs")).toHaveCSS(
    "background-color",
    "rgb(48, 59, 80)",
  );
  const searchModes = page.getByRole("group", { name: "Search mode" });
  await expect(searchModes).toHaveCSS("display", "flex");
  await expect(searchModes.getByRole("button")).toHaveCount(3);
  await expect(page.locator(".repository-search select")).toHaveCount(0);
  const locationForm = page.locator(".repository-github-loader");
  const locationInput = locationForm.getByLabel("GitHub URL");
  const locationSubmit = locationForm.getByRole("button", {
    name: "Open",
    exact: true,
  });
  await expect(locationForm).toHaveCSS("display", "grid");
  await expect(locationInput).toBeVisible();
  await expect(locationSubmit).toBeVisible();
  const formBox = await locationForm.boundingBox();
  const inputBox = await locationInput.boundingBox();
  const submitBox = await locationSubmit.boundingBox();
  if (formBox === null || inputBox === null || submitBox === null) {
    throw new Error("The repository toolbar controls must have layout boxes");
  }
  expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(submitBox.x);
  expect(submitBox.x + submitBox.width).toBeLessThanOrEqual(
    formBox.x + formBox.width,
  );
  await expect(page.locator(".repository-file-row")).toContainText("second.ts");

  await page.getByRole("button", { name: "second.ts" }).click();
  await expect(page).toHaveURL("/example/second/blob/HEAD/second.ts");
  await expect(page.locator(".repository-file-view")).toContainText(
    'export const source = "second.ts";',
  );
  await page.goBack();
  await expect(page).toHaveURL("/example/second");
  await expect(page.locator(".repository-file-view")).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL("/example/second/blob/HEAD/second.ts");
  await expect(page.locator(".repository-file-view")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL("/example/second");

  firstGate.resolve();
  await expect(page.locator(".repository-file-row")).toContainText("second.ts");
  await expect(page.locator(".repository-file-row")).not.toContainText(
    "first.ts",
  );
});

test("reopens the same cached commit review after browser Back", async ({
  page,
}) => {
  const commit = {
    sha: "2222222222222222222222222222222222222222",
    parents: ["1111111111111111111111111111111111111111"],
    authorName: "Review Agent",
    authorEmail: "review@example.com",
    authoredAt: "2026-07-31T15:30:00Z",
    subject: "Use a template literal",
  };
  await page.route("**/api/settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: settingsResponse,
    }),
  );
  await page.route("**/api/repository/commits?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { ref: "main", shallow: false, commits: [commit] },
    }),
  );
  await page.route("**/api/repository/files?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        files: [{ path: "src/greet.ts", size: 143, gitStatus: "clean" }],
      },
    }),
  );
  await page.route("**/api/diff?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: commitDiffResponse,
    }),
  );
  await page.route("**/api/semantic?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: semanticResponse,
    }),
  );
  await page.route("**/api/characters?**", (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.searchParams.get("path") ?? "";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: characterDiffResponse(path, true, "token"),
    });
  });

  await page.goto("/example/hunker-demo/commits");
  const commitLink = page.getByRole("link", {
    name: /Use a template literal/,
  });
  await expect(commitLink).toBeVisible();
  await commitLink.click();
  await expect(page).toHaveURL(`/example/hunker-demo/commit/${commit.sha}`);
  await expect(
    page.getByRole("heading", { name: commitDiffResponse.title }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL("/example/hunker-demo/commits");
  await expect(page).toHaveTitle("Hunker");
  await expect(commitLink).toBeVisible();
  await commitLink.click();
  await expect(page).toHaveURL(`/example/hunker-demo/commit/${commit.sha}`);
  await expect(
    page.getByRole("heading", { name: commitDiffResponse.title }),
  ).toBeVisible();
});

test("switches the working folder branch and shows a blocked pull", async ({
  page,
}) => {
  await page.route("**/api/settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: settingsResponse,
    }),
  );
  await page.route("**/api/repository/files?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        files: [{ path: "src/greet.ts", size: 143, gitStatus: "modified" }],
      },
    }),
  );
  await page.route("**/api/repository/source-control?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { status: sourceControlStatus("main", 2) },
    }),
  );
  await page.route("**/api/repository/branch", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      repository: "example/hunker-demo",
      branch: "feature/source-control",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        status: sourceControlStatus("feature/source-control", 1),
      },
    });
  });
  await page.route("**/api/repository/pull", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      json: {
        error: "Your staged changes would be overwritten by merge.",
      },
    }),
  );

  await page.goto("/example/hunker-demo");
  const branch = page.getByLabel("Checked-out repository branch");
  await expect(branch).toHaveValue("main");
  await expect(page.getByRole("button", { name: "Pull 2 ↓" })).toBeVisible();
  await expect(page.locator(".source-control-changes")).toContainText(
    "1 staged · 2 changed · 3 untracked",
  );

  await branch.selectOption("feature/source-control");
  await expect(branch).toHaveValue("feature/source-control");
  await page.getByRole("button", { name: "Pull 1 ↓" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Your staged changes would be overwritten by merge.",
  );
});
