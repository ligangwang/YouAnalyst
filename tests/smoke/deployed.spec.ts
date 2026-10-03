import { expect, test } from "@playwright/test";
import { isMapTicker } from "../../src/lib/industry-graph/directory";

test("listed A-share pages offer calls in both languages while private companies do not", async ({ page }) => {
  for (const [locale, bullish, bearish] of [["en", "Bullish", "Bearish"], ["zh-cn", "看多", "看空"]]) {
    await page.goto(`/${locale}/ticker/XSHG:600584`);
    await expect(page.getByRole("link", { name: bullish, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: bearish, exact: true })).toBeVisible();
  }
  await page.goto("/en/company/ORG:OPENAI");
  const privateHeading = page.getByRole("heading", { level: 1 });
  await expect(privateHeading).toBeVisible();
  await expect(privateHeading).toHaveText("OpenAI");
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
    const response = await request.get(`/${prefix}?view=graph`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(`lang="${language}"`);
    expect(html).toContain(heading);
    expect(html).toMatch(new RegExp(`<link[^>]+rel="canonical"[^>]+href="[^"]+/${prefix}"`));
    expect(html).toContain('hrefLang="en"');
    expect(html).toContain('hrefLang="zh-CN"');
    // The collapsed company directory ships no company links; research teasers elsewhere on the page may link companies.
    const directoryLabel = prefix === "en" ? "AI companies and supply chain" : "AI 公司与产业链";
    const directoryHtml = sectionHtml(html, directoryLabel);
    expect(directoryHtml).toBeTruthy();
    expect(directoryHtml).not.toContain(`href="/${prefix}/ticker/NVDA"`);
    expect(directoryHtml).not.toContain(`href="/${prefix}/ticker/XSHG:688041"`);
    await page.goto(`/${prefix}?view=graph`);
    const directory = page.getByRole("region", { name: directoryLabel, exact: true });
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

test("Investment Intelligence homepage renders real data and crawlable research links", async ({ request, page }) => {
  test.setTimeout(90_000);
  // Check settled label visibility without sampling the continuous tour's fades.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const response = await request.get("/api/intelligence");
  expect(response.status()).toBe(200);
  const snapshot = await response.json();
  expect(snapshot.graph.nodes.some((node: { id: string }) => node.id === "US:NVDA")).toBe(true);
  expect(snapshot.graphVersion).toBeTruthy();
  expect(Array.isArray(snapshot.events)).toBe(true);
  expect(snapshot.coverage.find((source: { channel: string }) => source.channel === "SEC")).toBeTruthy();
  for (const event of snapshot.events) {
    expect(event.evidence.length).toBeGreaterThan(0);
    for (const source of event.evidence) expect(source.url.startsWith("https://")).toBe(true);
  }
  for (const [prefix, heading] of [["en", "Investment Intelligence"], ["zh-cn", "投资情报"]]) {
    const home = await request.get(`/${prefix}`);
    expect(home.status()).toBe(200);
    const html = await home.text();
    expect(html).toContain(heading);
    expect(html).toContain(`href="/${prefix}/research/nvidia-ai-ecosystem"`);
    expect(html).toContain(`href="/${prefix}/research/amd-ai-ecosystem"`);
    await page.goto(`/${prefix}`);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Sector color legend", exact: true })).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.locator('[data-company-id="US:NVDA"]')).toHaveCount(1, { timeout: 20_000 });
    await expect.poll(() => page.locator('[data-company-id][data-visible="false"]').evaluateAll(elements => elements.length > 0 && elements.every(el => getComputedStyle(el).visibility === "hidden" && Number(getComputedStyle(el).opacity) === 0))).toBe(true);
  }
});
test("retired filing event API is unavailable", async ({ request }) => {
  expect((await request.get("/api/events")).status()).toBe(404);
  expect((await request.get("/api/events/stream")).status()).toBe(404);
});

/** The complete `<section aria-label=…>` element, including nested sections, or undefined if absent or unbalanced. */
function sectionHtml(html: string, label: string) {
  const open = html.search(new RegExp(`<section\\b[^>]*aria-label="${label}"`));
  if (open < 0) return undefined;
  const tags = /<section\b|<\/section>/g;
  tags.lastIndex = open;
  let depth = 0;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[0] === "</section>" ? -1 : 1;
    if (depth === 0) return html.slice(open, tags.lastIndex);
  }
  return undefined;
}

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

test("feed shows research updates without filing features", async ({ page, request }) => {
  await page.goto("/feed");
  await expect(page.getByRole("heading", { name: "Company research updates", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Event types" })).toHaveCount(0);
  for (const path of ["/en/institutions", "/zh-cn/daily/insiders", "/daily/institutional", "/api/insider-transactions/AMD", "/api/institutional-holdings/AMD"]) {
    expect((await request.get(path)).status()).toBe(404);
  }
  const response = await request.get("/api/events?type=SEC_FORM4");
  expect(response.status()).toBe(404);
});

test("homepage defaults to graph and supports all four industry views", async ({ page, request }) => {
  const response = await request.get("/api/knowledge-graph");
  expect(response.ok()).toBeTruthy();
  const graph = await response.json();
  const count = graph.nodes.filter((node: { kind: string }) => node.kind === "COMPANY").length;
  await page.goto("/?market=US&graphMarkets=US&lang=en");
  await expect(page.getByRole("heading", { name: "AI Industry Map", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(US stocks|A-shares|Global & private|2D|3D|Fit|Rotate right|Zoom in)$/ })).toHaveCount(0);
  await expect(page.locator('span[role="status"]')).toContainText(`${count} companies`);
  await expect(page.getByRole("tab", { name: "Relationship graph", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  await page.getByRole("tab", { name: "Company list", exact: true }).click();
  await expect(page.locator('[data-list-company]')).toHaveCount(Math.min(count,50));
  await expect(page.getByRole('navigation',{name:'Company list pagination'})).toContainText(`of ${count} companies`);
  await page.getByRole("tab", { name: "Industry tree", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Vertical tree", exact: true })).toBeVisible();
  await expect(page.locator('[data-industry-tree="vertical"] canvas')).toBeVisible();
  await page.getByRole("tab", { name: "Company hierarchy", exact: true }).click();
  await expect(page.locator('[data-industry-tree="hierarchy"] svg')).toBeVisible();
  await expect(page.locator('[data-industry-tree="hierarchy"] canvas')).toHaveCount(0);
  await page.getByRole("tab", { name: "Relationship graph", exact: true }).click();
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
    // Country flag alt text is part of the accessible name, but not the company title.
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(company.name);
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
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText("海光信息");
  await expect(heading.getByRole("img", { name: "中国", exact: true })).toBeVisible();
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

test("company search remains available", async ({ page }) => {
  await page.goto("/companies");

  // General search remains separate from the industry map.
  await expect(page.getByRole("combobox", { name: "Company or ticker" })).toBeVisible();
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
