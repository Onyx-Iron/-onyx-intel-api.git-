import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/e2e/takeoff",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, PLAYWRIGHT_TEST_MODE: "1" },
  },
});
