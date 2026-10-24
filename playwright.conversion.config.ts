import { defineConfig, devices } from "@playwright/test";

// In-memory UI fixtures only: no deployed server, Firebase credentials or writes.
export default defineConfig({
  testDir: "./tests/conversion",
  outputDir: "./test-results/conversion",
  fullyParallel: true,
  // Four CI shards already run independently. One renderer per runner avoids
  // software-WebGL startup and animation timing contention between fixtures.
  workers: process.env.CI ? 1 : 2,
  use: { serviceWorkers: "block" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Camera and tour logic tagged @desktop-only renders the same on both
    // devices; layout, touch and hit-testing checks still run on mobile.
    { name: "mobile", use: { ...devices["Pixel 7"] }, grepInvert: /@desktop-only/ },
  ],
});
