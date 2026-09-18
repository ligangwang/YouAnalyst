import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { companyUpdates } from "../../src/lib/knowledge-graph/company-updates";
import { relationAnchor } from "../../src/lib/knowledge-graph/research-view";
import type { KnowledgeGraph } from "../../src/lib/knowledge-graph/model";
import type { BusinessEvent } from "../../src/lib/knowledge-graph/business-events";

const origin = "http://follows.test";
const graph: KnowledgeGraph = { asOf: "2026-09-15", nodes: [{ id: "US:AMD", kind: "COMPANY", market: "US", name: "AMD", names: { "zh-CN": "超威半导体" }, symbol: "AMD", stageIds: ["compute"], order: 1 }, { id: "ORG:OPENAI", kind: "COMPANY", market: "GLOBAL", name: "OpenAI", stageIds: ["applications"], order: 2 }], sources: [{ id: "s", title: "Historic capacity announcement", url: "https://example.com/source", sourceDate: "2024-01-02" }], relationships: [{ id: "amd-openai", source: "US:AMD", target: "ORG:OPENAI", type: "SUPPLIER_OF", summary: "Planned Instinct MI450 capacity", commercialStatus: "ANNOUNCED", publishedAt: "2026-09-15T12:00:00Z", sourceIds: ["s"], facts: [{ id: "f", scope: "Planned Instinct MI450 capacity", state: "ANNOUNCED", sourceIds: ["s"], reviewedAt: "2026-09-15" }] }] };
let html: string;

