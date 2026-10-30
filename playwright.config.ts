import { defineConfig, devices } from "@playwright/test";

import {
  cacheRoot,
  configFile,
  e2ePort,
  gitEnvironment,
  repositoriesRoot,
} from "./tests/e2e/fixture";

const testPort = process.env.HUNKER_TEST_PORT ?? "5174";
const testUrl = `http://localhost:${testPort}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "line",
  use: {
    baseURL: testUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "bun run dev",
      url: testUrl,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { HUNKER_PORT: testPort },
    },
    {
      // tests/server.spec.ts: the real server over a fixture checkout.
      command: "bun tests/e2e/build-fixture.ts && bun run dev",
      url: `http://localhost:${e2ePort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...gitEnvironment,
        HUNKER_PORT: e2ePort,
        HUNKER_REPOS_ROOT: repositoriesRoot,
        HUNKER_CACHE_ROOT: cacheRoot,
        HUNKER_CONFIG_FILE: configFile,
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
