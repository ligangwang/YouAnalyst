import { expect, test } from "@playwright/test";
import { buildIndustryFixture } from "../industry/html";
import { fixtureGraph, runFixture } from "../industry/fixtures";
import { buildIndustryGraph } from "../industry/fixtures";
import { buildIndustryGraph as buildPublishedGraph } from "../../src/lib/industry-graph/model";
import { INDUSTRY_STARTERS } from "../../src/lib/industry-graph/catalog";
import relationshipReviews from "../../src/lib/company-graph/relationship-reviews.json";
import { mergeResearchGraph, normalizeResearch } from "../../src/lib/industry-research/model";

const origin = "http://industry.test";
test("homepage shows existing watchlist calls and resets them when selecting another company", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  await page.route("**/api/ticker/*/my-calls", route => route.fulfill({ json: { items: route.request().url().includes("/AMD/") ? [
    { id: "amd-main", watchlistId: "main", watchlistName: "My Watchlist", isDefault: true, visibility: "Public", direction: "UP", status: "OPEN", createdAt: "2026-09-07T18:00:00Z", entryDate: "2026-09-08", entryPrice: 150.25, cancelUntil: null },
    { id: "amd-hedge", watchlistId: "hedge", watchlistName: "Hedges", isDefault: false, visibility: "Private", direction: "DOWN", status: "OPEN", createdAt: "2026-09-07T18:00:00Z", entryDate: "2026-09-08", entryPrice: 150.25, cancelUntil: null },
  ] : [] } }));
  await page.goto(origin);
  await page.getByRole("button", { name: "Explore AMD (AMD)", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close Bullish", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close Bearish", exact: true })).toBeVisible();
  await expect(page.getByText("Default watchlist · Public")).toBeVisible();
  await expect(page.getByText("Entry $150.25 · recorded 2026-09-08")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Bullish", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Explore NVIDIA (NVDA)", exact: true }).click();
  await expect(page.getByRole("link", { name: "Bullish", exact: true })).toHaveAttribute("href", /ticker=NVDA/);
  await expect(page.getByRole("button", { name: /Close Bullish|Close Bearish/ })).toHaveCount(0);
});

test("published industry research is discoverable and never shown as an SEC quotation", async ({ page }) => {
  const url = "https://www.example.com/announcement";
  const research = normalizeResearch({ companies: [
    { ticker: "ASML", name: "ASML", segment: "manufacturing" }, { ticker: "TSM", name: "TSMC", segment: "manufacturing" },
  ], relationships: [{ source: "ASML", target: "TSM", type: "SUPPLIER_OF", url, title: "Research source", summary: "Synthetic research summary.", sourceDate: "2026-01-01" }] }, [url]);
  const graph = mergeResearchGraph(buildPublishedGraph({}), research.companies, research.relationships);
  await page.route("**/api/industry-graph*", route => route.fulfill({ json: graph }));
  await page.goto(origin);
  await page.getByRole("button", { name: "Explore ASML (ASML)", exact: true }).click();
  await page.getByRole("button", { name: /ASML supplies TSMC/ }).last().click();
  await expect(page.getByRole("heading", { name: "ASML supplies TSMC" })).toBeVisible();
  await expect(page.getByText("Synthetic research summary.", { exact: true })).toBeVisible();
  await expect(page.locator("blockquote")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Research source/ })).toHaveAttribute("href", url);
  await expect(page.getByRole("link", { name: /Read SEC filing/ })).toHaveCount(0);
});
let html: string;
test.beforeAll(async () => { html = await buildIndustryFixture(); });
test.beforeEach(async ({ page }) => {
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET" || url.origin !== origin) return route.abort();
    if (url.pathname === "/api/industry-graph") return route.fulfill({ json: fixtureGraph });
    if (/^\/api\/ticker\/[^/]+\/my-calls$/.test(url.pathname)) return route.fulfill({ json: { items: [] } });
    if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    return route.abort();
  });
});

