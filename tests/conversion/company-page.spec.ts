import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const origin = "http://company.test";
let html: string;
test.beforeAll(async () => {
  const bundled = await build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { TickerPage } from "./src/components/ticker-page";
      import { CompanyResearchOverview } from "./src/components/company-research-overview";
      import { CompanyFundamentalsView } from "./src/components/company-fundamentals";
      import { annualMetrics } from "./src/lib/fundamentals/model";
      import { buildCompanyResearch } from "./src/lib/company-research";
      import { fixtureGraph } from "./tests/industry/fixtures";
      const company = buildCompanyResearch("AMD", [], fixtureGraph);
      const report = { cik: "0000002488", accession: "0000002488-26-000010", form: "10-K", filed: "2026-02-01", end: "2025-12-27", url: "https://www.sec.gov/Archives/example.htm" };
      const data = { report, metrics: annualMetrics({cik:2488, facts:{"us-gaap":{Revenues:{units:{USD:[{val:1000000000,start:"2024-12-29",end:report.end,filed:report.filed,accn:report.accession,form:"10-K"}]}}}}}, report), excerpt: "Synthetic business excerpt for company-page testing.", fetchedAt: "2026-09-09T00:00:00Z" };
      createRoot(document.getElementById("root")).render(<TickerPage ticker="AMD" overview={<CompanyResearchOverview company={company} fundamentals={<CompanyFundamentalsView data={data} />} />} />);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: "fixture.js", platform: "browser", define: { "process.env": "{}" },
    alias: { "next/link": path.resolve("tests/industry/link.tsx"), "@/components/providers/auth-provider": path.resolve("tests/conversion/fixtures/mocks.tsx") },
  });
  const css = await postcss([tailwind()]).process('@import "tailwindcss";', { from: path.resolve("company-test.css") });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${bundled.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? ""}${css.css}body{background:#07111d;color:#f8fafc;font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script>${bundled.outputFiles.find(file => file.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});

for (const predictionsAvailable of [true, false]) {
  test(`company research remains usable with predictions ${predictionsAvailable ? "available" : "unavailable"}`, async ({ page }, testInfo) => {
    page.on("pageerror", (error) => { throw error; });
    await page.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin || request.method() !== "GET") return route.abort();
      if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
      if (url.pathname === "/api/ticker/AMD" && predictionsAvailable) return route.fulfill({ json: { items: [], ticker: "AMD", nextCursor: null } });
      return route.fulfill({ status: 503, json: { error: "Test service unavailable" } });
    });
    await page.goto(origin);
    await expect(page.getByRole("heading", { name: "Advanced Micro Devices (AMD)", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Business and financials", exact: true })).toBeVisible();
    await expect(page.getByText("1B USD", { exact: true })).toBeVisible();
    await expect(page.getByText("Synthetic business excerpt for company-page testing.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Filed 2026-02-01 ↗", exact: true })).toHaveAttribute("href", /sec.gov\/Archives\/edgar\/data\/2488\//);
    await expect(page.getByText("Unavailable", { exact: true })).toHaveCount(5);
    await expect(page.getByRole("link", { name: "Bullish", exact: true })).toHaveAttribute("href", /ticker%3DAMD.*direction%3DUP/);
    await expect(page.getByRole("link", { name: "Bearish", exact: true })).toHaveAttribute("href", /ticker%3DAMD.*direction%3DDOWN/);
    await expect(page.getByRole("link", { name: "Research NVIDIA (NVDA)" })).toHaveAttribute("href", "/ticker/NVDA");
    await expect(page.getByRole("heading", { name: "Example Packaging supplies AMD", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Institutional holdings", exact: true })).toBeVisible();
    if (!predictionsAvailable) await expect(page.getByRole("status")).toContainText("Unable to load ticker predictions");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("company-research.png"), fullPage: true });
    await page.getByText("Filing evidence", { exact: false }).first().click();
    await expect(page.getByText("Synthetic test evidence", { exact: false }).first()).toBeVisible();
  });
}
