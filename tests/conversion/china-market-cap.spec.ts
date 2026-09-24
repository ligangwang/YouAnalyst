import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import type { PublicCnMarketCap } from "../../src/lib/fundamentals/cn-service";

const origin = "http://cn-cap.test";
let html = "";
const estimated: PublicCnMarketCap = { status: "estimated", reason: null, value: 856_226_458_500, currency: "CNY",
  usd: { value: 120_595_275_845, rate: 7.1, rateDate: "2026-09-24" }, priceDate: "2026-09-25", close: 100, lastClose: false,
  shares: { total: 8_562_264_585, a: 2_547_775_982, h: 6_014_488_603, b: 0, date: "2026-09-10", asOf: "2026-09-25",
    sourceUrl: "https://www.cninfo.com.cn/data20/stockholderCapital/getStockStructure?scode=688981" } };
const fixtures: Record<string, PublicCnMarketCap | null> = {
  estimated, suspended: { ...estimated, priceDate: "2026-09-01", lastClose: true },
  pending: { ...estimated, status: "unavailable", reason: "corporate_action_after_share_count", value: null, usd: null }, missing: null,
};

test.beforeAll(async () => {
  const bundled = await build({ stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client"; import {ChinaMarketCap} from "./src/components/china-market-cap"; import {LocaleProvider} from "./src/components/providers/locale-provider";
const query = new URLSearchParams(location.search); const fixtures = ${JSON.stringify(fixtures)};
createRoot(document.getElementById("root")).render(<LocaleProvider locale={query.get("lang") === "zh-CN" ? "zh-CN" : "en"}><main><ChinaMarketCap data={fixtures[query.get("case")] ?? null}/></main></LocaleProvider>);`,
    loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outfile: "cn-cap.js", platform: "browser", define: { "process.env": "{}" } });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{background:#07111d;color:white;padding:16px;font-family:Arial}</style></head><body><div id="root"></div><script>${bundled.outputFiles.find(file => file.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
});

test("A-share market cap shows CNY with USD, rate date, as-of date and the A+H calculation in English", async ({ page }) => {
  await page.goto(`${origin}/?case=estimated&lang=en`);
  const section = page.getByRole("region", { name: "Estimated market cap" });
  await expect(section.locator("[data-market-cap-cny]")).toHaveText("¥856.23B CNY");
  await expect(section.locator("[data-market-cap-usd]")).toHaveText("≈ $120.6B USD · USD/CNY 7.1000 on 2026-09-24");
  await expect(section.getByText("As of 2026-09-25", { exact: true })).toBeVisible();
  await section.getByText("Calculation details").click();
  await expect(section.getByText("Total shares: 8,562,264,585 (A 2,547,775,982 + H 6,014,488,603)")).toBeVisible();
  await expect(section.getByRole("link", { name: "Share structure source ↗" })).toHaveAttribute("href", /cninfo\.com\.cn/);
});

test("A-share market cap is localized in Chinese, labels last closes, and explains unavailable values", async ({ page }) => {
  await page.goto(`${origin}/?case=estimated&lang=zh-CN`);
  const section = page.getByRole("region", { name: "估算市值" });
  await expect(section.locator("[data-market-cap-cny]")).toHaveText("¥8,562.26亿 CNY");
  await expect(section.locator("[data-market-cap-usd]")).toContainText("美元兑人民币 7.1000（2026-09-24）");
  await expect(section.getByText("截至 2026-09-25", { exact: true })).toBeVisible();
  await page.goto(`${origin}/?case=suspended&lang=zh-CN`);
  await expect(page.getByText("截至 2026-09-01（最近收盘价，其后未交易）")).toBeVisible();
  await page.goto(`${origin}/?case=pending&lang=en`);
  await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(page.getByText(/recent share change .* is not yet reflected/)).toBeVisible();
  await page.goto(`${origin}/?case=missing&lang=zh-CN`);
  await expect(page.getByText("暂无", { exact: true })).toBeVisible();
});
