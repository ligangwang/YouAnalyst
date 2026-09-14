import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import us from "../../data/ai-supply-chain/ai-us.json";
import cn from "../../data/ai-supply-chain/ai-cn-a.json";
import { combineGraphs, filterGraph, layoutGraph, type KnowledgeGraph } from "../../src/lib/knowledge-graph/model";
import { connectionJourney } from "../../src/lib/knowledge-graph/discovery";
import { layout3D } from "../../src/lib/knowledge-graph/layout-3d";
import { layoutCompanies } from "../../src/lib/knowledge-graph/constellation";

const graph = combineGraphs([us, cn] as unknown as (KnowledgeGraph & { id: string; language: string })[]);
let html: string;
test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React from "react";import {createRoot} from "react-dom/client";import {AiKnowledgeGraph} from "./src/components/ai-knowledge-graph";import {LocaleProvider} from "./src/components/providers/locale-provider";createRoot(document.getElementById("root")).render(<LocaleProvider locale={new URLSearchParams(location.search).get("lang")==="en"?"en":"zh-CN"}><AiKnowledgeGraph/></LocaleProvider>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outfile: "graph.js", platform: "browser", plugins: [{ name: "map-account-fixture", setup(build) { build.onLoad({ filter: /auth-provider\.tsx$/ }, () => ({ loader: "tsx", contents: `const getIdToken = async () => "fixture"; const account = {user:{uid:"map-user"},getIdToken}; export function useOptionalAuth(){return new URLSearchParams(location.search).has("account") ? account : undefined;}` })); } }] });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#08131d;font-family:Arial}*{box-sizing:border-box}button,input{font:inherit} ${bundle.outputFiles.find(f => f.path.endsWith(".css"))?.text}</style></head><body><div id="root"></div><script>${bundle.outputFiles.find(f => f.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});
test("combination retains every company and isolates evidence IDs", () => {
  expect(graph.nodes.filter(n => n.kind === "COMPANY")).toHaveLength(129);
  expect(new Set(graph.sources.map(s => s.id)).size).toBe(graph.sources.length);
  const sourceIds = new Set(graph.sources.map(s => s.id));
  expect(graph.relationships.every(e => e.sourceIds.every(id => sourceIds.has(id)))).toBe(true);
  for (const markets of [["US"], ["CN_A"], ["US", "CN_A"]] as const) {
    const visible = filterGraph(graph, [...markets]);
    const positions = layoutGraph(visible.nodes).positions;
    expect(visible.nodes.every(n => positions.has(n.id))).toBe(true);
    expect(visible.relationships.every(e => positions.has(e.source) && positions.has(e.target))).toBe(true);
  }
});

