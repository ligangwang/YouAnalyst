import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { companyUpdates } from "../../src/lib/knowledge-graph/company-updates";
import { relationAnchor } from "../../src/lib/knowledge-graph/research-view";
import type { KnowledgeGraph } from "../../src/lib/knowledge-graph/model";

const origin = "http://follows.test";
const graph: KnowledgeGraph = { asOf: "2026-09-15", nodes: [{ id: "US:AMD", kind: "COMPANY", market: "US", name: "AMD", names: { "zh-CN": "超威半导体" }, symbol: "AMD", stageIds: ["compute"], order: 1 }, { id: "ORG:OPENAI", kind: "COMPANY", market: "GLOBAL", name: "OpenAI", stageIds: ["applications"], order: 2 }], sources: [{ id: "s", title: "Historic capacity announcement", url: "https://example.com/source", sourceDate: "2024-01-02" }], relationships: [{ id: "amd-openai", source: "US:AMD", target: "ORG:OPENAI", type: "SUPPLIER_OF", summary: "Planned Instinct MI450 capacity", commercialStatus: "ANNOUNCED", publishedAt: "2026-09-15T12:00:00Z", sourceIds: ["s"], facts: [{ id: "f", scope: "Planned Instinct MI450 capacity", state: "ANNOUNCED", sourceIds: ["s"], reviewedAt: "2026-09-15" }] }] };
let html: string;
test.beforeEach(({ page }) => { page.on("pageerror", error => { throw error; }); });
test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `
    import React, { useSyncExternalStore } from "react";
    import { createRoot } from "react-dom/client";
    import { AuthPage } from "./src/components/auth-page";
    import { CompanyResearchPanel } from "./src/components/company-research-panel";
    import { CompanyFollowButton } from "./src/components/company-follow-button";
    import { FollowedCompaniesPage } from "./src/components/followed-companies-page";
    import { LocaleProvider } from "./src/components/providers/locale-provider";
    const graph = ${JSON.stringify(graph)};
    const subscribe = fn => { window.addEventListener("route-change",fn); return () => window.removeEventListener("route-change",fn); };
    function App() {
      const route = useSyncExternalStore(subscribe, () => window.location.pathname+window.location.search);
      const url = new URL(window.location.href);
      return <LocaleProvider locale={url.pathname.startsWith("/zh-cn") ? "zh-CN" : "en"}>{url.pathname === "/auth" ? <AuthPage requestedNext={url.searchParams.get("next")} initialCreate /> : route.includes("following") ? <FollowedCompaniesPage /> : <main><h1>AMD</h1><CompanyFollowButton companyId="US:AMD"/><CompanyResearchPanel companyId="US:AMD" initialGraph={graph}/><a href="/watchlists/following">My companies</a></main>}</LocaleProvider>;
    }
    createRoot(document.getElementById("root")).render(<App/>);
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, outfile: "follows.js", platform: "browser", define: { "process.env": "{}" }, alias: { "next/link": path.resolve("tests/conversion/fixtures/mocks.tsx"), "next/navigation": path.resolve("tests/conversion/fixtures/mocks.tsx"), "@/components/providers/auth-provider": path.resolve("tests/conversion/fixtures/mocks.tsx") } });
  const css = await postcss([tailwind()]).process('@import "tailwindcss";', { from: path.resolve("follows-test.css") });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}body{background:#07111d;color:#f8fafc;font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script>${bundle.outputFiles.find(f => f.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});

test("follow registration preserves original research location and synchronizes buttons", async ({ page }) => {
  let ids: string[] = [], attempts = 0;
  await page.route("**/*", route => {
    const r = route.request(), url = new URL(r.url());
    if (url.origin !== origin) return route.abort();
    if (r.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/map-follows") {
      if (r.method() === "PATCH") {
        expect(r.headers().authorization).toBe("Bearer isolated-test-token");
        const body = r.postDataJSON();
        if (++attempts === 1) return route.fulfill({ status: 503, json: {} });
        ids = body.follow ? [body.companyId] : [];
      }
      return route.fulfill({ json: { companyIds: ids } });
    }
    return route.fulfill({ json: {} });
  });
  const destination = `/en/ticker/AMD?tab=research#${relationAnchor("amd-openai")}`;
  await page.goto(origin + destination);
  await page.getByRole("button", { name: "＋ Follow", exact: true }).first().click();
  expect(new URL(page.url()).searchParams.get("next")).toContain("followCompany=US%3AAMD");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("alert")).toContainText("follow was not saved");
  expect(new URL(page.url()).pathname).toBe("/auth");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(origin + destination);
  await expect(page.getByRole("button", { name: "Following", exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Following", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "＋ Follow", exact: true })).toHaveCount(2);
  expect(ids).toEqual([]);
});

test("private list separates historic source dates and clears when the account changes", async ({ page }, info) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  let ids = ["US:AMD"];
  await page.route("**/*", route => {
    const r = route.request(), url = new URL(r.url());
    if (url.origin !== origin) return route.abort();
    if (r.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/map-follows") return route.fulfill({ json: { companyIds: ids } });
    if (url.pathname === "/api/knowledge-graph") return route.fulfill({ json: graph });
    if (url.pathname === "/api/company-updates") return route.fulfill({ json: { items: companyUpdates(graph,ids), filingsAvailable: true } });
    return route.fulfill({ json: {} });
  });
  await page.goto(origin + "/zh-cn/watchlists/following");
  await expect(page.getByRole("heading", { name: "我的关注", exact: true })).toBeVisible();
  await expect(page.getByText("2024-01-02", { exact: true })).toBeVisible();
  await expect(page.getByText("2026-09-15", { exact: true })).toBeVisible();
  await expect(page.getByText("来源未明确", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "继续研究这条更新" })).toHaveAttribute("href", `/zh-cn/ticker/AMD#${relationAnchor("amd-openai")}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("following.png"), fullPage: true });
  ids = [];
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-auth-user", { detail: "different-user" })));
  await expect(page.getByText("你还没有关注公司。", { exact: true })).toBeVisible();
  await expect(page.getByText("2024-01-02", { exact: true })).toHaveCount(0);
});

test("company research exposes planned business, sources and localized continuation", async ({ page }, info) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  await page.route("**/*", route => {
    const r = route.request(), url = new URL(r.url());
    if (url.origin !== origin) return route.abort();
    if (r.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/map-follows") return route.fulfill({ json: { companyIds: ["US:AMD"] } });
    return route.fulfill({ json: {} });
  });
  await page.goto(origin + "/zh-cn/ticker/AMD");
  await expect(page.getByRole("heading", { name: "AI 产业链角色" })).toBeVisible();
  await expect(page.getByText("已宣布／计划中，尚不代表已交付", { exact: true })).toBeVisible();
  await expect(page.getByText("超威半导体已宣布计划向OpenAI提供产品或服务。", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "OpenAI", exact: true })).toHaveAttribute("href", "/zh-cn/company/ORG%3AOPENAI");
  await expect(page.getByRole("link", { name: "Historic capacity announcement ↗" })).toHaveAttribute("href", "https://example.com/source");
  await page.getByText("来源说明与适用范围", { exact: true }).click();
  await expect(page.getByText("Planned Instinct MI450 capacity", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "已关注", exact: true })).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole("button", { name: "已关注", exact: true })).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("research-panel.png"), fullPage: true });
});
