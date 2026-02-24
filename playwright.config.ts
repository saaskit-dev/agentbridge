import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 120000,
  use: {
    baseURL: "http://localhost:8081",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: false,
    channel: "chrome-canary",
  },
  projects: [
    {
      name: "chrome-canary",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: 'echo "Web server already running"',
    url: "http://localhost:8081",
    reuseExistingServer: true,
  },
});
