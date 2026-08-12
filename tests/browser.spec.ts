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
  diffColors: true,
  sidebarCollapsed: false,
  showGitHubReviews: true,
  topBarCollapsed: false,
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
  files: [
    {
      path: "src/long.ts",
      previousPath: null,
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: `@@ -1 +1 @@\n-${longLine}\n+export const description = "short review text";`,
    },
    {
      path: "src/other.ts",
      previousPath: null,
      status: "modified",
      additions: 1,
      deletions: 1,
      patch:
        "@@ -1 +1 @@\n-export const other = false;\n+export const other = true;",
    },
  ],
  backing: {
    _tag: "GitHub",
    baseOid: "1111111111111111111111111111111111111111",
    headOid,
    headRef: "feature/greeting",
    path: "",
  },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PUT") {
      const payload: { settings: typeof settings } = route
        .request()
        .postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          settings: payload.settings,
          configPath: settingsDocument.configPath,
        },
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
    page.getByRole("heading", { name: "Repositories", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".app-bar")).toHaveCSS("position", "sticky");
  await page.getByLabel("Filter repositories").fill("effect");
  await expect(page.getByText("example/hunker", { exact: true })).toHaveCount(
    0,
  );
  await page.getByText("effect-ts/effect", { exact: true }).click();
  await expect(page).toHaveURL("/effect-ts/effect/tree/main");
  await page.goBack();
  await expect(page).toHaveURL("/");
  await page.goForward();
  await expect(page).toHaveURL("/effect-ts/effect/tree/main");
});