for (const language of ["en", "zh-CN"]) test(`directory renders only on expansion and reuses graph data (${language})`, async ({ page }) => {
  let requests = 0;
  await page.route("**/*", route => {
    if (route.request().url().includes("/api/knowledge-graph")) {
      requests++;
      return route.fulfill({ json: graph });
    }
    return route.fulfill({ contentType: "text/html", body: html });
  });
  await page.goto(`http://graph.test/map?lang=${language}`);
  await expect(page.locator('span[role="status"]')).toContainText("129");
  const directory = page.getByRole("region", { name: language === "en" ? "AI companies and supply chain" : "AI 公司与产业链", exact: true });
  await expect(directory.locator("li")).toHaveCount(0);
  await directory.locator("summary").click();
  await expect(directory.getByRole("heading", { name: language === "en" ? "Documented company relationships" : "已收录公司关系", exact: true })).toBeVisible();
  expect(await directory.getByRole("link").count()).toBeGreaterThan(129);
  await directory.locator("summary").click();
  await expect(directory.locator("li")).toHaveCount(0);
  await directory.locator("summary").click();
  await expect(directory.locator("li").first()).toBeVisible();
  expect(requests).toBe(1);
});
test("star layout retains isolated companies and only draws recorded company edges", () => {
  const layout = layoutCompanies(graph);
  expect(layout.nodes).toHaveLength(129);
  expect(layout.edges).toEqual(graph.relationships.filter(e => e.type !== "PARTICIPATES_IN"));
  expect(layout.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y) && n.x >= 0 && n.x <= layout.width && n.y >= 0 && n.y <= layout.height)).toBe(true);
  expect(layoutCompanies(graph)).toEqual(layout);
});
test("graph renders, orbits and resets without extra controls", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill({ json: graph }) : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://graph.test/map?lang=en&view=3d");
  await expect(page.getByRole("button", { name: /^(2D|3D|Fit|Zoom in|Zoom out|Rotate left|Rotate right)$/ })).toHaveCount(0);
  await expect(page.getByRole("link", {name:"Filing explorer",exact:true})).toHaveCount(0);
  await expect(page.locator("canvas")).toBeVisible();

  await expect(page.getByRole("button", { name: "NVIDIA · NVDA", exact:true })).toBeVisible();
  await page.screenshot({fullPage:true,path:`output/graph-3d-${test.info().project.name}.png`});
  const label = page.getByRole("button", { name: "NVIDIA · NVDA", exact:true });
  await page.locator("canvas").scrollIntoViewIfNeeded();
  const before = await label.boundingBox();
  await page.locator("canvas").scrollIntoViewIfNeeded();
  const bounds = (await page.locator("canvas").boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width*.4,bounds.y + bounds.height*.65);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width*.7,bounds.y + bounds.height*.8,{steps:12}); await page.mouse.up();
  await expect.poll(async () => Math.abs((await label.boundingBox())!.x - before!.x)).toBeGreaterThan(2);
  await page.getByRole("textbox", {name:"Search companies"}).fill("688041");
  await page.getByRole("region", {name:"Search results"}).getByRole("button", {name:"海光信息 · 688041",exact:true}).click();
  await expect(page.getByRole("heading", { name: "海光信息",exact:true })).toBeVisible();
  await page.getByRole("button", { name:"Reset view",exact:true }).click();
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect(page.locator("canvas")).toBeVisible();
  expect(errors).toEqual([]);
});


test("devices without WebGL show an honest message without a mode switch", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type.includes("webgl")) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill({ json: graph }) : route.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en&view=3d");
  await expect(page.getByRole("alert")).toContainText("This browser cannot display the graph");
  await expect(page.getByRole("button", {name:/2D|3D/})).toHaveCount(0);
});

