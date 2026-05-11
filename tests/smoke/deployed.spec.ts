import { expect, test } from "@playwright/test";

test("health endpoint reports ok", async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/api/health`);
  expect(response.ok()).toBeTruthy();

  const health = await response.json();
  expect(health.status).toBe("ok");
  expect(health.service).toBe("ifindata-web");
});

test("homepage renders company and institution search", async ({ page }) => {
  await page.goto("/");

  // Verify navigation is present
  await expect(page.getByRole("link", { name: "Feed", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Predict", exact: true }).first()).toBeVisible();
  
  // Verify unified company and institution search is on the page
  await expect(page.getByRole("combobox", { name: "Company, ticker, or institution" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Go" })).toBeVisible();
  await expect(page.getByTestId("company-graph-chip").first()).toBeVisible();
});

test("staging banner is present only when expected", async ({ page }) => {
  await page.goto("/");

  const expectBanner = process.env.PLAYWRIGHT_EXPECT_STAGING_BANNER === "1";
  const banner = page.getByTestId("staging-banner");

  if (expectBanner) {
    await expect(banner).toBeVisible();
  } else {
    await expect(banner).toHaveCount(0);
  }
});
