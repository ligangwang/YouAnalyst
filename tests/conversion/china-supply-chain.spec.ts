import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let html: string;
test.beforeAll(async () => {
  const result = await build({ stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client"; import {ChinaSupplyChain} from "./src/components/china-supply-chain"; import {MapMarketSwitch} from "./src/components/map-market-switch"; import {LocaleProvider,LanguageSwitch} from "./src/components/providers/locale-provider"; createRoot(document.getElementById("root")).render(<LocaleProvider locale={new URLSearchParams(location.search).get("lang") === "en" ? "en" : "zh-CN"}><LanguageSwitch/><MapMarketSwitch china/><ChinaSupplyChain/></LocaleProvider>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", alias: { "next/link": path.resolve("tests/industry/link.tsx") } });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});
test("Chinese landscape searches tickers, filters stages and links to primary evidence", async ({ page }) => {
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://china.test/map?market=CN_A&lang=zh-CN");
  await expect(page.getByRole("heading", { name: "看懂 AI 产业链" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(5);
  await page.getByRole("textbox", { name: "搜索 A 股公司" }).fill("002837");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "英维克" })).toBeVisible();
  await expect(page.getByRole("article").getByRole("link")).toHaveAttribute("href", "https://static.cninfo.com.cn/finalpage/2026-04-21/1225131813.PDF");
  await page.getByRole("textbox").fill("");
  await page.getByRole("button", { name: "算力芯片", exact: true }).click();
  await expect(page.getByRole("heading", { name: "海光信息" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("textbox").fill("missing");
  await expect(page.getByRole("status")).toContainText("没有匹配");
});
test("language changes preserve A-share market selection", async ({ page }) => {
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://china.test/map?market=CN_A&lang=zh-CN");
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page).toHaveURL(/market=CN_A&lang=en/);
  await expect(page.getByRole("heading", { name: "Inside the AI supply chain" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(5);
});
