import { expect, test } from "@playwright/test";
import { Schema as S } from "effect";

import { HunkerSettings } from "../src/settings";
import {
  characterDiffResponse,
  commitDiffResponse,
  reviewResponse,
  reviewUrl,
  semanticResponse,
  settingsResponse,
} from "./fixtures";

const classToken = (token: string) => new RegExp(`(?:^|\\s)${token}(?:\\s|$)`);
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
  await page.route("**/api/characters?**", (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.searchParams.get("path") ?? "";
    const mode =
      requestUrl.searchParams.get("mode") === "character"
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
  await page.route("**/api/reviews?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { comments: [] },
    }),
  );
});

test("does not show stale review content while browser Fetch requests are pending", async ({
  page,
}) => {
  let reviewRequests = 0;
  let reviewGate = Promise.withResolvers<void>();
  await page.route("**/api/diff?**", async (route) => {
    const revision = ++reviewRequests;
    await reviewGate.promise;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { ...reviewResponse, title: `Loading test revision ${revision}` },
    });
  });
  await page.route("**/api/semantic?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: semanticResponse,
    }),
  );

  await page.goto("/");
  await page.getByPlaceholder("Paste any GitHub URL").fill(reviewUrl);
  await page.getByRole("button", { name: "Open", exact: true }).click();

  await expect(page.locator(".review-loading")).toContainText(
    "Loading the latest change",
  );
  await expect(page.locator(".review-header")).toHaveCount(0);
  await expect(page.locator(".diff-panel")).toHaveCount(0);
  await expect(page).toHaveTitle("Loading review · Hunker");

  reviewGate.resolve();
  await expect(
    page.getByRole("heading", { name: "Loading test revision 1" }),
  ).toBeVisible();

  reviewGate = Promise.withResolvers<void>();
  await page.getByRole("button", { name: "Refresh diff from GitHub" }).click();
  await expect(page.locator(".review-loading")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Loading test revision 1" }),
  ).toHaveCount(0);
  await expect(page.locator(".diff-panel")).toHaveCount(0);

  reviewGate.resolve();
  await expect(
    page.getByRole("heading", { name: "Loading test revision 2" }),
  ).toBeVisible();
});

test("wraps long split diff lines without painting across columns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const longLine = `export const description = "${"long review text ".repeat(18)}";`;
  await page.route("**/api/diff?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        ...reviewResponse,
        diff: `diff --git a/src/long.ts b/src/long.ts
index 1111111..2222222 100644
--- a/src/long.ts
+++ b/src/long.ts
@@ -1 +1 @@
-${longLine}
+export const description = "short review text";
`,
      },
    }),
  );

  await page.goto(
    "/example/hunker-demo/pull/42?scope=file&view=split&semantic=off&inline=off&syntax=off&file=src%2Flong.ts",
  );
  await expect(page.locator(".split-row")).toHaveCount(1);

  const layout = await page.locator(".split-row").evaluate((row) => {
    const left = row.querySelector<HTMLElement>(".split-cell.left");
    const right = row.querySelector<HTMLElement>(".split-cell.right");
    if (left === null || right === null) {
      throw new Error("Expected a complete split diff row");
    }
    const leftCode = left.querySelector<HTMLElement>(".line-code");
    if (leftCode === null) throw new Error("Expected split diff code");
    const leftBounds = left.getBoundingClientRect();
    const rightBounds = right.getBoundingClientRect();
    return {
      leftHeight: leftBounds.height,
      rightHeight: rightBounds.height,
      leftRight: leftBounds.right,
      rightLeft: rightBounds.left,
      codeClientWidth: leftCode.clientWidth,
      codeScrollWidth: leftCode.scrollWidth,
      overflowWrap: getComputedStyle(leftCode).overflowWrap,
      whiteSpace: getComputedStyle(leftCode).whiteSpace,
    };
  });

  expect(layout.leftHeight).toBeGreaterThan(22);
  expect(layout.leftHeight).toBe(layout.rightHeight);
  expect(layout.leftRight).toBeLessThanOrEqual(layout.rightLeft + 1);
  expect(layout.codeScrollWidth).toBeLessThanOrEqual(
    layout.codeClientWidth + 1,
  );
  expect(layout.overflowWrap).toBe("anywhere");
  expect(layout.whiteSpace).toBe("break-spaces");
});

test("canonicalizes copied review URLs and preserves browser layout across reloads", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  let reviewRequests = 0;
  let semanticRequests = 0;
  await page.route("**/api/diff?**", (route) => {
    reviewRequests += 1;
    expect(
      new URL(route.request().url()).searchParams.get("refresh"),
    ).not.toBeNull();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { ...reviewResponse, title: `Review revision ${reviewRequests}` },
    });
  });
  await page.route("**/api/semantic?**", (route) => {
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
  await expect(
    page.getByRole("heading", { name: "Review revision 1" }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    "/example/hunker-demo/pull/42/files/src/message.ts",
  );

  const toolbar = page.locator(".compact-review-toolbar");
  await expect(toolbar).toHaveCSS("position", "sticky");
  await expect(toolbar).toHaveClass(classToken("is-expanded"));
  await expect(toolbar).toHaveCSS("height", "68px");
  await page.evaluate(() => window.scrollTo(0, 240));
  await expect(toolbar).toHaveClass(classToken("is-compact"));
  await expect(toolbar).toHaveCSS("height", "48px");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(toolbar).toHaveClass(classToken("is-expanded"));
  await expect(page.locator(".workspace")).toHaveClass(
    classToken("sidebar-collapsed"),
  );
  await expect(page.locator(".full-diff .diff-panel")).toHaveCount(2);
  await expect(page.locator(".unified-lines")).toHaveCount(2);

  await page.getByRole("button", { name: "Expand file sidebar" }).click();
  await page
    .locator(".file-sidebar")
    .getByRole("button", { name: /greet\.ts/ })
    .click();
  await expect(page).toHaveURL(
    "/example/hunker-demo/pull/42/files/src/greet.ts",
  );
  await page.goBack();
  await expect(page).toHaveURL(
    "/example/hunker-demo/pull/42/files/src/message.ts",
  );
  await expect(page.locator(".file-row.is-selected")).toContainText(
    "message.ts",
  );
  await page.goForward();
  await expect(page).toHaveURL(
    "/example/hunker-demo/pull/42/files/src/greet.ts",
  );
  await page.goBack();
  await expect(page).toHaveURL(
    "/example/hunker-demo/pull/42/files/src/message.ts",
  );

  await page.getByRole("button", { name: "Refresh diff from GitHub" }).click();
  await expect(
    page.getByRole("heading", { name: "Review revision 2" }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    "/example/hunker-demo/pull/42/files/src/message.ts",
  );

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Review revision 3" }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    "/example/hunker-demo/pull/42/files/src/message.ts",
  );
  expect(reviewRequests).toBe(3);
  expect(semanticRequests).toBe(1);
});

test("routes a direct commit through Fetch without PR-only browser controls", async ({
  page,
}) => {
  let reviewRequests = 0;
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
  await page.route("**/api/reviews?**", (route) => {
    reviewRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { comments: [] },
    });
  });

  await page.goto(
    "/example/hunker-demo/commit/2222222222222222222222222222222222222222",
  );
  await expect(
    page.getByRole("heading", { name: commitDiffResponse.title }),
  ).toBeVisible();
  await expect(page.locator(".review-tab-picker")).toHaveCount(0);
  await expect(page.locator(".github-review-composer")).toHaveCount(0);
  expect(reviewRequests).toBe(0);
});
