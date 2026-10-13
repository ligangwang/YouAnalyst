import { expect, test, type Page } from "@playwright/test";

// Synthetic fixture; no live data extraction or database writes.
const supplierEdge = {
  id: "fixture-supplier", sourceName: "Microsoft", sourceTicker: "MSFT", sourceCik: "0000789019",
  targetName: "NVIDIA", targetType: "company", relationshipType: "SUPPLIER_OF",
  direction: "target_to_source", evidenceText: "Synthetic supplier evidence for UI testing.",
  filingType: "10-K", accessionNumber: "0000789019-25-000001", filingDate: "2025-07-30", reportDate: "2025-06-30",
  section: "item1", confidence: 0.9,
};

async function mockCompanyData(page: Page, options: { graphError?: boolean; communityError?: boolean; empty?: boolean } = {}) {
  await page.route("**/api/company-graph/MSFT", (route) => route.fulfill({
    status: options.graphError ? 503 : 200,
    json: { edges: options.empty ? [] : [supplierEdge, {
      ...supplierEdge, id: "fixture-category", targetName: "Semiconductor suppliers", targetType: "category",
    }], filing: null },
  }));
  await page.route("**/api/ticker/MSFT?*", (route) => route.fulfill({
    status: options.communityError ? 503 : 200,
    json: { ticker: "MSFT", items: [], viewerPosition: null, nextCursor: null },
  }));
  await page.route("**/api/institutional-holdings/MSFT", (route) => route.fulfill({ status: 503, json: { error: "Fixture ownership unavailable" } }));
  await page.route("**/api/insider-transactions/MSFT?*", (route) => route.fulfill({ json: { items: [] } }));
}

test("old company URLs redirect permanently and retain query parameters", async ({ request }) => {
  const response = await request.get("/ticker/MSFT?source=watchlist&tag=a&tag=b", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  const location = new URL(response.headers().location, "http://localhost");
  expect(location.pathname).toBe("/company/microsoft");
  expect(location.searchParams.get("source")).toBe("watchlist");
  expect(location.searchParams.getAll("tag")).toEqual(["a", "b"]);
});

test("unknown tickers retain a usable URL without inventing a company-name mapping", async ({ request }) => {
  const response = await request.get("/ticker/IBM", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(new URL(response.headers().location, "http://localhost").pathname.toLowerCase()).toBe("/company/ticker-ibm");
  const page = await request.get("/company/ticker-ibm");
  expect(page.ok()).toBeTruthy();
  const unknown = await request.get("/company/this-company-does-not-exist");
  expect(unknown.status()).toBe(404);
});

test("sitemap advertises canonical company URLs without old ticker URLs", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.ok()).toBeTruthy();
  const xml = await response.text();
  expect(xml).toContain("/company/microsoft</loc>");
  expect(xml).not.toContain("/ticker/");
  expect(xml.match(/\/company\/microsoft<\/loc>/g)).toHaveLength(1);
});

test("company profile shows directed relationships, evidence, filters, and canonical links", async ({ page }) => {
  await mockCompanyData(page);
  await page.goto("/company/microsoft");
  await expect(page.getByRole("heading", { name: "Microsoft", exact: true })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/company\/microsoft$/);
  const relationships = page.locator("#relationships");
  await expect(relationships.getByText("NVIDIA supplies Microsoft.", { exact: true })).toBeVisible();
  await expect(relationships.getByRole("link", { name: "NVIDIA" })).toHaveAttribute("href", "/company/nvidia");
  await expect(relationships.locator("article")).toHaveCount(1);
  await relationships.getByText("Filing evidence", { exact: true }).click();
  await expect(relationships.getByText(supplierEdge.evidenceText, { exact: true })).toBeVisible();
  await expect(relationships.getByRole("link", { name: "Open SEC source" })).toHaveAttribute("href", /www\.sec\.gov\/Archives\/edgar\/data\/789019\//);
  await relationships.getByLabel("Include unnamed industry groups").check();
  await expect(relationships.locator("article")).toHaveCount(2);
  await relationships.getByLabel("Find a counterparty").fill("nvidia");
  await expect(relationships.locator("article")).toHaveCount(1);
  await relationships.getByLabel("Relationship type").selectOption("COMPETES_WITH");
  await expect(relationships.getByRole("status")).toContainText("No relationships match");
});

test("community failure does not hide the profile or relationships", async ({ page }) => {
  await mockCompanyData(page, { communityError: true });
  await page.goto("/company/microsoft");
  await expect(page.getByRole("heading", { name: "Microsoft", exact: true })).toBeVisible();
  await expect(page.locator("#relationships").getByText("NVIDIA supplies Microsoft.", { exact: true })).toBeVisible();
  await expect(page.locator("#community").getByRole("alert")).toContainText("Unable to load");
});

test("missing relationship coverage is distinct from an API failure", async ({ page }) => {
  await mockCompanyData(page, { empty: true });
  await page.goto("/company/microsoft");
  await expect(page.getByText("No relationship research published yet")).toBeVisible();
  await mockCompanyData(page, { graphError: true });
  await page.reload();
  await expect(page.locator("#relationships").getByRole("alert")).toContainText("temporarily unavailable");
  await mockCompanyData(page);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator("#relationships").getByText("NVIDIA supplies Microsoft.", { exact: true })).toBeVisible();
});

test("directory and company profile work on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCompanyData(page);
  await page.goto("/companies");
  await expect(page.getByRole("heading", { name: "Explore major companies" })).toBeVisible();
  await page.locator('a[href="/company/microsoft"]').last().click();
  await expect(page.getByRole("heading", { name: "Microsoft", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Company sections" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
