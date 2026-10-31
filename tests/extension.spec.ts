import { createServer, type Server } from "node:http";
import { resolve } from "node:path";

import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { e2ePort } from "./e2e/fixture";

// The built extension runs in a real Chromium profile against the real server
// from tests/server.spec.ts, which answers /api/about. GitHub and Hunker's
// review pages are stubbed, so following a redirect never touches the network.
const extension = resolve("extension/dist");
const hunker = `http://127.0.0.1:${e2ePort}`;
const github = "https://github.com";
const pull = "acme/widgets/pull/7/files?w=1";

const test = base.extend<{ context: BrowserContext; popup: Page }>({
  context: async ({ playwright }, use) => {
    const context = await playwright.chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    await context.route(`${github}/**`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<title>GitHub</title>",
      }),
    );
    await context.route(`${hunker}/acme/**`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<title>Hunker</title>",
      }),
    );
    await use(context);
    await context.close();
  },
  popup: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const popup = await context.newPage();
    await popup.goto(
      `chrome-extension://${new URL(worker.url()).host}/popup.html`,
    );
    await use(popup);
  },
});

// The popup disables its controls until the worker has applied a change.
async function choose(popup: Page, change: () => Promise<void>): Promise<void> {
  await change();
  await expect(popup.getByLabel("Hunker port")).toBeEnabled();
}

async function usePort(popup: Page, port: string): Promise<void> {
  const field = popup.getByLabel("Hunker port");
  await choose(popup, async () => {
    await field.fill(port);
    await field.press("Tab");
  });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The stand-in server has no TCP address.");
  }
  return address.port;
}

async function visit(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

test("opens GitHub links from elsewhere in the running Hunker", async ({
  context,
  popup,
}) => {
  await usePort(popup, e2ePort);
  await expect(popup.getByRole("status")).toHaveText(
    new RegExp(
      `^Hunker \\d+\\.\\d+\\.\\d+ is running on 127\\.0\\.0\\.1:${e2ePort}\\.$`,
    ),
  );

  await expect(await visit(context, `${github}/${pull}`)).toHaveURL(
    `${hunker}/${pull}`,
  );
  await expect(
    await visit(context, `${github}/acme/widgets/issues/3`),
  ).toHaveURL(`${github}/acme/widgets/issues/3`);

  const file = "acme/widgets/blob/main/README.md";
  await expect(await visit(context, `${github}/${file}`)).toHaveURL(
    `${github}/${file}`,
  );
  await choose(popup, () =>
    popup
      .getByLabel("Also files, commit history, and pull request lists")
      .check(),
  );
  await expect(await visit(context, `${github}/${file}`)).toHaveURL(
    `${hunker}/${file}`,
  );

  await choose(popup, () => popup.getByLabel("Off").check());
  await expect(await visit(context, `${github}/${pull}`)).toHaveURL(
    `${github}/${pull}`,
  );
});

test("keeps links that start in Hunker or on GitHub on GitHub", async ({
  context,
  popup,
}) => {
  await usePort(popup, e2ePort);
  await expect(popup.getByRole("status")).toContainText("is running");

  await Promise.all(
    [`${hunker}/acme/widgets`, `${github}/acme/widgets`].map(async (start) => {
      const page = await visit(context, start);
      await page.evaluate((url) => location.assign(url), `${github}/${pull}`);
      await expect(page).toHaveURL(`${github}/${pull}`);
    }),
  );
});

test("leaves GitHub links alone unless Hunker answers on the port", async ({
  context,
  popup,
}) => {
  // Another development server owns the port, as Vite can own 5173: it answers
  // every path, /api/about included, with its HTML page.
  const other = createServer((_request, response) =>
    response
      .writeHead(200, { "content-type": "text/html" })
      .end("<!doctype html><title>Vite</title>"),
  );
  const port = await listen(other);
  try {
    await usePort(popup, String(port));
    await expect(popup.getByRole("status")).toHaveText(
      `Another server answers on 127.0.0.1:${port}, so GitHub links open normally.`,
    );
    await expect(await visit(context, `${github}/${pull}`)).toHaveURL(
      `${github}/${pull}`,
    );
  } finally {
    await new Promise((done) => other.close(done));
  }

  // Reopening the popup probes again; now nothing listens.
  await popup.reload();
  await expect(popup.getByRole("status")).toContainText(
    `Hunker isn't running on 127.0.0.1:${port}`,
  );
  await expect(await visit(context, `${github}/${pull}`)).toHaveURL(
    `${github}/${pull}`,
  );
});
