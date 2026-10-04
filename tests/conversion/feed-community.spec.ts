import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { companyUpdates } from "../../src/lib/knowledge-graph/company-updates";
import type { KnowledgeGraph } from "../../src/lib/knowledge-graph/model";
import type { BusinessEvent } from "../../src/lib/knowledge-graph/business-events";

const origin = "http://feed.test";
const company = (id: string, name: string, order: number, zh?: string) => ({ id, kind: "COMPANY" as const, market: "US" as const, name, symbol: name, stageIds: ["compute"], order, ...(zh ? { names: { "zh-CN": zh } } : {}) });
const graph: KnowledgeGraph = {
  asOf: "2026-09-20",
  nodes: [company("US:AMD", "AMD", 1, "超威半导体"), company("US:CSCO", "Cisco", 2, "思科"), company("US:MU", "Micron", 3, "美光")],
  sources: [
    { id: "humain", title: "HUMAIN deployment review", url: "https://example.com/humain-review", sourceDate: "2026-08-31" },
    { id: "hbm", title: "HBM supply disclosure", url: "https://example.com/hbm", sourceDate: "2026-09-10" },
  ],
  relationships: [
    { id: "US:AMD__PARTNER_OF__US:CSCO", source: "US:AMD", target: "US:CSCO", type: "PARTNER_OF", summary: "HUMAIN systems live", commercialStatus: "DOCUMENTED", sourceIds: ["humain"], facts: [{ id: "live", scope: "MI355X and Cisco networking running in production", state: "DOCUMENTED", sourceIds: ["humain"], eventDate: "2026-08-31", reviewedAt: "2026-09-18" }] },
    { id: "mu-amd", source: "US:MU", target: "US:AMD", type: "SUPPLIER_OF", summary: "HBM supply", commercialStatus: "DOCUMENTED", sourceIds: ["hbm"], facts: [{ id: "hbm", scope: "HBM3E supply for Instinct accelerators", state: "DOCUMENTED", sourceIds: ["hbm"], eventDate: "2026-09-10", reviewedAt: "2026-09-10" }] },
  ],
};
const events: BusinessEvent[] = [
  { id: "amd-cisco-humain-live-20260831", category: "PRODUCT", companyIds: ["US:AMD", "US:CSCO"], relationshipId: "US:AMD__PARTNER_OF__US:CSCO", eventDate: "2026-08-31", sourceDate: "2026-08-31", collectedAt: "2026-09-16", planned: false, title: "AMD and Cisco report HUMAIN systems are live", titleZh: "AMD 与思科宣布 HUMAIN 系统已上线", summary: "Live MI355X infrastructure. A separate 250 MW expansion is planned to begin in 2027; it is not delivered capacity.", summaryZh: "系统已上线。另有计划从 2027 年开始部署的 250 MW 扩建，不能计作已交付产能。", sourceTitle: "AMD · HUMAIN production deployment", sourceUrl: "https://example.com/humain" },
  { id: "micron-capacity-2025", category: "CAPACITY", companyIds: ["US:MU"], eventDate: "2025-03-04", sourceDate: "2025-03-04", collectedAt: "2026-09-20", planned: true, title: "Micron announces HBM capacity plan", titleZh: "美光宣布 HBM 扩产计划", summary: "Planned capacity; not completed delivery.", summaryZh: "计划扩产，不代表已完成交付。", sourceTitle: "Micron · capacity", sourceUrl: "https://example.com/micron" },
];
const items = companyUpdates(graph, graph.nodes.map(n => n.id), events);
const analyst = (i: number) => ({ userId: `u${i}`, displayName: `Analyst ${i}`, nickname: null, photoURL: null, totalScore: 400 - i * 10, settledCalls: 2, liveCalls: 3, totalXP: 120, level: 2 });
let html: string;

