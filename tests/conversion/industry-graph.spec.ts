import { expect, test } from "@playwright/test";
import { buildIndustryFixture } from "../industry/html";
import { fixtureGraph, runFixture } from "../industry/fixtures";
import { buildIndustryGraph } from "../../src/lib/industry-graph/model";
import relationshipReviews from "../../src/lib/company-graph/relationship-reviews.json";

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

test("corrected OEM evidence shows distributor direction and the review explanation", async ({ page }) => {
  const expected = relationshipReviews.find((review) => review.expected.sourceTicker === "MSFT" && review.expected.targetName === "Dell")!.expected;
  const run = runFixture("MSFT", expected.sourceCik, "Microsoft", [expected]);
  run.result.filing.accessionNumber = expected.accessionNumber;
  await page.route("**/api/industry-graph", (route) => route.fulfill({ json: buildIndustryGraph({ MSFT: run }) }));
  await page.goto(`${origin}/?company=MSFT`);
  await page.getByRole("button", { name: "Dell distributes for Microsoft 1 source →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dell distributes for Microsoft", exact: true })).toBeVisible();
  await expect(page.getByText(/Evidence reviewed 2026-09-08/)).toBeVisible();
  await expect(page.locator("blockquote")).toContainText("distribution agreements");
  await expect(page.getByRole("link", { name: "Read SEC filing" })).toHaveAttribute("href", /\/789019\//);
});

test("a visitor can inspect evidence before choosing contextual registration", async ({ page }) => {
  await page.goto(`${origin}/?company=NVDA`);
  await expect(page.getByRole("link", { name: "Sign in to save NVDA" })).toHaveAttribute("href", "/auth?next=%2F%3Fcompany%3DNVDA");
  await expect(page.getByRole("button", { name: "Micron supplies NVIDIA 1 source →" })).toBeVisible();
  await page.getByRole("link", { name: "Sign in to save NVDA" }).click();
  await expect(page).toHaveURL(`${origin}/auth?next=%2F%3Fcompany%3DNVDA`);
});

test("signed-in saves survive reload, reopen the company and can be removed", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  let tickers: string[] = [];
  await page.route("**/api/industry-graph/saved", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer isolated-test-token");
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      expect(body.ticker).toBe("NVDA");
      tickers = body.saved ? ["NVDA"] : [];
    }
    await route.fulfill({ json: { tickers } });
  });
  await page.goto(`${origin}/?company=NVDA`);
  await page.getByRole("button", { name: "Save NVDA", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("NVDA saved to your account.");
  await page.reload();
  const saved = page.getByRole("region", { name: "Your saved companies" });
  await expect(saved.getByRole("button", { name: "NVDA", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset map", exact: true }).click();
  await saved.getByRole("button", { name: "NVDA", exact: true }).click();
  await expect(page.getByRole("heading", { name: "NVIDIA", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove saved NVDA", exact: true }).click();
  await expect(saved.getByRole("button", { name: "NVDA", exact: true })).toHaveCount(0);
  const events = await page.evaluate(() => (window.dataLayer ?? []).map((item) => Array.from(item as ArrayLike<unknown>)));
  expect(events.some((event) => event[1] === "graph_saved_company_open")).toBe(true);
  expect(events.some((event) => event[1] === "graph_save_complete")).toBe(true);
});

test("failed save does not claim success and can be retried", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  let fail = true;
  await page.route("**/api/industry-graph/saved", async (route) => {
    const write = route.request().method() === "POST";
    await route.fulfill({ status: write && fail ? 503 : 200, json: { tickers: write && !fail ? ["MU"] : [] } });
  });
  await page.goto(`${origin}/?company=MU`);
  await page.getByRole("button", { name: "Save MU", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Could not confirm the change");
  const events = await page.evaluate(() => (window.dataLayer ?? []).map((item) => Array.from(item as ArrayLike<unknown>)));
  expect(events.some((event) => event[1] === "graph_save_complete")).toBe(false);
  fail = false;
  await page.getByRole("button", { name: "Save MU", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("MU saved to your account.");
});

test("changing accounts hides prior saves and ignores a late save response", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  let reads = 0;
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/industry-graph/saved", async (route) => {
    if (route.request().method() === "POST") {
      await wait;
      return route.fulfill({ json: { tickers: ["NVDA", "MU"] } });
    }
    reads++;
    return route.fulfill({ json: { tickers: reads === 1 ? ["MU"] : ["AMD"] } });
  });
  await page.goto(`${origin}/?company=NVDA`);
  const saved = page.getByRole("region", { name: "Your saved companies" });
  await expect(saved.getByRole("button", { name: "MU", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save NVDA", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-auth-user", { detail: null })));
  await expect(saved).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in to save NVDA" })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-auth-user", { detail: "another-user" })));
  await expect(saved.getByRole("button", { name: "AMD", exact: true })).toBeVisible();
  const completed = page.waitForResponse((response) => response.url().endsWith("/api/industry-graph/saved") && response.request().method() === "POST");
  release!();
  await completed;
  await expect(saved.getByRole("button", { name: "AMD", exact: true })).toBeVisible();
  await expect(saved.getByRole("button", { name: "MU", exact: true })).toHaveCount(0);
  await expect(saved.getByRole("button", { name: "NVDA", exact: true })).toHaveCount(0);
});
