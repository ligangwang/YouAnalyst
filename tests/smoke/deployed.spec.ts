import { expect, test } from "@playwright/test";
import { isMapTicker } from "../../src/lib/industry-graph/directory";

function savedCompanyHeaders(userToken?: string): Record<string, string> {
  const serviceToken = process.env.PLAYWRIGHT_AUTH_BEARER_TOKEN;
  return {
    // Cloud Run service access is independent of a Firebase application session.
    ...(serviceToken ? { "X-Serverless-Authorization": `Bearer ${serviceToken}` } : {}),
    Authorization: userToken ? `Bearer ${userToken}` : "",
  };
}

test("health endpoint reports ok", async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/api/health`);
  expect(response.ok()).toBeTruthy();

  const health = await response.json();
  expect(health.status).toBe("ok");
  expect(health.service).toBe("ifindata-web");
});

test("saved map companies require authentication and cannot be publicly cached", async ({ request }) => {
  const response = await request.get("/api/industry-graph/saved", { headers: savedCompanyHeaders() });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"].split(/,\s*/)).toEqual(expect.arrayContaining(["private", "no-store"]));
});

test("default watchlist creation requires a user session", async ({ request }) => {
  const response = await request.post("/api/watchlists/default", { headers: savedCompanyHeaders() });
  expect(response.status()).toBe(401);
});

test("authenticated saved-company reads reach the private account store", async ({ request }) => {
  const userToken = process.env.PLAYWRIGHT_FIREBASE_ID_TOKEN;
  test.skip(!userToken, "Requires a separate Firebase user ID token, not the Cloud Run service identity token");
  const response = await request.get("/api/industry-graph/saved", { headers: savedCompanyHeaders(userToken) });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"].split(/,\s*/)).toEqual(expect.arrayContaining(["private", "no-store"]));
  const result = await response.json();
  expect(Array.isArray(result.tickers)).toBe(true);
  expect(result.tickers.every(isMapTicker)).toBe(true);
});

test("Cloud Run service identity does not grant access to saved companies", async ({ request }) => {
  const serviceToken = process.env.PLAYWRIGHT_AUTH_BEARER_TOKEN;
  test.skip(!serviceToken, "Requires the deployment service identity");
  const response = await request.get("/api/industry-graph/saved", { headers: savedCompanyHeaders(serviceToken) });
  expect(response.status()).toBe(401);
});

test("homepage renders the AI industry map", async ({ page }) => {
  await page.goto("/");

  // Verify navigation is present
  await expect(page.getByRole("link", { name: "Feed", exact: true })).toBeVisible();
  const companySearch = page.getByRole("link", { name: "Search companies", exact: true });
  await expect(companySearch).toBeVisible();
  await expect(companySearch).toHaveAttribute("href", "/companies");
  
  await expect(page.getByRole("heading", { name: "Explore company connections.", exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Find a company in the map" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Map", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "List", exact: true })).toBeVisible();
});

test("map save registration opens account creation with company context", async ({ page }) => {
  await page.goto("/auth?next=%2F%3Fcompany%3DNVDA&mode=register");
  await expect(page.getByRole("heading", { name: "Keep NVDA on your map", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Have an account? Sign in", exact: true })).toBeVisible();
});

test("industry map serves bounded filing data", async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/api/industry-graph`);
  expect(response.ok()).toBeTruthy();
  const graph = await response.json();
  expect(Array.isArray(graph.nodes)).toBeTruthy();
  expect(Array.isArray(graph.edges)).toBeTruthy();
  expect(Array.isArray(graph.coveredTickers)).toBeTruthy();
  expect(graph.nodes.length).toBeGreaterThan(0);
  expect(graph.nodes.length).toBeLessThanOrEqual(101);
  expect(graph.edges.length).toBeLessThanOrEqual(120);
  for (const ticker of ["MU", "SNDK", "WDC"]) {
    expect(graph.nodes.filter((node: { ticker: string; segment: string }) => node.ticker === ticker && node.segment === "memory")).toHaveLength(1);
  }
  const nodeIds = new Set(graph.nodes.map((node: { id: string }) => node.id));
  for (const edge of graph.edges) {
    expect(nodeIds.has(edge.source)).toBeTruthy();
    expect(nodeIds.has(edge.target)).toBeTruthy();
    expect(edge.evidence.length).toBeGreaterThan(0);
  }
});

test("company and institution search remains available", async ({ page }) => {
  await page.goto("/companies");

  // General search remains separate from the industry map.
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
