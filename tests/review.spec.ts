import { expect, test } from "@playwright/test";

import {
  commitDiffResponse,
  commitsResponse,
  movesResponse,
  characterDiffResponse,
  reviewCommentsResponse,
  reviewResponse,
  reviewUrl,
  semanticResponse,
} from "./fixtures";

const classToken = (token: string) => new RegExp(`(?:^|\\s)${token}(?:\\s|$)`);

test.beforeEach(async ({ page }) => {
  await page.route("**/api/characters?**", route => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.searchParams.get("path") ?? "";
    const mode = requestUrl.searchParams.get("mode") === "character"
      ? "character"
      : "token";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: characterDiffResponse(
        path,
        requestUrl.searchParams.get("whitespace") === "ignore",
        mode,
      ),
    });
  });
});

test("loads a PR and renders ast-grep intelligence in both review layouts", async ({ page }) => {
  await page.route("**/api/diff?**", route =>
    route.fulfill({ status: 200, contentType: "application/json", json: reviewResponse }),
  );
  await page.route("**/api/semantic?**", async route => {
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: semanticResponse,
    });
  });
  await page.route("**/api/moves?**", route =>
    route.fulfill({ status: 200, contentType: "application/json", json: movesResponse }),
  );
  await page.route("**/api/reviews?**", route =>
    route.fulfill({ status: 200, contentType: "application/json", json: { comments: [] } }),
  );

  await page.goto("/");
  await page.getByRole("button", { name: "Collapse file sidebar" }).click();
  await expect(page.locator(".workspace")).toHaveClass(classToken("sidebar-collapsed"));
  await expect(page.getByRole("navigation", { name: "Changed files" })).toBeHidden();
  await page.getByRole("button", { name: "Expand file sidebar" }).click();
  await expect(page.locator(".workspace")).not.toHaveClass(classToken("sidebar-collapsed"));
  await page.getByPlaceholder("Paste a GitHub PR or compare URL").fill(reviewUrl);
  await page.getByRole("button", { name: "Review", exact: true }).click();

  await expect(page).toHaveURL(url =>
    url.pathname === "/example/hunker-demo/pull/42" &&
    url.searchParams.get("scope") === "file" &&
    url.searchParams.get("view") === "split" &&
    url.searchParams.get("file") === "src/greet.ts",
  );
  await expect(page.getByRole("heading", { name: reviewResponse.title })).toBeVisible();
  await expect(page.locator(".semantic-banner")).toContainText(
    "ast-grep is analyzing this file",
  );
  await expect(page.locator(".semantic-banner")).toHaveCount(0);
  await expect(page.locator(".semantic-engine-badge")).toHaveText(
    "ast-grep · TypeScript",
  );
  await expect(page.locator(".semantic-findings")).toContainText(
    "Updated function declaration greet",
  );
  await expect(page.locator(".split-lines")).toBeVisible();
  await expect(page.locator(".split-lines .char-change")).not.toHaveCount(0);
  await expect(page.locator(".split-lines .hljs-keyword")).not.toHaveCount(0);
  await expect(page.locator(".line-semantic")).not.toHaveCount(0);

  await page.locator(".toolbar-options > .toolbar-menu-button").click();
  const tokenMode = page.getByRole("button", { name: "Token", exact: true });
  const characterMode = page.getByRole("button", { name: "Character", exact: true });
  await expect(tokenMode).toHaveClass(classToken("is-active"));
  await characterMode.click();
  await expect(characterMode).toHaveClass(classToken("is-active"));
  await expect(page).toHaveURL(url => url.searchParams.get("inline") === "character");
  await tokenMode.click();
  await expect(page).toHaveURL(url => url.searchParams.get("inline") === "token");
  const syntaxToggle = page.getByRole("button", { name: "Syntax", exact: true });
  await syntaxToggle.click();
  await expect(page.locator('.diff-lines [class*="hljs-"]')).toHaveCount(0);
  await expect(page).toHaveURL(url => url.searchParams.get("syntax") === "off");
  await syntaxToggle.click();
  await expect(page.locator(".split-lines .hljs-keyword")).not.toHaveCount(0);
  await expect(page).toHaveURL(url => url.searchParams.get("syntax") === "on");
  await page.getByRole("button", { name: "Close toolbar menu" }).click();
  await expect(page.locator(".toolbar-options-panel")).toHaveCount(0);

  await page.getByRole("button", { name: "Full diff", exact: true }).click();
  await expect(page.locator(".full-diff .diff-panel")).toHaveCount(2);
  await expect(page.locator(".movement-summary")).toContainText("1 moved code block");
  await expect(page.locator(".movement-summary")).toContainText("src/greet.ts:1");
  await expect(page.locator(".movement-summary")).toContainText("src/message.ts:1");
  await expect(page.locator(".line-move")).not.toHaveCount(0);

  await page.getByRole("button", { name: "Unified" }).click();
  await expect(page.locator(".unified-lines")).toHaveCount(2);
  await expect(page.locator(".unified-lines").first()).toContainText("hello ${person}");

  await page.getByRole("button", { name: "Semantic", exact: true }).click();
  await expect(page.locator(".semantic-banner")).toHaveCount(0);
  await expect(page.locator(".semantic-findings")).toHaveCount(0);
  await expect(page.locator(".unified-lines")).toHaveCount(2);
  await expect(page).toHaveURL(url =>
    url.pathname === "/example/hunker-demo/pull/42" &&
    url.searchParams.get("scope") === "full" &&
    url.searchParams.get("view") === "unified" &&
    url.searchParams.get("whitespace") === "ignore" &&
    url.searchParams.get("semantic") === "off" &&
    url.searchParams.get("inline") === "token" &&
    url.searchParams.get("syntax") === "on" &&
    url.searchParams.get("sidebar") === "expanded" &&
    url.searchParams.get("tab") === "files" &&
    url.searchParams.get("file") === "src/greet.ts",
  );
});

