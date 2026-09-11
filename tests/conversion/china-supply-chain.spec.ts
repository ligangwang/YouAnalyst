import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

import { chinaSupplyChain } from "../../src/lib/industry-graph/china";
import cn from "../../data/ai-supply-chain/ai-cn-a.json";
import us from "../../data/ai-supply-chain/ai-us.json";
import { combineGraphs, type KnowledgeGraph } from "../../src/lib/knowledge-graph/model";
import { graphChinaCompanies } from "../../src/lib/knowledge-graph/china-companies";

let html: string;
test("directory displays the full graph A-share set and searches normalized codes", async ({ page }) => {
  const graph = combineGraphs([us, cn] as unknown as (KnowledgeGraph & { id: string; language: string })[]);
  await page.route("**/*", route => route.request().url().includes("/api/market-companies") ? route.fulfill({json:{items:graphChinaCompanies(graph),nextCursor:null}}) : route.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://china.test/companies?market=CN_A&lang=zh-CN");
  await expect(page.getByRole("article")).toHaveCount(62);
  await expect(page.getByText(/62 \/ 62/)).toBeVisible();
  await page.getByRole("textbox").fill(" ６８８０４１ ");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("heading", {name:"海光信息",exact:true})).toBeVisible();
  await expect(page.getByText(/1 \/ 62/)).toBeVisible();
});
test.beforeAll(async () => {
  const result = await build({ stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client"; import {ChinaSupplyChain} from "./src/components/china-supply-chain"; import {MapMarketSwitch} from "./src/components/map-market-switch"; import {LocaleProvider,LanguageSwitch} from "./src/components/providers/locale-provider"; createRoot(document.getElementById("root")).render(<LocaleProvider locale={new URLSearchParams(location.search).get("lang") === "en" ? "en" : "zh-CN"}><LanguageSwitch/><MapMarketSwitch selected="CN_A"/><ChinaSupplyChain/></LocaleProvider>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outfile: "china-fixture.js", platform: "browser", alias: { "next/link": path.resolve("tests/industry/link.tsx") } });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});
test("Chinese landscape searches tickers, filters stages and links to primary evidence", async ({ page }) => {
  await page.route("**/*", route => route.request().url().includes("/api/market-companies") ? route.fulfill({ json: { items: chinaSupplyChain, nextCursor: null } }) : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://china.test/map?market=CN_A&lang=zh-CN");
  await expect(page.getByRole("heading", { name: "探索 A 股产业" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(5);
  await expect(page.getByRole("link", { name: /2026 年半年度报告|2026 interim report/ })).toHaveCount(5);
  await page.getByRole("textbox", { name: "搜索 A 股公司" }).fill("002837");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "英维克" })).toBeVisible();
  await expect(page.getByRole("article").getByRole("link")).toHaveAttribute("href", "https://money.finance.sina.com.cn/corp/view/vCB_AllBulletinDetail.php?id=12525843&stockid=002837");
  await page.getByRole("textbox").fill("");
  await page.getByRole("button", { name: "算力芯片", exact: true }).click();
  await expect(page.getByRole("heading", { name: "海光信息" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("textbox").fill("missing");
  await expect(page.getByRole("status")).toContainText("没有匹配");
});
test("language changes preserve A-share market selection", async ({ page }) => {
  await page.route("**/*", route => route.request().url().includes("/api/market-companies") ? route.fulfill({ json: { items: chinaSupplyChain, nextCursor: null } }) : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://china.test/map?market=CN_A&lang=zh-CN");
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page).toHaveURL(/market=CN_A&lang=en/);
  await expect(page.getByRole("heading", { name: "Explore A-share industries" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(5);
});

test("directory reads additional Firestore pages and deduplicates category buttons", async ({ page }) => {
  await page.route("**/*", route => {
    if (!route.request().url().includes("/api/market-companies")) return route.fulfill({ contentType: "text/html", body: html });
    return route.fulfill({ json: route.request().url().includes("cursor=")
      ? { items: [{ ...chinaSupplyChain[0], id: "XSHG:688999", name: "测试公司", en: "Test company" }], nextCursor: null }
      : { items: chinaSupplyChain, nextCursor: "XSHE:300308" } });
  });
  await page.goto("http://china.test/map?market=CN_A&lang=zh-CN");
  await expect(page.getByRole("article")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "算力芯片", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "算力芯片", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(2);
});

test("directory failures show retry instead of silently displaying static companies", async ({ page }) => {
  let failed = true;
  await page.route("**/*", route => route.request().url().includes("/api/market-companies")
    ? route.fulfill(failed ? { status: 503, json: { error: "unavailable" } } : { json: { items: [], nextCursor: null } })
    : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://china.test/map?market=CN_A&lang=en");
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  await expect(page.getByRole("article")).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("status")).toContainText("No companies have been published yet");
});
