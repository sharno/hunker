import { expect, test, type Page } from "@playwright/test";

const settings = {
  repositoriesRoot: "/Users/example/src",
  cacheRoot: "/tmp/hunker/repositories",
  reviewScope: "file",
  viewMode: "split",
  ignoreWhitespace: true,
  semantic: true,
  inlineDiffMode: "token",
  syntaxHighlighting: true,
  sidebarCollapsed: false,
  showGitHubReviews: true,
};

const settingsDocument = {
  settings,
  configPath: "/tmp/hunker/settings.json",
};

const reviewUrl = "https://github.com/example/hunker/pull/42";
const headOid = "2222222222222222222222222222222222222222";
const longLine = `export const description = "${"long review text ".repeat(18)}";`;
const reviewResponse = {
  title: "Improve the greeting",
  repository: "example/hunker",
  number: "42",
  author: "agent",
  base: "main",
  head: "feature/greeting",
  url: reviewUrl,
  diff: `diff --git a/src/long.ts b/src/long.ts
index 1111111..2222222 100644
--- a/src/long.ts
+++ b/src/long.ts
@@ -1 +1 @@
-${longLine}
+export const description = "short review text";
diff --git a/src/other.ts b/src/other.ts
index 3333333..4444444 100644
--- a/src/other.ts
+++ b/src/other.ts
@@ -1 +1 @@
-export const other = false;
+export const other = true;
`,
  backing: {
    source: "github",
    baseOid: "1111111111111111111111111111111111111111",
    headOid,
    headRef: "feature/greeting",
    path: "",
  },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        settings: typeof settings;
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: { ...settingsDocument, settings: body.settings },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: settingsDocument,
    });
  });
});

test("serves Elm on history routes and keeps browser Back and Forward canonical", async ({
  page,
  request,
}) => {
  const response = await request.get("/example/hunker/commits");
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("Elm.Main.init");

  await page.route("**/api/repositories", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        configuredRoot: "/Users/example/src",
        temporaryRoot: "/tmp/hunker/repositories",
        repositories: [
          {
            owner: "example",
            name: "hunker",
            path: "/Users/example/src/hunker",
            source: "configured",
          },
          {
            owner: "effect-ts",
            name: "effect",
            path: "/tmp/hunker/repositories/effect-ts/effect",
            source: "temporary",
          },
        ],
      },
    }),
  );
  await mockRepository(page);

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Repositories" }),
  ).toBeVisible();
  await expect(page.locator(".app-bar")).toHaveCSS("position", "sticky");
  await page.getByLabel("Filter repositories").fill("effect");
  await expect(page.getByText("example/hunker", { exact: true })).toHaveCount(
    0,
  );
  await page.getByText("effect-ts/effect", { exact: true }).click();
  await expect(page).toHaveURL("/effect-ts/effect");
  await page.goBack();
  await expect(page).toHaveURL("/");
  await page.goForward();
  await expect(page).toHaveURL("/effect-ts/effect");
});