test("renders a nested repository tree and a deep-linked local file without header overflow", async ({
  page,
}) => {
  await mockRepository(page);
  await page.goto("/example/hunker/blob/HEAD/src/nested/greet.ts");

  await expect(page.getByRole("button", { name: /src/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /nested/ })).toBeVisible();
  await expect(page.locator(".repository-file-view")).toContainText(
    "export function greeting() {",
  );
  await expect(
    page.locator(".repository-file-view .syntax-keyword").first(),
  ).toHaveText("export");
  await expect(page.locator(".repository-file-view .source-line")).toHaveCount(
    5,
  );
  await page.getByTitle("Collapse greeting").click();
  await expect(page.locator(".repository-file-view .source-line")).toHaveCount(
    2,
  );
  await expect(page.locator(".source-fold-summary")).toHaveText(" … 3 lines");
  await page.getByTitle("Expand greeting").click();
  await expect(page.locator(".repository-file-view .source-line")).toHaveCount(
    5,
  );
  const layout = await page.locator(".app-bar").evaluate((bar) => ({
    clientWidth: bar.clientWidth,
    scrollWidth: bar.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);

  const sourceLineLayout = await page
    .locator(".source-line")
    .first()
    .evaluate((row) => {
      const number = row.querySelector<HTMLElement>(".line-number");
      const code = row.querySelector<HTMLElement>(".line-code");
      if (!number || !code)
        throw new Error("Expected a source gutter and code cell");
      const rowRect = row.getBoundingClientRect();
      const numberRect = number.getBoundingClientRect();
      const codeRect = code.getBoundingClientRect();
      return {
        display: getComputedStyle(row).display,
        rowHeight: rowRect.height,
        numberTop: numberRect.top,
        numberRight: numberRect.right,
        codeTop: codeRect.top,
        codeLeft: codeRect.left,
      };
    });
  expect(sourceLineLayout.display).toBe("grid");
  expect(
    Math.abs(sourceLineLayout.numberTop - sourceLineLayout.codeTop),
  ).toBeLessThan(1);
  expect(sourceLineLayout.codeLeft).toBeGreaterThanOrEqual(
    sourceLineLayout.numberRight - 1,
  );
  expect(sourceLineLayout.rowHeight).toBeLessThan(32);
});

test("keeps repository commit rows compact and aligned", async ({ page }) => {
  await mockRepository(page);
  await page.goto("/example/hunker/commits");

  const rows = page.locator(".repository-commit-row");
  await expect(rows).toHaveCount(2);
  const layout = await rows.first().evaluate((row) => {
    const avatar = row.querySelector<HTMLElement>(".commit-avatar");
    const copy = row.querySelector<HTMLElement>(".commit-copy");
    const action = row.querySelector<HTMLElement>(".commit-action");
    if (!avatar || !copy || !action)
      throw new Error("Expected all repository commit cells");
    const rowRect = row.getBoundingClientRect();
    const avatarRect = avatar.getBoundingClientRect();
    const copyRect = copy.getBoundingClientRect();
    const actionRect = action.getBoundingClientRect();
    return {
      height: rowRect.height,
      avatarCenter: avatarRect.top + avatarRect.height / 2,
      copyCenter: copyRect.top + copyRect.height / 2,
      actionCenter: actionRect.top + actionRect.height / 2,
    };
  });
  expect(layout.height).toBeLessThan(72);
  expect(Math.abs(layout.avatarCenter - layout.copyCenter)).toBeLessThan(2);
  expect(Math.abs(layout.actionCenter - layout.copyCenter)).toBeLessThan(2);
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
  await expect(
    page.locator(".split-cell.right .syntax-keyword.inline-change"),
  ).toHaveText("export");

  const changedToken = page.locator(
    ".split-cell.right .syntax-keyword.inline-change",
  );
  const additionCell = page.locator(".split-cell.right.addition").first();
  const coloredBackground = await additionCell.evaluate(
    (cell) => getComputedStyle(cell).backgroundColor,
  );
  expect(coloredBackground).not.toBe("rgba(0, 0, 0, 0)");
  await page.getByText("Diff colors", { exact: true }).click();
  await expect(page.locator(".review-diffs")).toHaveClass(
    /diff-colors-disabled/,
  );
  await expect
    .poll(() =>
      additionCell.evaluate((cell) => getComputedStyle(cell).backgroundColor),
    )
    .toBe("rgba(0, 0, 0, 0)");
  await expect(changedToken).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(changedToken).toHaveCSS("box-shadow", "none");
  await expect(changedToken).toHaveClass(/syntax-keyword/);

  const toolbar = page.locator(".compact-review-toolbar");
  await page
    .locator(".diff-panel")
    .first()
    .evaluate((panel) => {
      document.documentElement.dataset.filePanelMutations = "0";
      new MutationObserver((mutations) => {
        const current = Number(
          document.documentElement.dataset.filePanelMutations ?? "0",
        );
        document.documentElement.dataset.filePanelMutations = String(
          current + mutations.length,
        );
      }).observe(panel, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
    });
  await page.getByRole("button", { name: "Hide top bar" }).click();
  await expect(page.locator(".app-bar")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Show top bar" }),
  ).toBeVisible();
  await expect(toolbar).toHaveCSS("top", "0px");
  expect(
    await page.evaluate(() =>
      Number(document.documentElement.dataset.filePanelMutations ?? "0"),
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "Show top bar" }).click();
  await expect(page.locator(".app-bar")).toBeVisible();
  await expect(toolbar).toHaveCSS("top", "64px");

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

  const sidebarHeaderLayout = await page
    .locator(".file-sidebar")
    .evaluate((sidebar) => {
      const count = sidebar.querySelector<HTMLElement>(".count-badge");
      const toggle = sidebar.querySelector<HTMLElement>(".sidebar-toggle");
      if (!count || !toggle)
        throw new Error("Expected sidebar count and collapse control");
      return {
        countRight: count.getBoundingClientRect().right,
        toggleLeft: toggle.getBoundingClientRect().left,
      };
    });
  expect(sidebarHeaderLayout.countRight).toBeLessThanOrEqual(
    sidebarHeaderLayout.toggleLeft,
  );

  await page.getByLabel("Diff scope").selectOption("full");
  await expect(page.locator(".review-diffs.full-diff .diff-panel")).toHaveCount(
    2,
  );
  const toolbarHeight = await toolbar.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  await page.evaluate(() => {
    document.body.style.minHeight = "3000px";
    window.scrollTo(0, 1200);
  });
  await page.waitForTimeout(300);
  await expect(toolbar).toHaveCSS("height", `${toolbarHeight}px`);
  await expect(toolbar).not.toHaveClass(/is-compact|is-expanded/);

  await page
    .locator(".file-sidebar")
    .getByRole("button", { name: /other\.ts/ })
    .click();
  await expect(page).toHaveURL("/example/hunker/pull/42/files/src/other.ts");
  await expect
    .poll(async () => {
      const target = await page.locator("#file-src-other-ts").boundingBox();
      const stickyToolbar = await toolbar.boundingBox();
      if (!target || !stickyToolbar) return Number.POSITIVE_INFINITY;
      return Math.abs(target.y - (stickyToolbar.y + stickyToolbar.height + 12));
    })
    .toBeLessThan(20);
  await page.goBack();
  await expect(page).toHaveURL("/example/hunker/pull/42/files/src/long.ts");
  await page.goForward();
  await expect(page).toHaveURL("/example/hunker/pull/42/files/src/other.ts");
  expect(reviewRequests).toBe(1);
});

test("does not poll mutable revision state for an immutable commit", async ({
  page,
}) => {
  const sha = "2222222222222222222222222222222222222222";
  let revisionRequests = 0;
  let analysisRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/analysis")
      analysisRequests += 1;
  });
  await page.route("**/api/diff?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: reviewResponse,
    }),
  );
  await mockReviewAnalysis(page);
  await page.route("**/api/revision?**", (route) => {
    revisionRequests += 1;
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      json: {
        code: "bad_request",
        message: "Immutable commits do not have a latest revision.",
        retryable: false,
      },
    });
  });

  await page.goto(`/example/hunker/commit/${sha}`);
  await expect(
    page.getByRole("heading", { name: "Improve the greeting" }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    `/example/hunker/commit/${sha}?file=src%2Flong.ts`,
  );
  await page.waitForTimeout(300);
  expect(revisionRequests).toBe(0);
  expect(analysisRequests).toBe(1);
  await expect(page.locator(".revision-notice")).toHaveCount(0);
});

