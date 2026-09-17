import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let html = "";
test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React from "react";import {createRoot} from "react-dom/client";import {MyPredictionsPage} from "./src/components/my-predictions-page";import {ComparisonsPage} from "./src/components/comparisons-page";import {LocaleProvider} from "./src/components/providers/locale-provider";const p=new URLSearchParams(location.search);createRoot(document.getElementById("root")).render(<LocaleProvider locale={p.has("zh")?"zh-CN":"en"}>{p.has("compare")?<ComparisonsPage/>:<MyPredictionsPage/>}</LocaleProvider>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outfile: "publishing.js", platform: "browser", define: { "process.env": "{}" }, alias: { "@/components/providers/auth-provider": path.resolve("tests/conversion/fixtures/mocks.tsx"), "next/link": path.resolve("tests/industry/link.tsx") } });
  html = `<html><body><div id="root"></div><script>${bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});
const prediction = { userId: "test-user", direction: "UP", thesisTitle: "Research", status: "OPEN", createdAt: "2026-04-10T00:00:00Z", entryPrice: 245.04, entryDate: "2026-04-10", markPriceDate: "2026-04-20", markReturnValue: 0.20, result: null };

for (const chinese of [false, true]) test(`legacy primary choice preserves both entry histories (${chinese ? "zh" : "en"})`, async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  const writes: unknown[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/predictions/primary") {
      if (route.request().method() === "POST") { writes.push(route.request().postDataJSON()); return route.fulfill({ json: { updated: true } }); }
      return route.fulfill({ json: { primaryPredictions: {} } });
    }
    if (url.pathname === "/api/predictions") return route.fulfill({ json: { items: [{ ...prediction, ticker: "AMD", id: "original" }, { ...prediction, ticker: "AMD", id: "comparison", entryDate: "2026-04-27", entryPrice: 334.63 }], nextCursor: null } });
    if (["/api/posts", "/api/comparisons"].includes(url.pathname)) return route.fulfill({ json: { items: [] } });
    return route.fulfill({ contentType: "text/html", body: html });
  });
  await page.goto("http://publishing.test/" + (chinese ? "?zh" : ""));
  await expect(page.getByText(/2026-04-10 · \$245.04/)).toBeVisible();
  await expect(page.getByText(/2026-04-27 · \$334.63/)).toBeVisible();
  const choose = page.getByRole("button", { name: chinese ? "用于后续文章" : "Use for future articles" });
  await expect(choose).toHaveCount(2);
  await choose.first().click();
  await expect(page.getByRole("button", { name: chinese ? "接收后续文章" : "Receives future articles" })).toBeDisabled();
  expect(writes).toEqual([{ predictionId: "original" }]);
  await expect(page.getByRole("article")).toHaveCount(2);
});

test("comparison shows individual returns without a spread or average", async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).pathname === "/api/comparisons"
    ? route.fulfill({ json: { items: [{ id: "pair", name: "NVDA vs AMD", predictions: [{ ...prediction, ticker: "AMD", id: "amd" }, { ...prediction, ticker: "NVDA", id: "nvda", markReturnValue: 0.1 }] }] } })
    : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://publishing.test/?compare");
  await expect(page.getByText(/percentage points/)).toHaveCount(0);
  await expect(page.getByText(/20.00%/)).toBeVisible();
  await expect(page.getByText(/15.00%/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "NVDA vs AMD Entry: 2026-04-10" })).toBeVisible();
  await expect(page.getByText("since entry (10d)", { exact: false })).toHaveCount(2);
});

for (const chinese of [false, true]) test(`group predictions are inline and scoped to the profile (${chinese ? "zh" : "en"})`, async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  const requestedOwners: Array<string | null> = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/comparisons") {
      requestedOwners.push(url.searchParams.get("userId"));
      return route.fulfill({ json: { items: [{ id: "pair", name: "NVDA vs AMD", predictions: [{ ...prediction, ticker: "AMD", id: "amd" }, { ...prediction, ticker: "NVDA", id: "nvda" }] }] } });
    }
    if (url.pathname === "/api/predictions/primary") return route.fulfill({ json: { primaryPredictions: {} } });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { items: [], nextCursor: null } });
    return route.fulfill({ contentType: "text/html", body: html });
  });
  await page.goto("http://publishing.test/" + (chinese ? "?zh" : ""));
  await expect(page.getByRole("heading", { name: chinese ? "表现对比" : "Performance comparison" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /NVDA vs AMD/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Compare predictions|对比预测/ })).toHaveCount(0);
  await expect(page.getByText(/Legacy predictions|历史预测的入场日期不同/)).toHaveCount(0);
  expect(requestedOwners).toEqual(["test-user"]);
});

test("different or missing entry dates cannot form a comparison", async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).pathname === "/api/comparisons"
    ? route.fulfill({ json: { items: ["2026-04-11", null].map((entryDate, index) => ({ id: String(index), name: "Invalid pair", predictions: [{ ...prediction, ticker: "AMD", id: "amd" }, { ...prediction, ticker: "NVDA", id: "nvda", entryDate }] })) } })
    : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://publishing.test/?compare");
  await expect(page.getByRole("heading", { name: "Performance comparison" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByText(/percentage points/)).toHaveCount(0);
});

for (const chinese of [false, true]) test(`comparison supports four stocks with a shared entry date (${chinese ? "zh" : "en"})`, async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).pathname === "/api/comparisons"
    ? route.fulfill({ json: { items: [{ id: "three", name: "AI chips", predictions: [
      { ...prediction, ticker: "AMD", id: "amd" },
      { ...prediction, ticker: "NVDA", id: "nvda", markReturnValue: -0.1 },
      { ...prediction, ticker: "QCOM", id: "qcom", direction: "DOWN", markReturnValue: 0.05 },
      { ...prediction, ticker: "AVGO", id: "avgo", markReturnValue: 0.15 },
    ] }] } })
    : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://publishing.test/?compare" + (chinese ? "&zh" : ""));
  await expect(page.getByRole("heading", { name: chinese ? "表现对比" : "Performance comparison" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: /AI chips.*2026-04-10/ })).toBeVisible();
  await expect(page.getByRole("link", { name: chinese ? "↓ QCOM · 看空" : "↓ QCOM · Bearish" })).toBeVisible();
  await expect(page.getByText("-10.00%", { exact: true })).toBeVisible();
  await expect(page.getByText(chinese ? "入场以来（10天）" : "since entry (10d)", { exact: false })).toHaveCount(4);
  await expect(page.getByText(/percentage points|个百分点/)).toHaveCount(0);
});

test("a mismatched third stock cannot join a same-date pair", async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).pathname === "/api/comparisons"
    ? route.fulfill({ json: { items: [{ id: "three", name: "Invalid dates", predictions: [
      { ...prediction, ticker: "AMD", id: "amd" },
      { ...prediction, ticker: "NVDA", id: "nvda" },
      { ...prediction, ticker: "QCOM", id: "qcom", entryDate: "2026-04-11" },
    ] }] } })
    : route.fulfill({ contentType: "text/html", body: html }));
  const loaded = page.waitForResponse("**/api/comparisons");
  await page.goto("http://publishing.test/?compare");
  await loaded;
  await expect(page.getByRole("heading", { name: "Performance comparison" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
});
