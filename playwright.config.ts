import { defineConfig, devices } from "@playwright/test";

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
  webServer: {
    command: "bun run dev",
    url: testUrl,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { HUNKER_PORT: testPort },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
