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
      import { buildCompanyResearch } from "./src/lib/company-research";
      import { fixtureGraph } from "./tests/industry/fixtures";
      const company = buildCompanyResearch("AMD", [], fixtureGraph);
      createRoot(document.getElementById("root")).render(<TickerPage ticker="AMD" overview={<CompanyResearchOverview company={company} />} />);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", define: { "process.env": "{}" },
    alias: { "next/link": path.resolve("tests/industry/link.tsx"), "@/components/providers/auth-provider": path.resolve("tests/conversion/fixtures/mocks.tsx") },
  });
  const css = await postcss([tailwind()]).process('@import "tailwindcss";', { from: path.resolve("company-test.css") });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}body{background:#07111d;color:#f8fafc;font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script>${bundled.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
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
