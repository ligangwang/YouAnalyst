import { expect, test } from "@playwright/test";
import { isMapTicker } from "../../src/lib/industry-graph/directory";
import { publicEventFromDocument } from "../../src/lib/events/model";

test("listed A-share pages offer calls in both languages while private companies do not", async ({ page }) => {
  for (const [locale, bullish, bearish] of [["en", "Bullish", "Bearish"], ["zh-cn", "看多", "看空"]]) {
    await page.goto(`/${locale}/ticker/XSHG:600584`);
    await expect(page.getByRole("link", { name: bullish, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: bearish, exact: true })).toBeVisible();
  }
  await page.goto("/en/company/ORG:OPENAI");
  await expect(page.getByRole("heading", { name: "OpenAI", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^(Bullish|Bearish)$/ })).toHaveCount(0);
});

test("filing research uses the consolidated research store", async ({ request }) => {
  const response = await request.get("/api/company-graph/NVDA");
  expect(response.status()).toBe(200);
  expect(response.headers()["x-research-storage"]).toBe("company_research_runs");
  const body = await response.json();
  expect(body.ticker).toBe("NVDA");
  expect(Array.isArray(body.edges)).toBe(true);
});

test("AI map reads shared company relationships with preserved evidence", async ({ request }) => {
  const response = await request.get("/api/knowledge-graph");
  expect(response.status()).toBe(200);
  expect(response.headers()["x-graph-storage"]).toBe("company_relationships");
  const graph = await response.json();
  const companies = graph.nodes.filter((n: { kind: string }) => n.kind === "COMPANY");
  expect(companies.length).toBeGreaterThanOrEqual(129);
  expect(companies.some((n: { id: string }) => n.id === "US:NVDA")).toBe(true);
  expect(companies.some((n: { id: string }) => n.id === "XSHG:688041")).toBe(true);
  const edges = graph.relationships.filter((e: { type: string }) => e.type !== "PARTICIPATES_IN");
  expect(edges.length).toBeGreaterThanOrEqual(31);
  for (const edge of edges) {
    expect(edge.sourceIds.length).toBeGreaterThan(0);
    for (const id of edge.sourceIds) expect(graph.sources.some((s: { id: string; url: string }) => s.id === id && s.url.startsWith("https://"))).toBe(true);
  }
});

test("sitemap index exposes bounded bilingual company sitemaps", async ({ request }) => {
  test.setTimeout(60_000);
  const index = await request.get("/sitemap.xml");
  expect(index.status()).toBe(200);
  const body = await index.text();
  expect(body).toContain("<sitemapindex");
  expect(body).toContain("/sitemaps/companies/US-N.xml");
  expect(body).toContain("/sitemaps/companies/XSHG-6.xml");
  for (const [bucket, company] of [["US-N", "NVDA"], ["XSHG-6", "XSHG%3A688041"]]) {
    const response = await request.get(`/sitemaps/companies/${bucket}.xml`);
    expect(response.status()).toBe(200);
    const xml = await response.text();
    expect(xml).toContain(`/en/ticker/${company}`);
    expect(xml).toContain(`/zh-cn/ticker/${company}`);
    expect(xml).toContain('hreflang="zh-CN"');
  }
});