test("business updates explain one hop, preserve dates, and toggle direct-only", async ({page}) => {
  await page.addInitScript(() => { window.authScenario = {signedIn:true}; });
  const event: BusinessEvent = {id:"customer-expansion",category:"CAPACITY",companyIds:["ORG:OPENAI"],eventDate:"2024-01-01",sourceDate:"2024-01-02",collectedAt:"2026-09-15",title:"Customer expansion",titleZh:"客户扩产",summary:"A company-only event",summaryZh:"仅关联公司的事件",sourceTitle:"Original announcement",sourceUrl:"https://example.com/event",planned:true};
  await page.route("**/*",route => {
    const url = new URL(route.request().url());
    if(route.request().isNavigationRequest())return route.fulfill({contentType:"text/html",body:html});
    if(url.pathname === "/api/map-follows")return route.fulfill({json:{companyIds:["US:AMD"]}});
    if(url.pathname === "/api/company-updates")return route.fulfill({json:{items:companyUpdates(graph,["US:AMD"],[event]),filingsAvailable:true}});
    return route.fulfill({json:graph});
  });
  await page.goto(origin+"/en/watchlists/following");
  await page.getByRole("button",{name:"Updates",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Customer expansion"})).toBeVisible();
  await expect(page.getByLabel("Why this appears")).toContainText("recorded customer of AMD");
  await expect(page.getByText("Earlier event, added later. Collection is not a new business event.")).toBeVisible();
  await expect(page.getByRole("link",{name:"Open in map"})).toHaveAttribute("href","/en?company=ORG%3AOPENAI&event=customer-expansion");
  await page.getByText("View evidence",{exact:true}).click();
  await expect(page.getByRole("link",{name:"Original announcement ↗"})).toHaveAttribute("href","https://example.com/event");
  await page.getByRole("checkbox",{name:"Include one-hop suppliers / customers"}).uncheck();
  await expect(page.getByText("No reliable updates available for these companies yet.")).toBeVisible();
  await expect(page.getByRole("heading",{name:"Customer expansion"})).toHaveCount(0);
});
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
    const dense = {...graph,nodes:[...graph.nodes,...Array.from({length:6},(_,i)=>({id:'ORG:PARTNER'+i,name:'Partner '+i,kind:'COMPANY',order:3+i}))],relationships:[...graph.relationships,...Array.from({length:6},(_,i)=>({id:'partner'+i,source:'US:AMD',target:'ORG:PARTNER'+i,type:'PARTNER_OF',summary:i%2?'Helios design':'EPYC deployment',sourceIds:['s'],commercialStatus:'DOCUMENTED'}))]};
    const subscribe = fn => { window.addEventListener("route-change",fn); return () => window.removeEventListener("route-change",fn); };
    function App() {
      const route = useSyncExternalStore(subscribe, () => window.location.pathname+window.location.search);
      const url = new URL(window.location.href);
      return <LocaleProvider locale={url.pathname.startsWith("/zh-cn") ? "zh-CN" : "en"}>{url.pathname === "/auth" ? <AuthPage requestedNext={url.searchParams.get("next")} initialCreate /> : route.includes("following") ? <FollowedCompaniesPage /> : <main><h1>AMD</h1><CompanyFollowButton companyId="US:AMD"/><CompanyResearchPanel companyId="US:AMD" initialGraph={url.searchParams.has('dense') ? dense : graph}/><a href="/watchlists/following">My companies</a></main>}</LocaleProvider>;
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
  await expect(page.getByRole("heading",{name:"Follow AMD",exact:true})).toBeVisible();
  await expect(page.locator("body")).not.toContainText("US:AMD");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("alert")).toContainText("follow was not saved");
  expect(new URL(page.url()).pathname).toBe("/auth");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(origin + destination);
  await expect(page.getByRole("button", { name: "Following", exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Following", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "＋ Follow", exact: true })).toHaveCount(3);
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
  await page.getByRole("button",{name:"更新",exact:true}).click();
  await page.getByRole("button", {name:"证据更新",exact:true}).click();
  await page.getByText("查看证据", {exact:true}).click();
  await expect(page.getByText("资料发布日期: 2024-01-02", { exact: true })).toBeVisible();
  await expect(page.getByText(/事件／宣布日期: 未明确 · 收录／复核: 2026-09-15/)).toBeVisible();
  await expect(page.getByRole("link", { name: "在图谱中打开" })).toHaveAttribute("href", "/zh-cn?company=US%3AAMD&relationship=amd-openai");
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
  await expect(page.getByText("含已宣布／计划中事项",{exact:true})).toBeVisible();
  await expect(page.getByRole("link", { name: "Historic capacity announcement ↗" })).not.toBeVisible();
  await page.getByText("查看证据",{exact:true}).click();
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

test("compact relationships filter products, expand all and honor links into hidden evidence", async ({page}) => {
 await page.route("**/*",route => route.request().isNavigationRequest() ? route.fulfill({contentType:"text/html",body:html}) : route.fulfill({json:graph}));
 await page.goto(origin + "/en/ticker/AMD?dense");
 const research = page.getByRole("region",{name:"AI supply-chain research"});
 await expect(research.getByRole("article")).toHaveCount(5);
 await research.getByRole("button",{name:"EPYC",exact:true}).click();
 await expect(research.getByRole("article")).toHaveCount(3);
 await expect(research.getByText("Helios design",{exact:true})).toHaveCount(0);
 await research.getByRole("button",{name:"All",exact:true}).click();
 await research.getByRole("button",{name:"Show all 6",exact:true}).click();
 await expect(research.getByRole("article")).toHaveCount(7);
 await page.goto(origin + `/en/ticker/AMD?dense#${relationAnchor("partner5")}`);
 const target = page.locator(`#${relationAnchor("partner5")}`);
 await expect(target).toBeVisible();
 await expect(target.getByRole("link",{name:"Historic capacity announcement ↗"})).toBeVisible();
});

test("signed-out following shows public examples without requesting private updates", async ({page}) => {
 let privateRequests = 0;
 await page.route("**/*",route => {
   const url = new URL(route.request().url());
   if (route.request().isNavigationRequest()) return route.fulfill({contentType:"text/html",body:html});
   if (url.pathname === "/api/company-updates") privateRequests++;
   return route.fulfill({json:graph});
 });
 await page.goto(origin + "/en/watchlists/following");
 const preview = page.getByRole("region",{name:"Following preview"});
 await expect(preview.getByRole("heading",{name:"AMD",exact:true})).toBeVisible();
 await expect(preview).toContainText("not a saved list");
 await page.getByRole("button",{name:"Updates",exact:true}).click();
 await expect(preview).toContainText("2024-01-02");
 expect(privateRequests).toBe(0);
});
