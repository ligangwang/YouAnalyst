import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let html = "";
test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React,{useState} from "react";import {createRoot} from "react-dom/client";import {PredictionDetailPage} from "./src/components/prediction-detail-page";import {LocaleProvider} from "./src/components/providers/locale-provider";function App(){const [locale,setLocale]=useState("zh-CN");return <LocaleProvider locale={locale}><button onClick={()=>setLocale(locale==="en"?"zh-CN":"en")}>Switch test language</button><PredictionDetailPage predictionId="pending-test"/></LocaleProvider>}createRoot(document.getElementById("root")).render(<App/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outfile: "prediction-locale.js", platform: "browser", define: { "process.env": "{}" }, alias: { "next/link": path.resolve("tests/industry/link.tsx"), "@/components/providers/auth-provider": path.resolve("tests/conversion/fixtures/mocks.tsx") } });
  html = `<html><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});

test("pending prediction translates placeholders and actions without changing stored status", async ({ page }) => {
  const prediction = { id: "pending-test", userId: "test-user", ticker: "AMD", direction: "UP", status: "CREATED", visibility: "PRIVATE", entryPrice: null, entryDate: null, markPrice: null, markPriceDate: null, markReturnValue: null, thesisTitle: "", thesis: "", timeHorizon: null, createdAt: new Date().toISOString(), commentCount: 0, result: null, watchlistName: "My custom watchlist", authorDisplayName: "Test author" };
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") throw new Error("Display test must not mutate predictions");
    if (url.pathname === "/api/predictions/pending-test") return route.fulfill({ json: prediction });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { items: [] } });
    return route.fulfill({ contentType: "text/html", body: html });
  });
  await page.goto("http://prediction-locale.test");
  await expect(page.getByText("等待起始价", { exact: true })).toBeVisible();
  await expect(page.getByText("待处理", { exact: true })).toHaveCount(5);
  await expect(page.getByRole("button", { name: "取消", exact: true })).toBeVisible();
  await expect(page.getByText("Pending", { exact: true })).toHaveCount(0);
  await expect(page.getByText("My custom watchlist", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Switch test language" }).click();
  await expect(page.getByText("Awaiting entry", { exact: true })).toBeVisible();
  await expect(page.getByText("Pending", { exact: true })).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  expect(prediction.status).toBe("CREATED");
});

