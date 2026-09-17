import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let html = "";
test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React from "react";import {createRoot} from "react-dom/client";import {MyPredictionsPage} from "./src/components/my-predictions-page";import {ComparisonsPage} from "./src/components/comparisons-page";import {LocaleProvider} from "./src/components/providers/locale-provider";const p=new URLSearchParams(location.search);createRoot(document.getElementById("root")).render(<LocaleProvider locale={p.has("zh")?"zh-CN":"en"}>{p.has("compare")?<ComparisonsPage/>:<MyPredictionsPage/>}</LocaleProvider>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outfile: "publishing.js", platform: "browser", define: { "process.env": "{}" }, alias: { "@/components/providers/auth-provider": path.resolve("tests/conversion/fixtures/mocks.tsx"), "next/link": path.resolve("tests/industry/link.tsx") } });
  html = `<html><body><div id="root"></div><script>${bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});
const prediction = { userId: "test-user", direction: "UP", thesisTitle: "Research", status: "OPEN", createdAt: "2026-04-10T00:00:00Z", entryPrice: 245.04, entryDate: "2026-04-10", markReturnValue: 0.20, result: null };

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
    if (url.pathname === "/api/posts") return route.fulfill({ json: { items: [] } });
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

test("comparison shows individual returns and spread, not an average", async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).pathname === "/api/comparisons"
    ? route.fulfill({ json: { items: [{ id: "pair", name: "NVDA vs AMD", predictions: [{ ...prediction, ticker: "AMD", id: "amd" }, { ...prediction, ticker: "NVDA", id: "nvda", markReturnValue: 0.1 }] }] } })
    : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://publishing.test/?compare");
  await expect(page.getByText("AMD − NVDA: 10.00 percentage points")).toBeVisible();
  await expect(page.getByText(/20.00%/)).toBeVisible();
  await expect(page.getByText(/15.00%/)).toHaveCount(0);
});