test("loads a copied review route and refreshes it from GitHub", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  let reviewRequests = 0;
  let semanticRequests = 0;
  await page.route("**/api/diff?**", route => {
    reviewRequests += 1;
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get("refresh")).not.toBeNull();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { ...reviewResponse, title: `Review revision ${reviewRequests}` },
    });
  });
  await page.route("**/api/semantic?**", route => {
    semanticRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: semanticResponse,
    });
  });

  const sharedRoute =
    "/example/hunker-demo/pull/42?scope=full&view=unified&whitespace=show&semantic=off&inline=off&syntax=off&sidebar=collapsed&reviews=hide&tab=files&file=src%2Fmessage.ts";
  await page.goto(sharedRoute);

  await expect(page.getByRole("heading", { name: "Review revision 1" })).toBeVisible();
  await page.getByRole("button", { name: "Open PR", exact: true }).click();
  await expect(page.getByPlaceholder("Paste a GitHub PR or compare URL")).toHaveValue(
    reviewUrl,
  );
  await page.getByRole("button", { name: "Close toolbar menu" }).click();
  await expect(page.locator(".compact-review-toolbar")).toHaveCSS(
    "position",
    "sticky",
  );
  const toolbarBounds = await page.locator(".compact-review-toolbar").boundingBox();
  expect(toolbarBounds?.height).toBeLessThanOrEqual(48);
  await expect(page.locator(".controlbar")).toHaveCount(0);
  await expect(page).toHaveURL(sharedRoute);
  await expect(page.getByRole("button", { name: "Full diff" })).toHaveClass(
    classToken("is-active"),
  );
  await expect(page.getByRole("button", { name: "Unified" })).toHaveClass(
    classToken("is-active"),
  );
  await page.locator(".toolbar-options > .toolbar-menu-button").click();
  await expect(page.getByRole("button", { name: "Ignore whitespace" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByRole("button", { name: "Semantic", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByRole("button", { name: "Off", exact: true })).toHaveClass(
    classToken("is-active"),
  );
  await expect(page.getByRole("button", { name: "Syntax", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator('.diff-lines [class*="hljs-"]')).toHaveCount(0);
  await expect(page.locator(".workspace")).toHaveClass(classToken("sidebar-collapsed"));
  await expect(page.locator(".full-diff .diff-panel")).toHaveCount(2);
  await expect(page.locator(".unified-lines")).toHaveCount(2);
  await page.getByRole("button", { name: "Close toolbar menu" }).click();

  await page.getByRole("button", { name: "One file" }).click();
  await expect(page.locator(".diff-panel")).toHaveCount(1);
  await expect(page.locator(".diff-panel .file-path")).toContainText("message.ts");
  await page.getByRole("button", { name: "Full diff" }).click();
  await expect(page.locator(".full-diff .diff-panel")).toHaveCount(2);
  await expect(page).toHaveURL(sharedRoute);

  await page.getByRole("button", { name: "Refresh diff from GitHub" }).click();
  await expect(page.getByRole("heading", { name: "Review revision 2" })).toBeVisible();
  await expect(page).toHaveURL(sharedRoute);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Review revision 3" })).toBeVisible();
  await expect(page).toHaveURL(sharedRoute);
  expect(reviewRequests).toBe(3);
  expect(semanticRequests).toBe(0);
});

test("lists PR commits and opens a URL-persisted commit diff", async ({ page }) => {
  await page.route("**/api/diff?**", route => {
    const requestUrl = new URL(route.request().url());
    const target = requestUrl.searchParams.get("url") ?? "";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: target.includes("/commit/") ? commitDiffResponse : reviewResponse,
    });
  });
  await page.route("**/api/commits?**", route =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: commitsResponse,
    }),
  );
  await page.route("**/api/semantic?**", route =>
    route.fulfill({ status: 200, contentType: "application/json", json: semanticResponse }),
  );
  await page.route("**/api/reviews?**", route =>
    route.fulfill({ status: 200, contentType: "application/json", json: { comments: [] } }),
  );

  await page.goto("/example/hunker-demo/pull/42");
  await expect(
    page.getByRole("link", { name: "example/hunker-demo", exact: true }),
  ).toHaveAttribute("href", "/repo/example/hunker-demo");

  await page.getByRole("button", { name: "Commits", exact: true }).click();
  await expect(page).toHaveURL(url => url.searchParams.get("tab") === "commits");
  await expect(page.locator(".commit-row")).toHaveCount(2);
  await expect(page.locator(".commits-browser")).toContainText(
    "Introduce greeting helper",
  );

  await page.getByRole("button", { name: /Use a template literal/ }).click();
  await expect(page).toHaveURL(url =>
    url.searchParams.get("commit") === commitsResponse.commits[1].sha,
  );
  await expect(page.locator(".commit-detail-header")).toContainText("2222222");
  await expect(page.locator(".diff-panel")).toHaveCount(1);
  await expect(page.locator(".diff-panel")).toContainText("hello ${person}");
  await expect(page.getByRole("button", { name: "Mark reviewed" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add a review comment" }),
  ).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".commit-detail-header")).toContainText("Use a template literal");
  await expect(page.locator(".diff-panel")).toHaveCount(1);

  await page.getByRole("button", { name: "← All commits" }).click();
  await expect(page.locator(".commit-row")).toHaveCount(2);
  await expect(page).toHaveURL(url => url.searchParams.get("commit") === null);
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.locator(".diff-panel")).toHaveCount(1);
  await expect(page.locator(".diff-panel")).toContainText("const message");
});