test("English and Chinese map URLs retain SEO and load company links on expansion", async ({ request, page }) => {
  test.setTimeout(90_000);
  for (const [prefix, language, heading] of [["en", "en", "AI Industry Map"], ["zh-cn", "zh-CN", "AI 产业图谱"]]) {
    const response = await request.get(`/${prefix}`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(`lang="${language}"`);
    expect(html).toContain(heading);
    expect(html).toMatch(new RegExp(`<link[^>]+rel="canonical"[^>]+href="[^"]+/${prefix}"`));
    expect(html).toContain('hrefLang="en"');
    expect(html).toContain('hrefLang="zh-CN"');
    expect(html).not.toContain(`href="/${prefix}/ticker/NVDA"`);
    expect(html).not.toContain(`href="/${prefix}/ticker/XSHG:688041"`);
    await page.goto(`/${prefix}`);
    const directory = page.getByRole("region", { name: prefix === "en" ? "AI companies and supply chain" : "AI 公司与产业链", exact: true });
    await expect(directory.locator("li")).toHaveCount(0);
    await directory.locator("summary").click();
    await expect(directory.locator(`a[href="/${prefix}/ticker/NVDA"]`).first()).toBeVisible({ timeout: 20_000 });
    await expect(directory.locator(`a[href="/${prefix}/ticker/XSHG:688041"]`).first()).toBeVisible();
    await directory.locator("summary").click();
    await expect(directory.locator("li")).toHaveCount(0);
  }
  const legacy = await request.get("/map?lang=zh-CN&market=CN_A&company=XSHG%3A688041", { maxRedirects: 0 });
  expect([307, 308]).toContain(legacy.status());
  const target = new URL(legacy.headers().location, legacy.url());
  expect(target.pathname).toBe("/zh-cn");
  expect(target.searchParams.get("company")).toBe("XSHG:688041");
  expect(target.searchParams.get("market")).toBe("CN_A");
});

test("public event API returns a bounded page of approved public facts", async ({ request }) => {
  const response = await request.get("/api/events?limit=2");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Array.isArray(body.items)).toBe(true);
  expect(body.items.length).toBeLessThanOrEqual(2);
  for (const event of body.items) expect(publicEventFromDocument(event.id, event)).toEqual(event);
  expect(body.nextCursor === null || typeof body.nextCursor === "string").toBe(true);
  expect((await request.get("/api/events?limit=500")).status()).toBe(400);
});

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
  const response = await request.get("/api/knowledge-graph/saved", { headers: savedCompanyHeaders() });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"].split(/,\s*/)).toEqual(expect.arrayContaining(["private", "no-store"]));
});

test("default watchlist creation requires a user session", async ({ request }) => {
  const response = await request.post("/api/watchlists/default", { headers: savedCompanyHeaders() });
  expect(response.status()).toBe(401);
});

test("personal company calls require a user session and cannot be publicly cached", async ({ request }) => {
  const response = await request.get("/api/ticker/AMD/my-calls", { headers: savedCompanyHeaders() });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"].split(/,\s*/)).toEqual(expect.arrayContaining(["private", "no-store"]));
});

test("authenticated saved-company reads reach the private account store", async ({ request }) => {
  const userToken = process.env.PLAYWRIGHT_FIREBASE_ID_TOKEN;
  test.skip(!userToken, "Requires a separate Firebase user ID token, not the Cloud Run service identity token");
  const response = await request.get("/api/knowledge-graph/saved", { headers: savedCompanyHeaders(userToken) });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"].split(/,\s*/)).toEqual(expect.arrayContaining(["private", "no-store"]));
  const result = await response.json();
  expect(Array.isArray(result.tickers)).toBe(true);
  expect(result.tickers.every(isMapTicker)).toBe(true);
});

test("Cloud Run service identity does not grant access to saved companies", async ({ request }) => {
  const serviceToken = process.env.PLAYWRIGHT_AUTH_BEARER_TOKEN;
  test.skip(!serviceToken, "Requires the deployment service identity");
  const response = await request.get("/api/knowledge-graph/saved", { headers: savedCompanyHeaders(serviceToken) });
  expect(response.status()).toBe(401);
});