test("Sandisk is visible in the overview, searchable and keeps registration context", async ({ page }) => {
  await page.goto(origin);
  await expect(page.getByRole("button", { name: "Explore Sandisk (SNDK)", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explore Western Digital (WDC)", exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("SNDK");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sandisk", exact: true })).toBeVisible();
  await expect(page.getByText(/company’s own filing has not been added/)).toBeVisible();
  await expect(page.getByRole("link", { name: "View SNDK company page" })).toHaveAttribute("href", "/ticker/SNDK");
  await expect(page.getByRole("link", { name: "Bullish", exact: true })).toHaveAttribute("href", /ticker%3DSNDK.*direction%3DUP/);
});

test("homepage explores real component, evidence, supplier direction and expansion", async ({ page }) => {
  await page.goto(origin);
  await expect(page.getByText(`3 / ${INDUSTRY_STARTERS.length}`, { exact: true })).toBeVisible();
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
  await expect(page.getByText(`3 / ${INDUSTRY_STARTERS.length}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByLabel("Relationship type").selectOption("COMPETES_WITH");
  await expect(page.getByRole("region", { name: /Scrollable industry map/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /AMD competes with NVIDIA/ })).toHaveCount(1);
  await page.getByRole("button", { name: /AMD competes with NVIDIA/ }).click();
  await expect(page.getByRole("heading", { name: "AMD competes with NVIDIA" })).toBeVisible();
});

test("search selects a company, keeps prediction context, and never sends raw query to GA", async ({ page }) => {
  await page.goto(origin);
  await expect(page.getByText(`3 / ${INDUSTRY_STARTERS.length}`, { exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("private@example.invalid");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByText(/No match on this page/)).toBeVisible();
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
  await page.route(/\/api\/industry-graph(?:\?.*)?$/, (route) => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.goto(origin);
  await expect(page.getByText(/temporarily unavailable/)).toBeVisible();
  await page.route(/\/api\/industry-graph(?:\?.*)?$/, (route) => route.fulfill({ json: buildIndustryGraph({}) }));
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(/Published filing relationships will appear/)).toBeVisible();
  await expect(page.getByText(`${INDUSTRY_STARTERS.length} nodes · 0 connections`)).toBeVisible();
});

test("deep links focus the company and layout does not overflow the viewport", async ({ page }) => {
  await page.goto(`${origin}/?company=MU`);
  await expect(page.getByRole("heading", { name: "Micron", exact: true })).toBeVisible();
  const companyLink = page.getByRole("link", { name: "View MU company page" });
  await expect(companyLink).toHaveAttribute("href", "/ticker/MU");
  await expect(companyLink).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("staging opt-out and analytics failures do not break exploration", async ({ page }) => {
  await page.route(origin + "/", (route) => route.fulfill({ contentType: "text/html", body: html.replace('content="enabled"', 'content="disabled"') }));
  await page.goto(origin);
  await expect(page.getByText(`3 / ${INDUSTRY_STARTERS.length}`, { exact: true })).toBeVisible();
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
  await page.route(/\/api\/industry-graph(?:\?.*)?$/, (route) => route.fulfill({ json: graph }));
  await page.goto(`${origin}/?company=MU`);
  await expect(page.getByRole("heading", { name: "Micron", exact: true })).toBeVisible();
  await expect(page.getByText(/company’s own filing has not been added/)).toBeVisible();
  await page.getByRole("button", { name: "Micron supplies NVIDIA", exact: false }).last().click();
  await expect(page.locator("blockquote")).toContainText("Synthetic test evidence");
  await expect(page.getByText(/pending identity review/)).toBeVisible();
});

test("overview reveals mentions on demand and resets cleanly after focusing a neighbor", async ({ page }) => {
  await page.goto(origin);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.getByText(`3 / ${INDUSTRY_STARTERS.length}`, { exact: true })).toBeVisible();
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
  await expect(page.getByText(`3 / ${INDUSTRY_STARTERS.length}`, { exact: true })).toBeVisible();
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
  await page.route(/\/api\/industry-graph(?:\?.*)?$/, (route) => route.fulfill({ json: graph }));
  await page.goto(origin);
  await expect(page.getByRole("button", { name: "Explore TSMC (TSM)", exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("Taiwan Semiconductor Manufacturing");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByRole("heading", { name: "TSMC", exact: true })).toBeVisible();
  await expect(page.getByText(/This company files a 20-F/)).toBeVisible();
  await expect(page.getByRole("link", { name: "View TSM company page" })).toHaveAttribute("href", "/ticker/TSM");
  await page.getByRole("button", { name: "TSMC supplies NVIDIA 1 source →", exact: true }).click();
  await expect(page.locator("blockquote")).toContainText("Synthetic test evidence");
  await expect(page.getByRole("link", { name: "Read SEC filing" })).toHaveAttribute("href", /\/1045810\//);
});

test("corrected OEM evidence shows distributor direction and the review explanation", async ({ page }) => {
  const expected = relationshipReviews.find((review) => review.expected.sourceTicker === "MSFT" && review.expected.targetName === "Dell")!.expected;
  const run = runFixture("MSFT", expected.sourceCik, "Microsoft", [expected]);
  run.result.filing.accessionNumber = expected.accessionNumber;
  await page.route(/\/api\/industry-graph(?:\?.*)?$/, (route) => route.fulfill({ json: buildIndustryGraph({ MSFT: run }) }));
  await page.goto(`${origin}/?company=MSFT`);
  await page.getByRole("button", { name: "Dell distributes for Microsoft 1 source →", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dell distributes for Microsoft", exact: true })).toBeVisible();
  await expect(page.getByText(/Evidence reviewed 2026-09-08/)).toBeVisible();
  await expect(page.locator("blockquote")).toContainText("distribution agreements");
  await expect(page.getByRole("link", { name: "Read SEC filing" })).toHaveAttribute("href", /\/789019\//);
});

test("a visitor can inspect evidence before choosing contextual registration", async ({ page }) => {
  await page.goto(`${origin}/?company=NVDA`);
  await expect(page.getByRole("link", { name: "Bullish" })).toHaveAttribute("href", "/auth?next=%2Fpredictions%2Fnew%3Fticker%3DNVDA%26direction%3DUP&mode=register");
  await expect(page.getByRole("button", { name: "Micron supplies NVIDIA 1 source →" })).toBeVisible();
  await page.getByRole("link", { name: "Bullish" }).click();
  await expect(page).toHaveURL(`${origin}/auth?next=%2Fpredictions%2Fnew%3Fticker%3DNVDA%26direction%3DUP&mode=register`);
});

test("signed-in direction actions preserve company and bypass registration", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  await page.route("**/api/industry-graph/saved", route => route.fulfill({ json: { tickers: ["NVDA"] } }));
  await page.goto(`${origin}/?company=NVDA`);
  await expect(page.getByRole("link", { name: "Bullish", exact: true })).toHaveAttribute("href", "/predictions/new?ticker=NVDA&direction=UP");
  await expect(page.getByRole("link", { name: "Bearish", exact: true })).toHaveAttribute("href", "/predictions/new?ticker=NVDA&direction=DOWN");
  await expect(page.getByRole("button", { name: "Save NVDA", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your saved companies" })).toHaveCount(0);
});
test("company search opens evidence without suggesting question answering", async ({ page }) => {
  await page.goto(origin);
  await expect(page.getByRole("region", { name: "Start with a question" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Who supplies|Who does/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole("searchbox", { name: "Find a company in the map" }).fill("NVIDIA");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByRole("combobox", { name: "Relationship type" }).selectOption("SUPPLIER_OF");
  await expect(page.getByRole("button", { name: "Evidence: AMD competes with NVIDIA", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Micron supplies NVIDIA 1 source →", exact: true }).click();
  await expect(page.locator("blockquote")).toContainText("Synthetic test evidence");
  await expect(page.getByRole("link", { name: "Read SEC filing" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bullish" })).toHaveAttribute("href", "/auth?next=%2Fpredictions%2Fnew%3Fticker%3DNVDA%26direction%3DUP&mode=register");
  const save = page.getByRole("link", { name: "Bullish" });
  await save.evaluate((link) => link.addEventListener("click", (event) => event.preventDefault()));
  await save.click();
  const events = await page.evaluate(() => (window.dataLayer ?? []).map((item) => Array.from(item as ArrayLike<unknown>)));
  expect(events.some((event) => event[1] === "graph_discovery_open")).toBe(false);
  expect(events.some((event) => event[1] === "graph_search")).toBe(true);
  expect(events.some((event) => event[1] === "graph_predict_click" && (event[2] as { entry_point?: string }).entry_point === "evidence")).toBe(true);
  await page.getByRole("button", { name: "Reset map", exact: true }).click();
  await expect(page.getByRole("region", { name: "Start with a question" })).toHaveCount(0);
});

test("company selection retains evidence saving and relationship filters", async ({ page }) => {
  await page.goto(origin);
  await page.getByRole("searchbox", { name: "Find a company in the map" }).fill("Micron");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByRole("button", { name: "Micron supplies NVIDIA 1 source →", exact: true }).click();
  await expect(page.getByRole("link", { name: "Bullish" })).toBeVisible();
  await page.getByRole("combobox", { name: "Relationship type" }).selectOption("COMPETES_WITH");
  await expect(page.getByText("Company connections", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Evidence: Micron supplies NVIDIA", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reset map", exact: true }).click();
  await page.getByRole("searchbox", { name: "Find a company in the map" }).fill("NVIDIA");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByRole("button", { name: "Explore Micron (MU)", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Relationship type" })).toHaveValue("all");
  await expect(page.getByText("Company connections", { exact: true })).toBeVisible();
});

test("empty graph does not advertise discovery claims", async ({ page }) => {
  await page.route(/\/api\/industry-graph(?:\?.*)?$/, (route) => route.fulfill({ json: buildIndustryGraph({}) }));
  await page.goto(origin);
  await expect(page.getByText(/Published filing relationships will appear here/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Start with a question" })).toHaveCount(0);
});

test("published company pages navigate forward and back without a fixed company list", async ({ page }, testInfo) => {
  const second = buildPublishedGraph({ CRM: runFixture("CRM", "0001108524", "Salesforce", [{ targetName: "Example Supplier" }]) });
  await page.route(/\/api\/industry-graph(?:\?.*)?$/, (route) => {
    const after = new URL(route.request().url()).searchParams.get("after");
    return route.fulfill({ json: after ? { ...second, nextCursor: null } : { ...fixtureGraph, nextCursor: "NVDA_latest_10k" } });
  });
  await page.goto(origin);
  await expect(page.getByRole("button", { name: "Next companies", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Next companies", exact: true }).click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explore Salesforce (CRM)", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next companies", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Explore Salesforce (CRM)", exact: true }).click();
  await expect(page.getByRole("link", { name: "View CRM company page" })).toHaveAttribute("href", "/ticker/CRM");
  await expect(page.getByRole("link", { name: "Bullish" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("data-driven-map.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "Previous companies", exact: true }).click();
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explore NVIDIA (NVDA)", exact: true })).toBeVisible();
});

test("exact ticker lookup reaches companies outside the current page and handles missing coverage", async ({ page }) => {
  const company = buildPublishedGraph({ CRM: runFixture("CRM", "0001108524", "Salesforce", []) });
  await page.route(/\/api\/industry-graph(?:\?.*)?$/, (route) => {
    const ticker = new URL(route.request().url()).searchParams.get("company");
    return route.fulfill({ json: ticker === "CRM" ? company : ticker ? buildPublishedGraph({}) : fixtureGraph });
  });
  await page.goto(origin);
  await page.getByRole("searchbox").fill("CRM");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Salesforce", exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("MISSING");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "No company or published filing coverage found for MISSING." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Salesforce", exact: true })).toHaveCount(0);
});