test("global search and company research links work in Chinese", async ({page}) => {
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill({json:graph}) : route.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=zh-CN");
  await expect(page.locator('span[role="status"]')).toContainText("129");
  await expect(page.getByRole("button", { name: /^(美股|A 股|全球及非上市)$/ })).toHaveCount(0);
  await page.getByRole("textbox",{name:"搜索公司"}).fill("NVDA");
  await page.getByRole("region", {name:/Search results|搜索结果/}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
  await expect(page.getByRole("heading",{name:"NVIDIA",exact:true})).toBeVisible();
  await page.getByText("研究来源", { exact: true }).click();
  await expect(page.getByRole("link",{name:"财报关系探索 →",exact:true})).toHaveAttribute("href","/map?view=filings&company=NVDA");
  expect(await page.getByRole("complementary").locator('a[href^="https://"]').count()).toBeGreaterThan(0);
  await page.getByRole("button",{name:"重置视图",exact:true}).click();
  await expect(page.getByRole("complementary")).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test("failed graph loads can retry", async ({page}) => {
  let fail=true;
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill(fail?{status:503,json:{error:"unavailable"}}:{json:graph}) : route.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en");
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  fail=false;
  await page.getByRole("button",{name:"Try again"}).click();
  await expect(page.locator('span[role="status"]')).toContainText("129");
  await expect(page.locator("canvas")).toBeVisible();
});

test("global company details remain available with legacy market filters", async ({ page }) => {
  const globalGraph: KnowledgeGraph = { ...graph, nodes: [...graph.nodes, { id: "ORG:LAB", kind: "COMPANY", name: "Independent Lab", symbol: "", market: "GLOBAL", country: "FR", listingStatus: "PRIVATE", listings: [], stageIds: ["cloud"], order: 150, sourceIds: [] }] };
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill({ json: globalGraph }) : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://graph.test/map?lang=en&graphMarkets=GLOBAL");
  await expect(page.locator('span[role="status"]')).toContainText("130 companies");
  await page.getByRole("textbox", { name: "Search companies" }).fill("Independent Lab");
  await page.getByRole("region", {name:"Search results"}).getByRole("button", { name: /Independent Lab/ }).click();
  await expect(page.getByRole("complementary")).toContainText("France · Private");
  await expect(page.getByRole("link", { name: "Company profile →" })).toHaveAttribute("href", "/company/ORG%3ALAB");
  await page.reload();
  await expect(page.locator('span[role="status"]')).toContainText("130 companies");
  await expect(page.getByRole("button", { name: /^(US stocks|A-shares|Global & private)$/ })).toHaveCount(0);
});

for (const language of ["en", "zh-CN"]) test(`journeys and relationship exploration (${language})`, async ({ page }) => {
 await page.route("**/*", r => r.request().url().includes("/api/knowledge-graph") ? r.fulfill({json:graph}) : r.fulfill({contentType:"text/html",body:html}));
 await page.goto(`http://graph.test/map?lang=${language}`);
 await expect(page.locator('span[role="status"]')).toContainText("129");
 await page.getByText(language === "en" ? "Guided journeys" : "探索路线", {exact:true}).click();
 await page.getByRole("button",{name:language === "en" ? "AI computing →" : "AI 算力 →",exact:true}).click();
 const focus = page.getByRole("region",{name:language === "en" ? "Selected connection" : "选中关系"});
 await expect(focus).toBeVisible();
 expect(await focus.locator('a[href^="https://"]').count()).toBeGreaterThan(0);
 await page.getByRole("button",{name:language === "en" ? "Next" : "下一步",exact:true}).click();
 await expect(page.getByRole("region",{name:language === "en" ? "Guided journey" : "探索路线"})).toContainText("2 /");
 let reached="US:NVDA"; for(const edge of connectionJourney(graph,reached).slice(0,2)) reached=edge.source===reached?edge.target:edge.source;
 await expect(page.getByRole("complementary").getByRole("heading",{level:2})).toHaveText(graph.nodes.find(n=>n.id===reached)!.name!);

 await focus.getByRole("button").click();
 await expect(page.getByRole("complementary")).toBeVisible();
 await expect(page.getByRole("link", {name:language === "en" ? "Sign in to follow" : "登录后关注"})).toHaveAttribute("href",/auth\?next=/);
});
test("follow is persisted and can be removed; failed saves do not claim success", async ({page})=>{
 let followed:string[]=[]; let fail=false;
 await page.route("**/*", async r=>{
  if(r.request().url().includes("/api/map-follows")){
   if(r.request().method()==="PATCH") {if(fail)return r.fulfill({status:503,json:{}});const body=r.request().postDataJSON(); followed=body.follow?[body.companyId]:[];}
   return r.fulfill({json:{companyIds:followed}});
  }
  return r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html});
 });
 await page.goto("http://graph.test/map?lang=en&account=1");
 await page.getByRole("textbox",{name:"Search companies"}).fill("NVDA");
 await page.getByRole("region", {name:/Search results|搜索结果/}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
 await page.getByRole("button",{name:"Follow company",exact:true}).click();
 await expect(page.getByRole("button",{name:"Unfollow",exact:true})).toBeVisible();
 expect(followed).toEqual(["US:NVDA"]);
 await page.reload();
 await page.getByText("Following · 1",{exact:true}).click();
 await page.getByRole("button",{name:"NVIDIA",exact:true}).click();
 await page.getByRole("button",{name:"Unfollow",exact:true}).click();
 expect(followed).toEqual([]);
 fail=true;await page.getByRole("button",{name:"Follow company",exact:true}).click();
 await expect(page.getByRole("alert")).toContainText("Could not");
 await expect(page.getByRole("button",{name:"Follow company",exact:true})).toBeVisible();
});

test("new connections use publication dates and open their evidence", async ({page})=>{
 const edge=graph.relationships.find(e=>e.type!=="PARTICIPATES_IN")!;
 const fresh={...graph,relationships:graph.relationships.map(e=>e.id===edge.id?{...e,publishedAt:new Date().toISOString()}:e)};
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:fresh}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto("http://graph.test/map?lang=en");
 await page.getByRole("button",{name:"What’s new · 1",exact:true}).click();
 const updates=page.getByRole("region",{name:"New connections"});
 await expect(updates.getByRole("button")).toHaveCount(1);
 await updates.getByRole("button").click();
 await expect(page.getByRole("region",{name:"Selected connection"})).toBeVisible();
});

test("missing followed companies can be removed from the list",async({page})=>{
 let ids=["ORG:REMOVED"];
 await page.route("**/*",r=>{
  if(r.request().url().includes("/api/map-follows")){if(r.request().method()==="PATCH")ids=[];return r.fulfill({json:{companyIds:ids}});}
  return r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html});
 });
 await page.goto("http://graph.test/map?lang=en&account=1");
 await page.getByText("Following · 1",{exact:true}).click();
 await page.getByRole("button",{name:"Unfollow",exact:true}).click();
 await expect(page.getByText("Following · 0",{exact:true})).toBeVisible();
});

