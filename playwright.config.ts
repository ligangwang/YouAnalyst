import { defineConfig, devices } from "@playwright/test";

const bearerToken = process.env.PLAYWRIGHT_AUTH_BEARER_TOKEN;
const extraHTTPHeaders = bearerToken
  ? {
      Authorization: `Bearer ${bearerToken}`,
    }
  : undefined;

export default defineConfig({
  testDir: "./tests/smoke",
  fullyParallel: true,
  // Live WebGL journeys share limited software-rendering resources on CI.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    extraHTTPHeaders,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
