import { expect, test, type Page } from "@playwright/test";

import { buildFixture, checkout, e2ePort, needleLine } from "./e2e/fixture";

// Nothing here is mocked: the real Rust server reads a real Git checkout,
// and the Elm decoders read its real responses. Tests run in order because
// pulling and switching branches change the checkout.
test.use({ baseURL: `http://localhost:${e2ePort}` });
test.describe.configure({ mode: "serial" });
test.beforeAll(() => buildFixture());

/** The bottom edge of everything pinned to the top of the viewport. */
function stickyBottom(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(
      0,
      ...[...document.querySelectorAll("body *")]
        .filter((element) =>
          ["sticky", "fixed"].includes(getComputedStyle(element).position),
        )
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.top <= 1 && rect.height < window.innerHeight / 2)
        .map((rect) => rect.bottom),
    ),
  );
}

test("lists the checkout and opens a highlighted file from its collapsed tree", async ({
  page,
}) => {
  await page.goto("/");
  const repository = page.getByRole("link", { name: /acme\/widgets/ });
  await expect(repository).toContainText(checkout);
  await repository.click();
  await expect(page).toHaveURL(/\/acme\/widgets\/tree\/main$/);

  const tree = page.locator(".repository-file-sidebar");
  await expect(tree.getByRole("button", { name: /lib\.rs/ })).toHaveCount(0);
  await tree.locator(".folder-row", { hasText: "src" }).click();
  await tree.getByRole("button", { name: /lib\.rs/ }).click();

  await expect(page).toHaveURL(/\/acme\/widgets\/blob\/main\/src\/lib\.rs$/);
  const file = page.locator(".repository-file-view");
  await expect(file).toContainText("pub fn greeting()");
  await expect(file.locator(".syntax-keyword").first()).toHaveText("pub");
});

test("opens a content search hit at its line below the sticky bars", async ({
  page,
}) => {
  await page.goto("/acme/widgets/tree/main?q=needle");
  const hit = page.locator(".repository-search-match", {
    hasText: "src/long.rs",
  });
  await expect(hit.locator("mark").first()).toHaveText(/needle/i);
  await hit.click();

  await expect(page).toHaveURL(
    new RegExp(`/blob/main/src/long\\.rs\\?q=needle#L${needleLine}$`),
  );
  const target = page.locator(".source-line.is-target");
  await expect(target).toContainText("NEEDLE_LINE");
  await expect(target).toBeInViewport();
  const top = await target.evaluate((line) => line.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual((await stickyBottom(page)) - 1);
});

test("fetches origin in the background and fast-forwards with Pull", async ({
  page,
}) => {
  await page.goto("/acme/widgets");
  // Opening reads local Git alone; the follow-up fetch finds origin's commit.
  const pull = page.getByRole("button", { name: "Pull 1 ↓" });
  await expect(pull).toBeEnabled();
  await pull.click();

  await expect(page.locator(".source-control-feedback")).toHaveText(
    "Pulled 1 commit.",
  );
  await expect(page.locator(".repository-file-sidebar")).toContainText(
    "CHANGELOG.md",
  );
  await expect(page.getByRole("button", { name: "Up to date" })).toBeDisabled();
});

test("switches to a local branch and reads its tree", async ({ page }) => {
  await page.goto("/acme/widgets");
  await page
    .getByLabel("Checked-out repository branch")
    .selectOption("feature/tabs");

  await expect(page.locator(".source-control-feedback")).toHaveText(
    "Switched to feature/tabs.",
  );
  await expect(page).toHaveURL(/\/acme\/widgets\/tree\/feature%2Ftabs$/);
  const tree = page.locator(".repository-file-sidebar");
  await tree.locator(".folder-row", { hasText: "src" }).click();
  await expect(tree).toContainText("tabs.rs");
  await expect(tree).not.toContainText("CHANGELOG.md");
});

test("lists the checked-out branch's commits newest first", async ({
  page,
}) => {
  await page.goto("/acme/widgets");
  await page.getByRole("button", { name: "Commits", exact: true }).click();

  await expect(page.locator(".repository-commit-row strong")).toHaveText([
    "Add tabs",
    "Add a greeting",
    "Add widgets",
  ]);
});

test("keeps the repository page and its controls inside a phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/acme/widgets/tree/feature%2Ftabs?q=needle");
  await expect(page.locator(".repository-search-match").first()).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
  await expect(page.locator(".source-control-pull")).toBeInViewport();
});