test("renders a nested repository tree and a deep-linked local file without header overflow", async ({
  page,
}) => {
  await mockRepository(page);
  await page.goto("/example/hunker/blob/HEAD/src/nested/greet.ts");

  await expect(page.getByRole("button", { name: /src/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /nested/ })).toBeVisible();
  await expect(page.locator(".repository-file-view")).toContainText(
    'export const greeting = "hello";',
  );
  const layout = await page.locator(".app-bar").evaluate((bar) => ({
    clientWidth: bar.clientWidth,
    scrollWidth: bar.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
});

test("shows loading instead of stale review data and preserves a single fetched revision across history", async ({
  page,
}) => {
  let resolveReview: (() => void) | undefined;
  const reviewGate = new Promise<void>((resolve) => {
    resolveReview = resolve;
  });
  let reviewRequests = 0;
  await page.route("**/api/diff?**", async (route) => {
    reviewRequests += 1;
    await reviewGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: reviewResponse,
    });
  });
  await mockReviewAnalysis(page);

  await page.goto("/example/hunker/pull/42/files/src/long.ts");
  await expect(page.locator(".review-loading")).toContainText(
    "Loading the latest change",
  );
  await expect(page.locator(".diff-panel")).toHaveCount(0);
  resolveReview?.();
  await expect(
    page.getByRole("heading", { name: "Improve the greeting" }),
  ).toBeVisible();

  const lineLayout = await page
    .locator(".split-row")
    .first()
    .evaluate((row) => {
      const left = row.querySelector<HTMLElement>(".split-cell.left");
      const right = row.querySelector<HTMLElement>(".split-cell.right");
      const code = left?.querySelector<HTMLElement>(".line-code");
      if (!left || !right || !code)
        throw new Error("Expected a split diff row");
      return {
        leftHeight: left.getBoundingClientRect().height,
        rightHeight: right.getBoundingClientRect().height,
        codeClientWidth: code.clientWidth,
        codeScrollWidth: code.scrollWidth,
        overflowWrap: getComputedStyle(code).overflowWrap,
        whiteSpace: getComputedStyle(code).whiteSpace,
      };
    });
  expect(lineLayout.leftHeight).toBeGreaterThan(24);
  expect(lineLayout.leftHeight).toBe(lineLayout.rightHeight);
  expect(lineLayout.codeScrollWidth).toBeLessThanOrEqual(
    lineLayout.codeClientWidth + 1,
  );
  expect(lineLayout.overflowWrap).toBe("anywhere");
  expect(lineLayout.whiteSpace).toBe("break-spaces");

  await page
    .locator(".file-sidebar")
    .getByRole("button", { name: /other\.ts/ })
    .click();
  await expect(page).toHaveURL("/example/hunker/pull/42/files/src/other.ts");
  await page.goBack();
  await expect(page).toHaveURL("/example/hunker/pull/42/files/src/long.ts");
  await page.goForward();
  await expect(page).toHaveURL("/example/hunker/pull/42/files/src/other.ts");
  expect(reviewRequests).toBe(1);
});

test("posts an inline line comment through the real browser Fetch transport", async ({
  page,
}) => {
  await page.route("**/api/diff?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: reviewResponse,
    }),
  );
  await mockReviewAnalysis(page);
  let postedBody: unknown;
  await page.route("**/api/reviews/comment", async (route) => {
    postedBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        comment: {
          id: 91,
          rootId: 91,
          path: "src/long.ts",
          body: "Please keep this concise.",
          author: "reviewer",
          htmlUrl: `${reviewUrl}#discussion_r91`,
          createdAt: "2026-08-07T12:00:00Z",
          line: 1,
          side: "RIGHT",
          resolved: false,
        },
      },
    });
  });

  await page.goto("/example/hunker/pull/42/files/src/long.ts");
  await page.locator(".split-cell.right .comment-trigger").first().click();
  await page
    .getByPlaceholder("Leave a review comment on GitHub…")
    .fill("Please keep this concise.");
  await page.getByRole("button", { name: "Add comment" }).click();

  expect(postedBody).toEqual({
    pullUrl: reviewUrl,
    commitId: headOid,
    path: "src/long.ts",
    line: 1,
    side: "RIGHT",
    body: "Please keep this concise.",
  });
  await expect(page.locator(".github-review-thread")).toContainText(
    "Please keep this concise.",
  );
});

async function mockRepository(page: Page) {
  await page.route("**/api/repository/files?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        files: [
          { path: "src/nested/greet.ts", size: 33, gitStatus: "clean" },
          { path: "README.md", size: 10, gitStatus: "clean" },
        ],
      },
    }),
  );
  await page.route("**/api/repository/file?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        path: "src/nested/greet.ts",
        content: 'export const greeting = "hello";\n',
        truncated: false,
      },
    }),
  );
  await page.route("**/api/repository/source-control?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        status: {
          path: "/Users/example/src/hunker",
          checkout: {
            _tag: "TrackingBranch",
            name: "main",
            oid: headOid,
            upstream: "origin/main",
            ahead: 0,
            behind: 0,
          },
          branches: [{ name: "main", local: true, remote: true }],
          changes: { staged: 0, unstaged: 0, untracked: 0 },
          remote: { _tag: "RemoteCurrent", checkedAt: 1 },
        },
      },
    }),
  );
}

async function mockReviewAnalysis(page: Page) {
  await page.route("**/api/semantic?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        _tag: "Unsupported",
        path: new URL(route.request().url()).searchParams.get("path"),
        reason: "Fixture uses patch fallback.",
      },
    }),
  );
  await page.route("**/api/characters?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        path: new URL(route.request().url()).searchParams.get("path"),
        ignoreWhitespace: true,
        mode: "token",
        rows: [],
      },
    }),
  );
  await page.route("**/api/moves?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { moves: [] },
    }),
  );
  await page.route("**/api/reviews?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { comments: [] },
    }),
  );
  await page.route("**/api/commits?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { commits: [] },
    }),
  );
  await page.route("**/api/revision?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { source: "github" },
    }),
  );
}
