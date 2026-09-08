import { expect, test } from "@playwright/test";
import { buildIndustryFixture } from "../industry/html";
import { fixtureGraph, runFixture } from "../industry/fixtures";
import { buildIndustryGraph } from "../../src/lib/industry-graph/model";

const origin = "http://industry.test";
let html: string;
test.beforeAll(async () => { html = await buildIndustryFixture(); });
test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" || url.origin !== origin) return route.abort();
    if (url.pathname === "/api/industry-graph") return route.fulfill({ json: fixtureGraph });
    if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    return route.abort();
  });
});

test("homepage explores real component, evidence, supplier direction and expansion", async ({ page }) => {
  await page.goto(origin);
  await expect(page.getByText("3 / 19", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Explore NVIDIA (NVDA)", exact: true }).click();
  await page.getByRole("button", { name: "Micron supplies NVIDIA", exact: false }).last().click();
  await expect(page.getByRole("heading", { name: "Micron supplies NVIDIA" })).toBeVisible();
  await expect(page.locator("blockquote")).toContainText("Synthetic test evidence");
  await expect(page.getByText(/pending identity review/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Read SEC filing" })).toHaveAttribute("href", /^https:\/\/www.sec.gov\/Archives\//);
  await page.getByRole("button", { name: "Back to company" }).click();
  await page.getByRole("button", { name: "Explore AMD (AMD)", exact: true }).click();
  await page.getByRole("button", { name: "Expand connections", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explore Example Packaging", exact: true })).toBeVisible();
});

test("list view filters and retains accessible evidence without a canvas", async ({ page }) => {
  await page.goto(origin);
  await expect(page.getByText("3 / 19", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByLabel("Relationship type").selectOption("COMPETES_WITH");
  await expect(page.getByRole("region", { name: /Scrollable industry map/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /AMD competes with NVIDIA/ })).toHaveCount(1);
  await page.getByRole("button", { name: /AMD competes with NVIDIA/ }).click();
  await expect(page.getByRole("heading", { name: "AMD competes with NVIDIA" })).toBeVisible();
});

test("search selects a company, keeps prediction context, and never sends raw query to GA", async ({ page }) => {
  await page.goto(origin);
  await expect(page.getByText("3 / 19", { exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("private@example.invalid");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByText("No match in this map.")).toBeVisible();
  await page.getByRole("searchbox").fill("Micron");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByRole("link", { name: "Make a prediction" })).toHaveAttribute("href", "/predictions/new?ticker=MU");
  const events = await page.evaluate(() => (window.dataLayer ?? []).map((item) => Array.from(item as ArrayLike<unknown>)));
  expect(events.filter((event) => event[1] === "industry_graph_view")).toHaveLength(1);
  expect(events.filter((event) => event[1] === "industry_graph_load")).toHaveLength(1);
  expect(events.some((event) => event[1] === "graph_search")).toBe(true);
  expect(JSON.stringify(events)).not.toContain("private@example.invalid");
  expect(JSON.stringify(events)).not.toContain("Synthetic test evidence");
  expect(JSON.stringify(events)).toContain('"graph_origin":"yes"');
});

test("API failure retries, while empty coverage never fabricates relationships", async ({ page }) => {
  await page.route("**/api/industry-graph", (route) => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto(origin);
  await expect(page.getByText(/temporarily unavailable/)).toBeVisible();
  await page.route("**/api/industry-graph", (route) => route.fulfill({ json: buildIndustryGraph({}) }));
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(/Published filing relationships will appear/)).toBeVisible();
  await expect(page.getByText("19 nodes · 0 connections")).toBeVisible();
});

test("deep links focus the company and layout does not overflow the viewport", async ({ page }) => {
  await page.goto(`${origin}/?company=MU`);
  await expect(page.getByRole("heading", { name: "Micron", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open company page" })).toHaveAttribute("href", "/ticker/MU");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("staging opt-out and analytics failures do not break exploration", async ({ page }) => {
  await page.route(origin + "/", (route) => route.fulfill({ contentType: "text/html", body: html.replace('content="enabled"', 'content="disabled"') }));
  await page.goto(origin);
  await expect(page.getByText("3 / 19", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.dataLayer?.length ?? 0)).toBe(0);
  await page.evaluate(() => {
    document.querySelector('meta[name="youanalyst-analytics"]')!.setAttribute("content", "enabled");
    window.gtag = () => { throw new Error("Blocked analytics"); };
  });
  await page.getByRole("button", { name: "Explore NVIDIA (NVDA)", exact: true }).click();
  await expect(page.getByRole("heading", { name: "NVIDIA", exact: true })).toBeVisible();
});

test("selecting an uncovered starter still reveals another issuer's incoming evidence", async ({ page }) => {
  const graph = buildIndustryGraph({ NVDA: runFixture("NVDA", "0001045810", "NVIDIA", [{ targetName: "Micron Technology," }]) });
  await page.route("**/api/industry-graph", (route) => route.fulfill({ json: graph }));
  await page.goto(`${origin}/?company=MU`);
  await expect(page.getByRole("heading", { name: "Micron", exact: true })).toBeVisible();
  await expect(page.getByText(/company’s own filing has not been added/)).toBeVisible();
  await page.getByRole("button", { name: "Micron supplies NVIDIA", exact: false }).last().click();
  await expect(page.locator("blockquote")).toContainText("Synthetic test evidence");
  await expect(page.getByText(/pending identity review/)).toBeVisible();
});

test("overview reveals mentions on demand and resets cleanly after focusing a neighbor", async ({ page }) => {
  await page.goto(origin);
  await expect(page.getByText("3 / 19", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explore Unresolved Foundry", exact: true })).toHaveCount(0);
  const canvas = page.getByRole("region", { name: /Scrollable industry map/ });
  await expect.poll(() => canvas.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "Show all connections", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explore Unresolved Foundry", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to industry overview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explore Unresolved Foundry", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Explore NVIDIA (NVDA)", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explore Unresolved Foundry", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Explore AMD (AMD)", exact: true }).click();
  await page.getByRole("button", { name: "Focus on this company", exact: true }).click();
  await expect(page.getByRole("button", { name: "Explore Example Packaging", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explore Unresolved Foundry", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to industry overview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Show all connections", exact: true })).toBeVisible();
  const events = await page.evaluate(() => (window.dataLayer ?? []).map((item) => Array.from(item as ArrayLike<unknown>)));
  expect(JSON.stringify(events)).toContain('"action":"all_connections"');
  expect(JSON.stringify(events)).toContain('"action":"focus_company"');
  expect(JSON.stringify(events)).toContain('"graph_version":"v2"');
});

test("search finds a mention hidden from the overview and filters its focused connections", async ({ page }) => {
  await page.goto(origin);
  await expect(page.getByText("3 / 19", { exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("Unresolved Foundry");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Unresolved Foundry", exact: true })).toBeVisible();
  await page.getByLabel("Relationship type").selectOption("COMPETES_WITH");
  await expect(page.getByText(/No connections match this view/)).toBeVisible();
  await page.getByRole("button", { name: "Back to industry overview", exact: true }).click();
  await expect(page.getByLabel("Relationship type")).toHaveValue("all");
});

test("TSM is visible in the overview and its full name reveals source-backed suppliers", async ({ page }) => {
  const graph = buildIndustryGraph({ NVDA: runFixture("NVDA", "0001045810", "NVIDIA", [{ targetName: "Taiwan Semiconductor Manufacturing" }]) });
  await page.route("**/api/industry-graph", (route) => route.fulfill({ json: graph }));
  await page.goto(origin);
  await expect(page.getByRole("button", { name: "Explore TSMC (TSM)", exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("Taiwan Semiconductor Manufacturing");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByRole("heading", { name: "TSMC", exact: true })).toBeVisible();
  await expect(page.getByText(/This company files a 20-F/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open company page" })).toHaveAttribute("href", "/ticker/TSM");
  await page.getByRole("button", { name: "TSMC supplies NVIDIA 1 source →", exact: true }).click();
  await expect(page.locator("blockquote")).toContainText("Synthetic test evidence");
  await expect(page.getByRole("link", { name: "Read SEC filing" })).toHaveAttribute("href", /\/1045810\//);
});
