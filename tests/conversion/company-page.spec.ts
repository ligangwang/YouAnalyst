import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile } from "node:fs/promises";

const origin = "http://company.test";
let html: string;
for (const hasHistory of [true, false]) {
  test(`company chart is ${hasHistory ? "below the quote" : "hidden without price history"}`, async ({ page }) => {
    let priceRequests = 0;
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
      if (url.pathname === "/api/company-timeline") {
        priceRequests++;
        const end = new Date().toISOString().slice(0, 10);
        return route.fulfill({ json: { companyId: "US:AMD", start: "2020-01-01", end, currency: "USD", available: true, prices: hasHistory ? [{ date: end, close: 150, volume: 1000 }] : [] } });
      }
      return route.fulfill({ json: { items: [], ticker: "AMD", nextCursor: null } });
    });
    await page.goto(origin);
    await expect.poll(() => priceRequests).toBeGreaterThan(0);
    const chart = page.locator("[data-company-timeline='US:AMD']");
    const card = chart.locator("..");
    if (hasHistory) {
      await expect(chart).toBeVisible();
      await expect(card).toBeVisible();
      expect(await card.evaluate(el => el.previousElementSibling?.getAttribute("aria-label"))).toBe("Stock quote");
      await expect(chart.locator("[data-volume-bar]")).toHaveCount(1);
    } else {
      await expect(card).toBeHidden();
      await expect(page.getByRole("heading", { name: "Events, price & volume", exact: true })).toBeHidden();
    }
  });
}
test.beforeAll(async () => {
  const bundled = await build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { LocaleProvider } from "./src/components/providers/locale-provider";
      import { TickerPage } from "./src/components/ticker-page";
      import { CompanyResearchOverview } from "./src/components/company-research-overview";
      import { CompanyFundamentalsView } from "./src/components/company-fundamentals";
      import { annualMetrics } from "./src/lib/fundamentals/model";
      import { buildCompanyResearch } from "./src/lib/company-research";
      import { fixtureGraph } from "./tests/industry/fixtures";
      const company = buildCompanyResearch("AMD", [], fixtureGraph);
      company.exchange = "NASDAQ";
      const report = { cik: "0000002488", accession: "0000002488-26-000010", form: "10-K", filed: "2026-02-01", end: "2025-12-27", url: "https://www.sec.gov/Archives/example.htm" };
      const data = { report, metrics: annualMetrics({cik:2488, facts:{"us-gaap":{Revenues:{units:{USD:[{val:1000000000,start:"2024-12-29",end:report.end,filed:report.filed,accn:report.accession,form:"10-K"}]}}}}}, report), excerpt: "Synthetic business excerpt for company-page testing.", fetchedAt: "2026-09-09T00:00:00Z" };
      const announcements=[{id:'latest',title:'AMD quarterly results',url:'https://ir.amd.com/results',date:'2026-07-30',channel:'IR',earnings:true}];
      const earningsSummary={companyId:'US:AMD',title:'Quarterly earnings exhibit',url:'https://www.sec.gov/Archives/edgar/data/2488/000000248826000010/ex991.htm',publishedDate:'2026-07-30',period:{start:'2026-03-29',end:'2026-06-27',type:'quarter',fiscalYear:2026,fiscalQuarter:2},metrics:[{name:'revenue',value:2000000000,unit:'USD',basis:'US_GAAP'}]};
      if (new URLSearchParams(location.search).has("marketCap")) data.marketCap = { status:"estimated",value:2500000000,currency:"USD",priceDate:"2026-09-18",shares:{date:"2026-08-01",filed:"2026-08-05",sourceUrl:"https://www.sec.gov/Archives/shares.htm"} };
      createRoot(document.getElementById("root")).render(<LocaleProvider locale={location.pathname.startsWith("/zh-cn") ? "zh-CN" : "en"}><TickerPage ticker="AMD" overview={<CompanyResearchOverview company={company} announcements={announcements} earningsSummary={earningsSummary} fundamentals={<CompanyFundamentalsView data={data} />} />} /></LocaleProvider>);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: "fixture.js", platform: "browser", define: { "process.env": "{}" },
    alias: { "next/link": path.resolve("tests/industry/link.tsx"), "@/components/providers/auth-provider": path.resolve("tests/conversion/fixtures/mocks.tsx") },
  });
  const css = await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: path.resolve("src/app/globals.css") });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${bundled.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? ""}${css.css}body{font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script>${bundled.outputFiles.find(file => file.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});

for (const predictionsAvailable of [true, false]) {
  test(`company research remains usable with predictions ${predictionsAvailable ? "available" : "unavailable"}`, async ({ page }, testInfo) => {
    const filingRequests: string[] = [];
    page.on("request", request => { if (/\/api\/(institutional-holdings|insider-transactions)\//.test(request.url())) filingRequests.push(request.url()); });
    page.on("pageerror", (error) => { throw error; });
    await page.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin || request.method() !== "GET") return route.abort();
      if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
      if (url.pathname === "/api/ticker/AMD" && predictionsAvailable) return route.fulfill({ json: { items: [], ticker: "AMD", nextCursor: null } });
      return route.fulfill({ status: 503, json: { error: "Test service unavailable" } });
    });
    await page.goto(predictionsAvailable ? `${origin}?marketCap=1` : origin);
    await expect(page.getByRole("heading", { name: "Advanced Micro Devices (AMD)", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Business and financials", exact: true })).toBeVisible();
    await expect(page.getByText("1B USD", { exact: true })).toBeVisible();
    await expect(page.getByRole('heading',{name:'Latest earnings · FY2026 Q2',exact:true})).toBeVisible();
    await expect(page.getByText('2B USD',{exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Annual financials',exact:true})).toBeVisible();
    await expect(page.getByText("Synthetic business excerpt for company-page testing.")).toBeHidden();
    await page.locator('details').filter({has:page.getByText("Synthetic business excerpt for company-page testing.")}).locator('summary').click();
    await expect(page.getByText("Synthetic business excerpt for company-page testing.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Filed 2026-02-01 ↗", exact: true })).toHaveAttribute("href", /sec.gov\/Archives\/edgar\/data\/2488\//);
    await expect(page.getByText("Estimated market cap", { exact: true })).toHaveCount(predictionsAvailable ? 1 : 0);
    await expect(page.getByText("Unavailable", { exact: true })).toHaveCount(5);
    if (predictionsAvailable) {
      await expect(page.getByText("2.5B USD", {exact:true})).toBeVisible();
      await expect(page.getByText("As of 2026-09-18", {exact:true})).toBeVisible();
      await page.getByText("Calculation details", {exact:true}).click();
      await expect(page.getByText("Share count as of 2026-08-01", {exact:true})).toBeVisible();
      await expect(page.getByRole("link", {name:"Filed 2026-08-05 ↗",exact:true})).toHaveAttribute("href","https://www.sec.gov/Archives/shares.htm");
    }
    await expect(page.getByRole("link", { name: "Bullish", exact: true })).toHaveAttribute("href", /ticker%3DAMD.*direction%3DUP/);
    await expect(page.getByRole("link", { name: "Bearish", exact: true })).toHaveAttribute("href", /ticker%3DAMD.*direction%3DDOWN/);
    await expect(page.getByRole("link", { name: "Research NVIDIA (NVDA)" })).toHaveAttribute("href", "/en/company/nvidia");
    await expect(page.getByRole("heading", { name: "Example Packaging supplies AMD", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Institutional holdings", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Insider transactions", exact: true })).toHaveCount(0);
    expect(filingRequests).toEqual([]);
    if (!predictionsAvailable) await expect(page.getByRole("status").filter({ hasText: "Unable to load ticker predictions" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("company-research.png"), fullPage: true });
    await page.getByText("Filing sources", { exact: false }).first().click();
    await expect(page.getByText("Synthetic test evidence", { exact: false }).first()).toBeVisible();
  });
}


test("Chinese company links retain the locale and supplied evidence", async ({ page }, testInfo) => {
  await page.route("**/*", route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin || request.method() !== "GET") return route.abort();
    if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/ticker/AMD") return route.fulfill({ json: { items: [], ticker: "AMD", nextCursor: null } });
    return route.fulfill({ status: 503, json: { error: "Test service unavailable" } });
  });
  await page.goto(`${origin}/zh-cn/ticker/AMD`);
  await expect(page.getByRole("heading", { name: "业务与财务", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "公司", exact: true })).toHaveAttribute("href", "/zh-cn/companies");
  await expect(page.locator('a[href="/zh-cn/company/nvidia"]')).toBeVisible();
  await expect(page.locator('a[href="/zh-cn?company=AMD"]').first()).toBeVisible();
  await expect(page.getByRole('heading',{name:'最新业绩 · FY2026 Q2',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'年度财务数据',exact:true})).toBeVisible();
  await expect(page.getByText("Synthetic business excerpt for company-page testing.")).toBeHidden();
  await page.locator('details').filter({has:page.getByText("Synthetic business excerpt for company-page testing.")}).locator('summary').click();
  await expect(page.getByText("Synthetic business excerpt for company-page testing.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("chinese-company-research.png"), fullPage: true });
});

test("company header remains readable when switching between light and dark mode", async ({ page }, testInfo) => {
  await page.route("**/*", route => {
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    return route.fulfill({ json: { items: [], ticker: "AMD", nextCursor: null } });
  });
  await page.goto(`${origin}/en/company/amd`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const theme of ["light", "dark", "light"]) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    const contrast = await page.evaluate(() => {
      const header = document.querySelector("main > header")!;
      const rgb = (value: string) => {
        const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) return match.slice(1, 4).map(Number);
        // Tailwind may emit OKLCH; sample the browser's sRGB rendering.
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
      };
      const luminance = (color: number[]) => color.map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const background = luminance(rgb(getComputedStyle(header).backgroundImage));
      const ratio = (element: Element) => {
        const text = luminance(rgb(getComputedStyle(element).color));
        return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
      };
      return { heading: ratio(header.querySelector("h1")!), link: ratio(header.querySelector("a")!), background };
    });
    expect(contrast.heading).toBeGreaterThan(7);
    expect(contrast.link).toBeGreaterThan(4.5);
    if (theme === "light") expect(contrast.background).toBeGreaterThan(0.9);
    else expect(contrast.background).toBeLessThan(0.1);
    await page.locator("main > header").screenshot({ path: testInfo.outputPath(`company-header-${theme}.png`) });
  }
});
