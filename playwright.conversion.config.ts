import { defineConfig, devices } from "@playwright/test";

// In-memory UI fixtures only: no deployed server, Firebase credentials or writes.
export default defineConfig({
  testDir: "./tests/conversion",
  outputDir: "./test-results/conversion",
  fullyParallel: true,
  workers: 2,
  use: { serviceWorkers: "block" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
