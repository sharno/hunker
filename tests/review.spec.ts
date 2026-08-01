import { expect, test } from "@playwright/test";

import {
  movesResponse,
  reviewResponse,
  reviewUrl,
  semanticResponse,
} from "./fixtures";

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

  await page.goto("/");
  await page.getByRole("button", { name: "Collapse file sidebar" }).click();
  await expect(page.locator(".workspace")).toHaveClass(/sidebar-collapsed/);
  await expect(page.getByRole("navigation", { name: "Changed files" })).toBeHidden();
  await page.getByRole("button", { name: "Expand file sidebar" }).click();
  await expect(page.locator(".workspace")).not.toHaveClass(/sidebar-collapsed/);
  await page.getByPlaceholder("Paste a GitHub PR or compare URL").fill(reviewUrl);
  await page.getByRole("button", { name: "Review", exact: true }).click();

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
  await expect(page.locator(".line-semantic")).not.toHaveCount(0);

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
