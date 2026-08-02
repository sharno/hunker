import { expect, test } from "@playwright/test";
import { Schema as S } from "effect";

import { HunkerSettings } from "../src/settings";
import { settingsResponse } from "./fixtures";

const settingsWrite = S.Struct({ settings: HunkerSettings });

test("edits and saves server-backed local settings", async ({ page }) => {
  let saved: HunkerSettings | undefined;
  await page.route("**/api/settings", (route) => {
    const body: unknown = route.request().postDataJSON();
    if (body === null) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        json: settingsResponse,
      });
    }
    saved = S.decodeUnknownSync(settingsWrite)(body).settings;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { ...settingsResponse, settings: saved },
    });
  });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText(settingsResponse.configPath)).toBeVisible();

  await page.getByLabel("Repositories root").fill("/Users/example/projects");
  await page.getByRole("button", { name: "Full diff" }).click();
  await page.getByRole("button", { name: "Unified" }).click();
  await page.getByRole("button", { name: /Ignore whitespace/ }).click();
  await page.getByRole("button", { name: "Save settings" }).click();

  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(saved).toMatchObject({
    repositoriesRoot: "/Users/example/projects",
    reviewScope: "full",
    viewMode: "unified",
    ignoreWhitespace: false,
  });
  await expect(page).toHaveURL("/settings");
});
