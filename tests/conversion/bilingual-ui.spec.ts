import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let html: string;
test.beforeAll(async () => {
  const result = await build({ stdin: { contents: `import React from "react";import {createRoot} from "react-dom/client";import {LocaleProvider} from "./src/components/providers/locale-provider";import {MarketProvider} from "./src/components/providers/market-provider";import {MarketContent} from "./src/components/market-content";import {SiteNav} from "./src/components/site-nav";import {PredictionsFeed} from "./src/components/predictions-feed";import {DisplayPreferencesPanel} from "./src/components/display-preferences";import {CompanyDirectionActions} from "./src/components/company-direction-actions";const p=new URLSearchParams(location.search);createRoot(document.getElementById("root")).render(<LocaleProvider locale={p.get("lang")==="zh-CN"?"zh-CN":"en"}><MarketProvider market={p.get("market")||"US"}><SiteNav/><MarketContent><PredictionsFeed/><CompanyDirectionActions ticker="AMD"/></MarketContent>{location.pathname==="/profile"&&<DisplayPreferencesPanel/>}</MarketProvider></LocaleProvider>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outfile: "bilingual.js", platform: "browser", plugins: [{ name: "mock-auth-and-navigation", setup(builder) {
    builder.onResolve({ filter: /auth-provider$/ }, () => ({ path: path.resolve("tests/conversion/fixtures/mocks.tsx") }));
    builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "image-fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "image-fixture" }, () => ({ contents: "import React from 'react'; export default function Image(props){return <img {...props}/>} ", loader: "jsx", resolveDir: process.cwd() }));
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export function usePathname(){return location.pathname} export function useSearchParams(){return new URLSearchParams(location.search)}", loader: "js" }));
  } }], alias: { "next/link": path.resolve("tests/industry/link.tsx") }, define: { "process.env.NODE_ENV": '"test"' } });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script>${result.outputFiles.find(file => file.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (route.request().url().includes("/api/predictions")) return route.fulfill({ json: { items: [{ id: "one", ticker: "AMD", direction: "UP", status: "CREATED", entryPrice: null, createdAt: "2026-09-10", thesisTitle: "Live", thesis: "Original author text", userId: "writer", authorDisplayName: "Live", commentCount: 0 }], nextCursor: null } });
    return route.fulfill({ json: { preferences: null, items: [], isAdmin: false } });
  });
});
test("Chinese calls translate title, actions and status while preserving author text", async ({ page }) => {
  await page.goto("http://bilingual.test/predictions?lang=zh-CN&market=US");
  await expect(page.getByRole("heading", { name: "最新观点" })).toBeVisible();
  await expect(page.getByText("等待起始价", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "看多", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "看空", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "AMD 的看多观点" })).toBeVisible();
  await expect(page.getByText("Original author text", { exact: true })).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toHaveCount(2);
});
test("market selection preserves Chinese and hides US calls under A-shares", async ({ page }) => {
  await page.goto("http://bilingual.test/predictions?lang=zh-CN&market=US");
  await page.getByRole("combobox", { name: "市场", exact: true }).selectOption("CN_A");
  await expect(page).toHaveURL(/lang=zh-CN&market=CN_A/);
  await expect(page.getByRole("heading", { name: "A 股数据接入中" })).toBeVisible();
  await expect(page.getByText("Original author text")).toHaveCount(0);
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page).toHaveURL(/lang=en&market=CN_A/);
  await expect(page.getByRole("heading", { name: "A-share coverage is growing" })).toBeVisible();
});
test("signed-in preference saves both fields and failed saves stay on the current page", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  const writes: unknown[] = [];
  await page.route("**/api/preferences", route => { writes.push(route.request().postDataJSON()); return route.fulfill({ status: 503, json: { error: "unavailable" } }); });
  await page.goto("http://bilingual.test/predictions?lang=zh-CN&market=US");
  await page.getByRole("combobox", { name: "市场", exact: true }).selectOption("ALL");
  await expect(page.getByRole("alert")).toContainText("偏好保存失败");
  expect(writes).toEqual([{ language: "zh-CN", market: "ALL" }]);
  await expect(page).toHaveURL(/market=US/);
  await page.route("**/api/preferences", route => route.fulfill({ json: { preferences: route.request().postDataJSON() } }));
  await page.getByRole("combobox", { name: "市场", exact: true }).selectOption("ALL");
  await expect(page).toHaveURL(/lang=zh-CN&market=ALL/);
  await expect(page.getByRole("heading", { name: "最新观点" })).toBeVisible();
});
test("English labels remain available", async ({ page }) => {
  await page.goto("http://bilingual.test/predictions?lang=en&market=US");
  await expect(page.getByRole("heading", { name: "Latest Calls" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bullish", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Up prediction for AMD" })).toBeVisible();
});

test("signing in restores account language and market when the URL has no explicit preference", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  await page.route("**/api/preferences", route => route.fulfill({ json: { preferences: { language: "zh-CN", market: "CN_A" } } }));
  await page.goto("http://bilingual.test/profile");
  await expect(page).toHaveURL(/lang=zh-CN&market=CN_A/);
  await expect(page.getByRole("heading", { name: "语言与市场" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "界面语言" })).toHaveValue("zh-CN");
});