test("feed remains accessible through More navigation", async ({ page }) => {
  await page.goto("/");
  await page.locator("header summary").filter({ hasText: /^More$/, visible: true }).click();
  await page.getByRole("link", { name: "Feed", exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/feed$/);
  await expect(page.getByRole("heading", { name: "Latest", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Explore company connections.", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /^Live$/ })).toBeVisible({ timeout: 20_000 });
  const first = page.getByRole("article").first();
  if (await first.count()) {
    await expect(first.locator("button time")).toHaveText(/^(now|\d+(m|h|d|mo|y))$/);
    await expect(first).not.toContainText("Added");
  }
});

test("event filters navigate between live categories", async ({ page, request }) => {
  await page.goto("/feed");
  for (const [label, type] of [["Insider activity", "SEC_FORM4"], ["Institutional holdings", "SEC_13F"]]) {
    await page.getByRole("navigation", { name: "Event types" }).getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`type=${type}`));
    await expect(page.getByRole("navigation", { name: "Event types" }).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("status").filter({ hasText: /^Live$/ })).toBeVisible({ timeout: 20_000 });
    const response = await request.get(`/api/events?type=${type}&limit=2`);
    expect(response.status()).toBe(200);
    for (const event of (await response.json()).items) expect(event.type).toBe(type);
  }
  await page.getByRole("navigation", { name: "Event types" }).getByRole("link", { name: "All", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Live$/ })).toBeVisible({ timeout: 20_000 });
});

test("homepage AI knowledge graph shows all companies without market controls", async ({ page, request }) => {
  const response = await request.get("/api/knowledge-graph");
  expect(response.ok()).toBeTruthy();
  const graph = await response.json();
  const count = graph.nodes.filter((node: { kind: string }) => node.kind === "COMPANY").length;
  await page.goto("/?market=US&graphMarkets=US&lang=en");
  await expect(page.getByRole("heading", { name: "AI Industry Map", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(US stocks|A-shares|Global & private|2D|3D|Fit|Rotate right|Zoom in)$/ })).toHaveCount(0);
  await expect(page.locator('span[role="status"]')).toContainText(`${count} companies`);
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  await page.reload();
  await expect(page.locator('span[role="status"]')).toContainText(`${count} companies`);
});

test("global map companies open localized profiles", async ({ page, request }) => {
  const response = await request.get("/api/knowledge-graph");
  expect(response.ok()).toBeTruthy();
  const graph = await response.json();
  const company = graph.nodes.find((n: { kind: string; market?: string; id: string }) => n.kind === "COMPANY" && n.market === "GLOBAL" && n.id.startsWith("ORG:"));
  test.skip(!company, "No global company has been published in this environment");
  for (const locale of ["en", "zh-cn"]) {
    const profile = await page.goto(`/${locale}/company/${encodeURIComponent(company.id)}`);
    expect(profile?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: company.name, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: locale === "en" ? "Company overview" : "公司概览", exact: true })).toBeVisible();
  }
});

test("Research bookmarks open Feed and Feed is in primary navigation", async ({ page }) => {
  await page.goto("/en/map?view=filings&company=AMD");
  await expect(page).toHaveURL(/\/en\/feed$/);
  const feed = page.getByRole("navigation").getByRole("link", { name: "Feed", exact: true });
  await expect(feed).toBeVisible();
  await expect(feed).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Research", exact: true })).toHaveCount(0);
});

test("A-share company has its own research page", async ({ page }) => {
  await page.goto("/ticker/XSHG:688041?lang=zh-CN");
  await expect(page.getByRole("heading", { name: "海光信息", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "公司概览", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "资料来源", exact: true })).toBeVisible();
});

test("map save registration opens account creation with company context", async ({ page }) => {
  await page.goto("/auth?next=%2F%3Fcompany%3DNVDA&mode=register");
  await expect(page.getByRole("heading", { name: "Keep NVDA on your map", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Have an account? Sign in", exact: true })).toBeVisible();
});

test("industry graph is retired and identifies the shared replacement", async ({ request }) => {
  const response = await request.get("/api/industry-graph");
  expect(response.status()).toBe(410);
  expect((await response.json()).replacement).toBe("/api/knowledge-graph");
  const saved = await request.get("/api/industry-graph/saved", { maxRedirects: 0 });
  expect(saved.status()).toBe(308);
  expect(new URL(saved.headers().location).pathname).toBe("/api/knowledge-graph/saved");
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