test("shows and hides inline GitHub reviews and posts replies and review decisions", async ({ page }) => {
  let reviewLoads = 0;
  await page.route("**/api/diff?**", route =>
    route.fulfill({ status: 200, contentType: "application/json", json: reviewResponse }),
  );
  await page.route("**/api/reviews?**", route => {
    reviewLoads += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: reviewCommentsResponse,
    });
  });
  await page.route("**/api/reviews/reply", route => {
    expect(route.request().postDataJSON()).toEqual({
      url: reviewUrl,
      commentId: 100,
      body: "Yes, the rename is intentional.",
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        comment: {
          ...reviewCommentsResponse.comments[1],
          id: 102,
          body: "Yes, the rename is intentional.",
          author: "local-reviewer",
        },
      },
    });
  });
  await page.route("**/api/reviews/submit", route => {
    expect(route.request().postDataJSON()).toEqual({
      url: reviewUrl,
      body: "Please address the naming concern before merging.",
      event: "REQUEST_CHANGES",
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { event: "REQUEST_CHANGES" },
    });
  });

  await page.goto(
    "/example/hunker-demo/pull/42?scope=file&view=unified&whitespace=ignore&semantic=off&inline=token&syntax=on&sidebar=expanded&reviews=show&tab=files&file=src%2Fgreet.ts",
  );
  await expect(page.locator(".github-review-thread")).toHaveCount(2);
  const openThread = page.locator(".github-review-thread").filter({
    hasText: "alice-reviewer",
  });
  await expect(openThread).toContainText(
    "Could this keep the original parameter name?",
  );
  await expect(openThread).toContainText(
    "The rename makes the template clearer.",
  );
  await expect(openThread.locator(".github-comment-markdown strong")).toHaveText(
    "original parameter name",
  );
  await expect(openThread.locator(".markdown-inline-code")).toHaveText("callers");
  await expect(openThread.locator(".github-comment-markdown li")).toHaveCount(2);
  await expect(
    openThread.getByRole("link", { name: "the style guide" }),
  ).toHaveAttribute("href", "https://example.com/style");
  await expect(openThread.getByRole("link", { name: "do not run this" })).toHaveCount(0);
  await expect(openThread.locator("script")).toHaveCount(0);
  await expect(openThread.locator(".markdown-raw")).toContainText(
    "window.markdownWasUnsafe",
  );
  const resolvedThread = page.locator(".github-review-thread").filter({
    hasText: "bob-reviewer",
  });
  await expect(resolvedThread).toHaveClass(classToken("is-collapsed"));
  await expect(resolvedThread.locator(".github-review-resolved")).toHaveText("Resolved");
  await expect(resolvedThread.locator(".github-review-summary")).toHaveText(
    "This thread has already been handled and can stay out of the way.",
  );
  await resolvedThread.getByRole("button", {
    name: "Expand review thread from bob-reviewer",
  }).click();
  await expect(resolvedThread).not.toHaveClass(classToken("is-collapsed"));
  await expect(resolvedThread).toContainText(
    "This thread has already been handled and can stay out of the way.",
  );
  await expect(resolvedThread.locator(".github-comment-markdown em")).toHaveText(
    "already been handled",
  );

  await openThread.getByRole("button", {
    name: "Collapse review thread from alice-reviewer",
  }).click();
  await expect(openThread).toHaveClass(classToken("is-collapsed"));
  await openThread.getByRole("button", {
    name: "Expand review thread from alice-reviewer",
  }).click();

  const reviewsToggle = page.getByRole("button", { name: "GitHub reviews 2" });
  await page.locator(".toolbar-options > .toolbar-menu-button").click();
  await reviewsToggle.click();
  await expect(page.locator(".github-review-thread")).toHaveCount(0);
  await expect(page).toHaveURL(url => url.searchParams.get("reviews") === "hide");
  await reviewsToggle.click();
  await expect(page.locator(".github-review-thread")).toHaveCount(2);
  expect(reviewLoads).toBe(1);
  await page.getByRole("button", { name: "Close toolbar menu" }).click();

  await page.getByRole("textbox", { name: "Reply to review from alice-reviewer" }).fill(
    "Yes, the rename is intentional.",
  );
  await openThread.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(openThread).toContainText(
    "Yes, the rename is intentional.",
  );

  await page.getByRole("textbox", { name: "GitHub review summary" }).fill(
    "Please address the naming concern before merging.",
  );
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Change request posted to GitHub.");
});

