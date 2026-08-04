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
  await expect(page.locator(".repository-view-tabs")).toHaveCSS(
    "background-color",
    "rgb(48, 59, 80)",
  );
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

  firstGate.resolve();
  await expect(page.locator(".repository-file-row")).toContainText("second.ts");
  await expect(page.locator(".repository-file-row")).not.toContainText(
    "first.ts",
  );
});