test("opening relationship evidence preserves the current company",async({page})=>{
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto("http://graph.test/map?lang=en");
 await page.getByRole("textbox",{name:"Search companies"}).fill("NVDA");
 await page.getByRole("region", {name:/Search results|搜索结果/}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
 await page.getByRole("button",{name:"TSMC → NVIDIA",exact:true}).click();
 await expect(page.getByRole("complementary").getByRole("heading",{level:2})).toHaveText("NVIDIA");
 await page.getByRole("region",{name:"Selected connection"}).getByRole("button",{name:"Explore TSMC →"}).click();
 await expect(page.getByRole("complementary").getByRole("heading",{level:2})).toHaveText("TSMC");
});

for (const language of ["en", "zh-CN"]) test(`company browser focuses graph and search preserves connections (${language})`, async ({page})=>{
  await page.route("**/*",route=>route.request().url().includes("/api/knowledge-graph")?route.fulfill({json:graph}):route.fulfill({contentType:"text/html",body:html}));
  await page.goto(`http://graph.test/map?lang=${language}`);
  await expect(page.locator("canvas")).toBeVisible();
  const search=page.getByRole("textbox",{name:language==="en"?"Search companies":"搜索公司",exact:true});
  await search.fill("NVDA");
  await expect(page.locator('span[role="status"]')).toContainText("129");
  await page.getByRole("region",{name:language==="en"?"Search results":"搜索结果"}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
  await expect(page.getByRole("complementary")).toContainText("NVIDIA");
  await expect(search).toHaveValue("");
  await page.locator("summary").filter({hasText:language==="en"?"Browse companies":"浏览公司"}).click();
  await page.getByRole("textbox",{name:language==="en"?"Find a company in the list":"在列表中查找公司"}).fill("NVDA");
  const browser=page.locator("details").filter({has:page.getByRole("textbox",{name:language==="en"?"Find a company in the list":"在列表中查找公司"})});
  await expect(browser.getByRole("button")).toHaveCount(1);
  await browser.getByRole("button").click();
  await expect(page).toHaveURL(/company=US%3ANVDA/);
});

test("selected relationships stay readable and evidence remains actionable", async ({page},testInfo)=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route("**/*",route=>route.request().url().includes("/api/knowledge-graph")?route.fulfill({json:graph}):route.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en");
  await expect(page.locator("canvas")).toBeVisible();
  await expect.poll(()=>page.locator('button[class*="label3d"]:visible').count()).toBeGreaterThan(2);
  await page.screenshot({path:`output/map-readable-${testInfo.project.name}.png`});
  await page.getByRole("textbox",{name:"Search companies",exact:true}).fill("NVDA");
  await page.getByRole("region",{name:"Search results"}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
  await expect(page.getByRole("complementary")).toBeVisible();
  const labels=page.locator('button[class*="edgeLabel3d"]:visible');
  await expect.poll(()=>labels.count()).toBeGreaterThan(0);
  await labels.first().click();
  await expect(page.getByRole("region",{name:"Selected connection"})).toBeVisible();
});


test("zoom reveals relationship types without selecting a company", async ({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route("**/*",route=>route.request().url().includes("/api/knowledge-graph")?route.fulfill({json:graph}):route.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en");
  const canvas=page.locator("canvas");
  await expect(canvas).toBeVisible();
  await canvas.hover();
  await page.mouse.wheel(0,-1200);
  await expect.poll(()=>page.locator('button[class*="edgeLabel3d"]:visible').count()).toBeGreaterThan(0);
});


test("company layout retains real depth",()=>{
  const layout=layout3D(graph);
  expect(layout.nodes).toHaveLength(129);
  for(const axis of ["x","y","z"] as const){
    const positions=layout.nodes.map(n=>n[axis]);
    expect(Math.max(...positions)-Math.min(...positions)).toBeGreaterThan(150);
  }
});

test("company text grows on zoom in and shrinks on zoom out",async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en");
  const label=page.locator('button[class*="label3d"]').filter({hasText:"NVIDIA"}).locator("strong");
  await expect(label).toBeVisible();
  const fontSize=()=>label.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  const initial=await fontSize();
  await page.locator("canvas").hover({position:{x:20,y:100}});
  await page.mouse.wheel(0,-400);
  await expect.poll(fontSize).toBeGreaterThan(initial+.5);
  const enlarged=await fontSize();
  await page.mouse.wheel(0,400);
  await expect.poll(fontSize).toBeLessThan(enlarged-.5);
});

test("unclassified companies have their own spatial anchor",()=>{
 const layout=layout3D({...graph,nodes:[...graph.nodes,{id:"ORG:RELATED",kind:"COMPANY",name:"Related company",stageIds:["related"],market:"GLOBAL",order:999}]});
 const related=layout.nodes.find(n=>n.id==="ORG:RELATED")!;
 const semiconductor=layout.nodes.find(n=>n.stageIds?.[0]==="materials")!;
 expect([related.ax,related.ay,related.az]).not.toEqual([semiconductor.ax,semiconductor.ay,semiconductor.az]);
});

test("sector names scale with zoom and focus a 3D cluster",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto("http://graph.test/map?lang=en");
 const sectors=page.getByRole("button",{name:/^Focus sector:/});
 await expect.poll(()=>sectors.count()).toBeGreaterThan(0);
 const firstName=await sectors.first().getAttribute("aria-label");
 const sector=page.getByRole("button",{name:firstName!,exact:true});
 const initial=await sector.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
 await sector.click();
 await expect.poll(()=>page.locator(`button[aria-label="${firstName}"]`).evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(initial);
 await expect(page.getByRole("button",{name:"Reset view",exact:true})).toBeVisible();
});

test("selected relationship label has priority and company fonts stay compact",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto("http://graph.test/map?lang=en");
 await page.getByRole("textbox",{name:"Search companies",exact:true}).fill("NVDA");
 await page.getByRole("region",{name:"Search results"}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
 await page.getByRole("button",{name:"Dell Technologies → NVIDIA",exact:true}).click();
 await expect(page.getByRole("button",{name:"DELL Integrates technology from NVDA",exact:true})).toBeVisible();
 const largest=await page.locator('button[class*="label3d"] strong').evaluateAll(els=>Math.max(...els.map(el=>parseFloat(getComputedStyle(el).fontSize))));
 expect(largest).toBeLessThanOrEqual(14);
 await page.locator("canvas").scrollIntoViewIfNeeded();
 await page.screenshot({path:`output/cluster-labels-${test.info().project.name}.png`});
});