test("reports a semantic backend failure without hiding the patch", async ({ page }) => {
  await page.route("**/api/diff?**", route =>
    route.fulfill({ status: 200, contentType: "application/json", json: reviewResponse }),
  );
  await page.route("**/api/semantic?**", route =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      json: { error: "The semantic engine could not analyze this file." },
    }),
  );
  await page.route("**/api/reviews?**", route =>
    route.fulfill({ status: 200, contentType: "application/json", json: { comments: [] } }),
  );

  await page.goto("/");
  await page.getByPlaceholder("Paste a GitHub PR or compare URL").fill(reviewUrl);
  await page.getByRole("button", { name: "Review", exact: true }).click();

  await expect(page.locator(".semantic-banner.is-error")).toContainText(
    "Syntax analysis unavailable",
  );
  await expect(page.locator(".semantic-banner.is-error")).toContainText(
    "semantic engine",
  );
  await expect(page.locator(".diff-lines")).toContainText("greet(person");
});

test("collapses files and hunks and expands a patch to the full file", async ({ page }) => {
  await page.route("**/api/diff?**", route =>
    route.fulfill({ status: 200, contentType: "application/json", json: reviewResponse }),
  );
  await page.route("**/api/file?**", route => {
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get("url")).toBe(reviewUrl);
    expect(requestUrl.searchParams.get("path")).toBe("src/greet.ts");
    expect(requestUrl.searchParams.get("status")).toBe("modified");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        oldText: `export function greet(name: string) {
  const message = "hello " + name;
  return message;
}
export const untouchedFooter = true;
`,
        newText: `export function greet(person: string) {
  return \`hello \${person}\`;
}
export const untouchedFooter = true;
`,
      },
    });
  });

  await page.goto(
    "/example/hunker-demo/pull/42?scope=file&view=unified&whitespace=ignore&semantic=off&inline=token&syntax=on&sidebar=expanded&reviews=hide&tab=files&file=src%2Fgreet.ts",
  );
  const panel = page.locator(".diff-panel");
  await expect(panel).toHaveCount(1);

  await panel.locator(".file-header").click({ position: { x: 180, y: 27 } });
  await expect(panel).toHaveClass(classToken("is-collapsed"));
  await expect(panel.locator(".diff-lines")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand src/greet.ts", exact: true }).click();
  await expect(panel).not.toHaveClass(classToken("is-collapsed"));

  const collapseHunk = panel.getByRole("button", { name: /Collapse hunk/ });
  await collapseHunk.click();
  await expect(panel.locator(".diff-line:not(.line-hunk)")).toHaveCount(0);
  await panel.getByRole("button", { name: /Expand hunk/ }).click();
  await expect(panel.locator(".diff-line:not(.line-hunk)")).not.toHaveCount(0);

  await page.getByRole("button", { name: "Expand src/greet.ts to full file" }).click();
  await expect(panel.locator(".diff-lines")).toContainText("untouchedFooter");
  await expect(panel.locator(".diff-footer")).toContainText("End of file");

  await page.getByRole("button", { name: "Show patch only for src/greet.ts" }).click();
  await expect(panel.locator(".diff-lines")).not.toContainText("untouchedFooter");
  await expect(panel.locator(".diff-footer")).toContainText("End of patch");

  await page.getByRole("button", { name: "Side by side" }).click();
  await panel.getByRole("button", { name: /Collapse hunk/ }).click();
  await expect(panel.locator(".split-row")).toHaveCount(0);
  await panel.getByRole("button", { name: /Expand hunk/ }).click();
  await expect(panel.locator(".split-row")).not.toHaveCount(0);

  await panel.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(panel).toHaveClass(classToken("is-collapsed"));
  await expect(panel.locator(".diff-lines")).toHaveCount(0);
  await panel.getByRole("button", { name: "✓ Reviewed" }).click();
  await expect(panel).not.toHaveClass(classToken("is-collapsed"));
  await expect(panel.getByRole("button", { name: "Mark reviewed" })).toBeVisible();
});