test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { LocaleProvider } from "./src/components/providers/locale-provider";
    import { ResearchUpdateFeed } from "./src/components/research-update-feed";
    import { LeaderboardPage } from "./src/components/leaderboard-page";
    import { SiteNav } from "./src/components/site-nav";
    import { PredictionAuthorSummary } from "./src/components/prediction-ui";
    const graph = ${JSON.stringify(graph)};
    const items = ${JSON.stringify(items)};
    const path = location.pathname.replace(/^\\/(en|zh-cn)/, "") || "/";
    createRoot(document.getElementById("root")).render(<LocaleProvider locale={location.pathname.startsWith("/zh-cn") ? "zh-CN" : "en"}>
      <SiteNav />
      {path === "/feed" ? <ResearchUpdateFeed graph={graph} items={items} /> : path === "/leaderboard" ? <LeaderboardPage /> : <main><PredictionAuthorSummary author={{ userId: "u1", authorDisplayName: "Analyst 1", authorStats: { level: 3 } }} /></main>}
    </LocaleProvider>);
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, outfile: "feed.js", platform: "browser", define: { "process.env": "{}" }, plugins: [{ name: "next-fixtures", setup(builder) {
    builder.onResolve({ filter: /auth-provider$/ }, () => ({ path: path.resolve("tests/conversion/fixtures/mocks.tsx") }));
    builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: "image", namespace: "fixture" }));
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    builder.onLoad({ filter: /^image$/, namespace: "fixture" }, () => ({ contents: "import React from 'react'; export default function Image({ referrerPolicy, priority, ...props }){ return <img {...props} referrerPolicy={referrerPolicy} />; }", loader: "jsx", resolveDir: process.cwd() }));
    builder.onLoad({ filter: /^navigation$/, namespace: "fixture" }, () => ({ contents: "export function useRouter(){return {push(url){location.assign(url)},replace(url){location.assign(url)}}} export function usePathname(){return location.pathname} export function useSearchParams(){return new URLSearchParams(location.search)}", loader: "js" }));
  } }], alias: { "next/link": path.resolve("tests/industry/link.tsx") } });
  const css = await postcss([tailwind()]).process('@import "tailwindcss";', { from: path.resolve("feed-test.css") });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}body{background:#07111d;color:#f8fafc;font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script>${bundle.outputFiles.find(f => f.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});

async function serve(page: Page, rankedAnalysts: number) {
  page.on("pageerror", error => { throw error; });
  await page.route("**/*", route => {
    const r = route.request(), url = new URL(r.url());
    if (url.origin !== origin) return route.abort();
    if (r.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/leaderboard/status") return route.fulfill({ json: { rankedAnalysts, minimum: 10, open: rankedAnalysts >= 10 } });
    if (url.pathname === "/api/leaderboard") return route.fulfill({ json: { items: Array.from({ length: rankedAnalysts }, (_, i) => analyst(i + 1)), emergingItems: [] } });
    return route.fulfill({ json: {} });
  });
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("feed uses publication date, keeps pipeline dates private and groups source evidence", async ({ page }, info) => {
  await serve(page, 3);
  await page.goto(origin + "/en/feed");
  await expect(page.getByText("marks an earlier event that was collected recently.", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Earlier event, added later. Collection is not a new business event.", { exact: true })).toHaveCount(0);
  const cards = page.getByRole("article");
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText("2026-09-10");
  await expect(cards.nth(1).getByRole("heading")).toHaveText("AMD and Cisco report HUMAIN systems are live");
  await expect(cards.nth(2).getByRole("heading")).toHaveText("Micron announces HBM capacity plan");
  const humain = cards.nth(1);
  await expect(humain.locator("time")).toHaveText("2026-08-31");
  await expect(humain.getByTitle("Earlier event, added later. Collection is not a new business event.")).toHaveCount(0);
  await expect(humain).toContainText("it is not delivered capacity");
  await expect(cards.nth(0).getByText("Added later")).toHaveCount(0);
  await humain.getByText("Sources added / reviewed for this event (1)").click();
  await expect(humain.getByRole("link", { name: "HUMAIN deployment review ↗" })).toHaveAttribute("href", "https://example.com/humain-review");
  await expect(page.getByText("Sources added / reviewed", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Recently added", exact: true })).toHaveCount(0);
  await expect(page.getByText("Collected / reviewed", {exact:false})).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: info.outputPath("feed.png"), fullPage: true });
});

test("research summary prioritizes dated company reports and shows evidence limits", async ({ page }) => {
  await serve(page, 3);
  await page.goto(origin + "/en/feed");
  const summary = page.getByRole("region", { name: "Research summary", exact: true });
  await expect(summary).toBeVisible();
  const rows = summary.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("AMD and Cisco report HUMAIN systems are live");
  await expect(rows.nth(0)).toContainText("no prior-state comparison is recorded");
  await expect(rows.nth(1)).toContainText("Announced plan; completed delivery is not established");
  expect(await summary.locator("time").allTextContents()).toEqual(["2026-08-31", "2025-03-04"]);
  await expect(summary.getByRole("link", { name: "Read source: AMD · HUMAIN production deployment", exact: true })).toHaveAttribute("href", "https://example.com/humain");
});

test("Chinese feed keeps the marker accessible and the planned caveat in item text", async ({ page }, info) => {
  await serve(page, 3);
  await page.goto(origin + "/zh-cn/feed");
  await expect(page.getByRole("heading", { name: "精选研究动态" })).toBeVisible();
  await expect(page.getByText("表示较早发生、近期才收录的事件", { exact: false })).toHaveCount(0);
  await expect(page.getByTitle("历史事件后续收录，收录日期不代表新发生的业务事件。")).toHaveCount(0);
  await expect(page.getByText("计划扩产，不代表已完成交付。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "最近收录", exact: true })).toHaveCount(0);
  await expect(page.getByText("该事件的来源收录／复核（1）", { exact: true })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.screenshot({ path: info.outputPath("feed-zh.png"), fullPage: true });
});

test("rankings stay hidden with too few analysts and no level labels are shown", async ({ page }, info) => {
  await serve(page, 3);
  await page.goto(origin + "/en/leaderboard");
  await expect(page.getByRole("heading", { name: "Rankings are coming soon" })).toBeVisible();
  await expect(page.getByText("Rankings open once at least 10 analysts have public calls. 3 ranked so far.")).toBeVisible();
  await expect(page.getByText("Analyst 1")).toHaveCount(0);
  await page.locator("summary:visible", { hasText: "More" }).click();
  await expect(page.getByRole("link", { name: "Investment ideas", exact: true }).filter({ visible: true })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Rankings", exact: true })).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.locator("summary:visible", { hasText: "More" }).click();
  await page.screenshot({ path: info.outputPath("leaderboard-coming-soon.png"), fullPage: true });
  await page.goto(origin + "/en/author");
  await expect(page.getByRole("link", { name: /Analyst 1/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Level");
  await page.goto(origin + "/zh-cn/leaderboard");
  await expect(page.getByRole("heading", { name: "排行榜即将开放" })).toBeVisible();
  await expect(page.getByText("至少 10 位分析师发布公开观点后开放排行榜，目前已有 3 位。")).toBeVisible();
});

test("open rankings explain the score without level or tier labels", async ({ page }, info) => {
  await serve(page, 10);
  await page.goto(origin + "/en/leaderboard");
  await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
  await expect(page.getByText(/each public call is scored from −1000 to \+1000/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Analyst 1\b/ }).first()).toContainText("+390");
  await expect(page.locator("main")).not.toContainText("Level");
  await expect(page.locator("main")).not.toContainText("New Analyst");
  await page.locator("summary:visible", { hasText: "More" }).click();
  await expect(page.getByRole("link", { name: "Rankings", exact: true }).filter({ visible: true })).toHaveCount(1);
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.locator("summary:visible", { hasText: "More" }).click();
  await page.screenshot({ path: info.outputPath("leaderboard.png"), fullPage: true });
  await page.goto(origin + "/zh-cn/leaderboard");
  await expect(page.getByText(/得分说明：每条公开观点按建仓以来的收益计分/)).toBeVisible();
  await expect(page.locator("main")).not.toContainText("等级");
});