test("keeps the review file list sticky with its own scrollbar", async ({
  page,
}) => {
  const files = Array.from({ length: 80 }, (_, index) => ({
    path: `src/feature-${String(index).padStart(2, "0")}/file.ts`,
    previousPath: null,
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: `@@ -1 +1 @@\n-export const value = ${index};\n+export const value = ${index + 1};`,
  }));
  await page.route("**/api/diff?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { ...reviewResponse, files },
    }),
  );
  await mockReviewAnalysis(page);
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/example/hunker/pull/42/files/src/feature-00/file.ts");
  await expect(page.locator(".file-sidebar-tree")).toBeVisible();
  await page.locator(".review-diffs").evaluate((diffs) => {
    diffs.style.minHeight = "3000px";
  });
  await expect
    .poll(async () =>
      page.locator(".file-sidebar").evaluate((sidebar) => {
        const bounds = sidebar.getBoundingClientRect();
        return Math.ceil(bounds.bottom - window.innerHeight);
      }),
    )
    .toBeLessThanOrEqual(0);
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect
    .poll(async () => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(600);

  const layout = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>(".file-sidebar");
    const tree = document.querySelector<HTMLElement>(".file-sidebar-tree");
    const toolbar = document.querySelector<HTMLElement>(
      ".compact-review-toolbar",
    );
    if (!sidebar || !tree || !toolbar)
      throw new Error("Expected review sidebar and toolbar");
    const sidebarRect = sidebar.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    const windowScrollBefore = window.scrollY;
    tree.scrollTop = tree.scrollHeight;
    return {
      sidebarTop: sidebarRect.top,
      sidebarBottom: sidebarRect.bottom,
      toolbarBottom: toolbarRect.bottom,
      viewportHeight: window.innerHeight,
      overflowY: getComputedStyle(tree).overflowY,
      treeScrollTop: tree.scrollTop,
      treeScrollHeight: tree.scrollHeight,
      treeClientHeight: tree.clientHeight,
      windowScrollBefore,
      windowScrollAfter: window.scrollY,
    };
  });

  expect(Math.abs(layout.sidebarTop - layout.toolbarBottom)).toBeLessThan(2);
  expect(layout.sidebarBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.overflowY).toBe("auto");
  expect(layout.treeScrollHeight).toBeGreaterThan(layout.treeClientHeight);
  expect(layout.treeScrollTop).toBeGreaterThan(0);
  expect(layout.windowScrollAfter).toBe(layout.windowScrollBefore);
});

