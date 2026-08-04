import { expect, test } from "@playwright/test";

import { settingsResponse } from "./fixtures";

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
  await expect(page.locator(".repository-file-row")).toContainText("second.ts");

  firstGate.resolve();
  await expect(page.locator(".repository-file-row")).toContainText("second.ts");
  await expect(page.locator(".repository-file-row")).not.toContainText(
    "first.ts",
  );
});
