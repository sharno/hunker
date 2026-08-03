import { expect, test } from "@playwright/test";

import { settingsResponse } from "./fixtures";

test("shows configured and temporary local repositories on the homepage", async ({
  page,
}) => {
  await page.route("**/api/settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      json: settingsResponse,
    }),
  );
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

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Repositories", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("example/hunker", { exact: true })).toBeVisible();
  await expect(
    page.getByText("effect-ts/effect", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Bound agent retries and surface timeout context"),
  ).toHaveCount(0);
  await expect(page.locator(".home-toolbar")).toHaveCSS("position", "sticky");

  await page.getByLabel("Filter repositories").fill("effect");
  await expect(page.getByText("example/hunker", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("effect-ts/effect", { exact: true }),
  ).toBeVisible();

  await page.getByText("effect-ts/effect", { exact: true }).click();
  await expect(page).toHaveURL("/effect-ts/effect");
});