test("keeps every deferred diff line available to native browser Find", async ({
  page,
}) => {
  const lines = Array.from({ length: 480 }, (_, index) =>
    index === 479
      ? 'export const browserFindNeedle = "last deferred line";'
      : `export const generatedLine${index} = ${index};`,
  );
  await page.route("**/api/diff?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        ...reviewResponse,
        files: [
          {
            path: "src/generated.ts",
            previousPath: null,
            status: "added",
            additions: lines.length,
            deletions: 0,
            patch: `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`,
          },
        ],
      },
    }),
  );
  await mockReviewAnalysis(page);

  await page.goto("/example/hunker/pull/42/files/src/generated.ts");
  await expect(page.locator(".diff-line-chunk")).toHaveCount(3);
  await expect(page.locator(".diff-line-chunk").last()).toHaveCSS(
    "content-visibility",
    "auto",
  );
  const found = await page.evaluate(() => {
    const find = Reflect.get(window, "find");
    return (
      typeof find === "function" &&
      Reflect.apply(find, window, ["browserFindNeedle"]) === true
    );
  });
  expect(found).toBe(true);
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
        content:
          'export function greeting() {\n  const value = "hello";\n  return value;\n}\n',
        truncated: false,
        presentation: sourcePresentation(
          "TypeScript",
          [
            { line: 1, startCharacter: 0, endCharacter: 6, kind: "keyword" },
            { line: 1, startCharacter: 7, endCharacter: 15, kind: "keyword" },
            { line: 1, startCharacter: 16, endCharacter: 24, kind: "function" },
            { line: 2, startCharacter: 2, endCharacter: 7, kind: "keyword" },
            { line: 2, startCharacter: 16, endCharacter: 23, kind: "string" },
            { line: 3, startCharacter: 2, endCharacter: 8, kind: "keyword" },
          ],
          [
            {
              id: "function:1:4:greeting",
              kind: "function",
              label: "greeting",
              startLine: 1,
              endLine: 4,
            },
          ],
        ),
      },
    }),
  );
  await page.route("**/api/repository/commits?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        ref: "main",
        shallow: false,
        commits: [
          {
            sha: "1111111111111111111111111111111111111111",
            parents: [],
            authorName: "Mohamed Elsharnouby",
            authorEmail: "mohamed@example.com",
            authoredAt: "2026-08-07T12:00:00-04:00",
            subject: "Keep repository commit rows compact",
          },
          {
            sha: "2222222222222222222222222222222222222222",
            parents: ["1111111111111111111111111111111111111111"],
            authorName: "Hunker Agent",
            authorEmail: "agent@example.com",
            authoredAt: "2026-08-07T11:00:00-04:00",
            subject: "Add repository commit view",
          },
        ],
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
  await page.route("**/api/analysis?**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    const file = (path: string) => ({
      path,
      semantic: {
        _tag: "Skipped",
        reason: "Fixture uses patch fallback.",
      },
      syntax: {
        _tag: "Complete",
        value: {
          old: sourcePresentation("TypeScript", []),
          new: sourcePresentation("TypeScript", [
            {
              line: 1,
              startCharacter: 0,
              endCharacter: 6,
              kind: "keyword",
            },
          ]),
        },
      },
      wordDiff: {
        path,
        ignoreWhitespace: query.get("whitespace") === "ignore",
        mode: query.get("mode"),
        rows:
          path === "src/long.ts"
            ? [
                {
                  oldLine: 1,
                  newLine: 1,
                  oldRanges: [],
                  newRanges: [{ start: 0, end: 6 }],
                },
              ]
            : [],
      },
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        key: {
          repository: "example/hunker",
          baseOid: query.get("baseOid"),
          headOid: query.get("headOid"),
          options: {
            ignoreWhitespace: query.get("whitespace") === "ignore",
            semantic: query.get("semantic") === "true",
            syntax: query.get("syntax") === "true",
            inlineDiff: query.get("mode"),
          },
        },
        files: [file("src/long.ts"), file("src/other.ts")],
        moves: [],
      },
    });
  });
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

function sourcePresentation(
  language: string,
  highlights: Array<{
    line: number;
    startCharacter: number;
    endCharacter: number;
    kind: string;
  }>,
  folds: Array<{
    id: string;
    kind: string;
    label: string;
    startLine: number;
    endLine: number;
  }> = [],
) {
  return {
    _tag: "Complete",
    value: { language, highlights, folds },
  };
}
