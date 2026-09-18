import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { PerspectiveCamera, Vector3 } from "three";
import us from "../../data/ai-supply-chain/ai-us.json";
import cn from "../../data/ai-supply-chain/ai-cn-a.json";
import { combineGraphs, filterGraph, layoutGraph, type KnowledgeGraph } from "../../src/lib/knowledge-graph/model";
import { companySector } from "../../src/lib/knowledge-graph/sectors";
import { layout3D } from "../../src/lib/knowledge-graph/layout-3d";
import { layoutCompanies } from "../../src/lib/knowledge-graph/constellation";

const graph = combineGraphs([us, cn] as unknown as (KnowledgeGraph & { id: string; language: string })[]);
for(const sectorFocused of [false,true]) test(`line hover previews, click pins, and blank space clears (${sectorFocused?"sector":"overview"})`,async({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en");
  const canvas=page.locator("canvas"), labels=page.locator('[data-source]:visible');
  await expect(canvas).toBeVisible();
  await expect(page.locator('[data-company-id]:visible').first()).toBeVisible();
  await expect(labels).toHaveCount(0);
  if(sectorFocused){
    const toggle=page.getByRole("button",{name:/^Sectors/});
    if(await toggle.isVisible())await toggle.click();
    await page.getByRole("button",{name:"AI compute",exact:true}).click();
    await expect.poll(()=>page.locator('[data-sector-emphasis="member"]').count()).toBeGreaterThan(0);
  }
  await canvas.scrollIntoViewIfNeeded();
  const box=(await canvas.boundingBox())!;
  const layout=layout3D(graph);
  const members=layout.nodes.filter(n=>companySector(n).id==="compute");
  const center=sectorFocused?members.reduce((v,n)=>v.add(new Vector3(n.x,n.y,n.z)),new Vector3()).divideScalar(members.length):new Vector3();
  const radius=sectorFocused?Math.max(80,...members.map(n=>new Vector3(n.x,n.y,n.z).distanceTo(center))):layout.radius;
  const distance=radius/Math.sin(Math.atan(Math.tan(Math.PI/8)*Math.min(1,box.width/box.height)))*(sectorFocused?1.1:1.15);
  const camera=new PerspectiveCamera(45,box.width/box.height,1,10000);
  camera.position.set(center.x+distance*.2,center.y+distance*.12,center.z+distance);camera.lookAt(center);camera.updateMatrixWorld();
  let hit:{x:number;y:number}|undefined;
  for(const edge of layout.edges){
    const a=layout.nodes.find(n=>n.id===edge.source)!,b=layout.nodes.find(n=>n.id===edge.target)!;
    const p=new Vector3(a.x,a.y,a.z).lerp(new Vector3(b.x,b.y,b.z),.55).project(camera);
    const x=box.x+(p.x+1)*box.width/2,y=box.y+(1-p.y)*box.height/2;
    await page.mouse.move(x,y);await page.waitForTimeout(60);
    if(await labels.count()){hit={x,y};break;}
  }
  expect(hit).toBeDefined();
  await expect(labels).toHaveCount(1);
  await page.mouse.click(hit!.x,hit!.y);
  await expect(page.locator("[data-sector-emphasis]")).toHaveCount(0);
  await expect(page.getByRole("region",{name:"Selected connection",exact:true})).toBeVisible();
  await page.mouse.move(5,5);
  await expect(page.locator('[data-active="true"]:visible')).toHaveCount(1);
  await canvas.scrollIntoViewIfNeeded();const current=(await canvas.boundingBox())!;
  await page.mouse.click(current.x+5,current.y+5);
  await expect(labels).toHaveCount(0);
  await expect(page.getByRole("region",{name:"Selected connection",exact:true})).toHaveCount(0);
});
let html: string;
test("event deep link opens source evidence beside the selected company", async ({page}) => {
  page.on("pageerror", error => { throw error; });
  await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en&company=US%3AAMD&event=amd-cisco-humain-live-20260831");
  const evidence=page.getByRole("region",{name:"Selected event evidence"});
  await expect(evidence.getByRole("heading",{name:"AMD and Cisco report HUMAIN systems are live"})).toBeVisible();
  await expect(evidence.getByRole("link")).toHaveAttribute("href",/ir.amd.com\/news-events\/press-releases\/detail\/1298/);
  await expect(evidence).toContainText("2026-08-31");
  await page.getByRole("button",{name:"Clear selection"}).click();
  await expect(evidence).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has("event")).toBe(false);
});
test("admin edits a company name in place and stale edits show a conflict", async ({page}) => {
 const localized = structuredClone(graph);
 const tsm = localized.nodes.find(n => n.id === "US:TSM")!;
 tsm.names = {en:"TSMC", "zh-CN":"台积公司"};
 let edits = 0;
 await page.route("**/*", async route => {
   const url = new URL(route.request().url());
   if (url.pathname === "/api/knowledge-graph") return route.fulfill({json:localized});
   if (url.pathname === "/api/admin/me") return route.fulfill({json:{isAdmin:true}});
   if (url.pathname === "/api/map-follows") return route.fulfill({json:{followedCompanyIds:[]}});
   if (url.pathname === "/api/admin/company-names") {
     expect(route.request().method()).toBe("PATCH");
     expect(route.request().headers().authorization).toBe("Bearer fixture");
     edits++;
     if (edits > 1) return route.fulfill({status:409,json:{error:"Conflict"}});
     expect(route.request().postDataJSON()).toEqual({companyId:"US:TSM",locale:"zh-CN",name:"台积电",expectedName:"台积公司"});
     return route.fulfill({json:{companyId:"US:TSM",names:{en:"TSMC","zh-CN":"台积电"},aliases:["台积公司"]}});
   }
   return route.fulfill({contentType:"text/html",body:html});
 });
 await page.goto("http://graph.test/map?account&lang=zh-CN");
 await page.getByRole("textbox",{name:"搜索公司",exact:true}).fill("TSM");
 await page.getByRole("region",{name:"搜索结果"}).getByRole("button",{name:"台积公司 · TSM",exact:true}).click();
 await page.getByRole("button",{name:"修改显示名",exact:true}).click();
 await page.getByRole("textbox",{name:"中文显示名",exact:true}).fill("台积电");
 await page.getByRole("button",{name:"保存",exact:true}).click();
 await expect(page.getByRole("heading",{name:"台积电",exact:true})).toBeVisible();
 await expect(page.getByText("显示名已保存。",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"修改显示名",exact:true}).click();
 await page.getByRole("textbox",{name:"中文显示名",exact:true}).fill("台積電");
 await page.getByRole("button",{name:"保存",exact:true}).click();
 await expect(page.getByText("名称已被修改，请刷新页面后再编辑。",{exact:true})).toBeVisible();
 await expect(page.getByRole("heading",{name:"台积电",exact:true})).toBeVisible();
});
test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React from "react";import {createRoot} from "react-dom/client";import {AiKnowledgeGraph} from "./src/components/ai-knowledge-graph";import {LocaleProvider} from "./src/components/providers/locale-provider";createRoot(document.getElementById("root")).render(<LocaleProvider locale={new URLSearchParams(location.search).get("lang")==="en"?"en":"zh-CN"}><AiKnowledgeGraph initialCompany={new URLSearchParams(location.search).get("company") ?? ""} initialEvent={new URLSearchParams(location.search).get("event") ?? ""} initialEdge={new URLSearchParams(location.search).get("relationship") ?? ""}/></LocaleProvider>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outfile: "graph.js", platform: "browser", define: {"process.env":"{}"}, plugins: [{ name: "map-account-fixture", setup(build) { build.onLoad({ filter: /auth-provider\.tsx$/ }, () => ({ loader: "tsx", contents: `const getIdToken = async () => "fixture"; const account = {user:{uid:"map-user"},getIdToken}; export function useOptionalAuth(){return new URLSearchParams(location.search).has("account") ? account : undefined;} export function useAuth(){return {...(useOptionalAuth() ?? {user:null,getIdToken}),loading:false};}` })); } }] });
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


test("devices without WebGL keep the directory collapsed until requested", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type.includes("webgl")) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill({ json: graph }) : route.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en&view=3d");
  await expect(page.getByRole("alert")).toContainText("This browser cannot display the 3D graph");
  const directory = page.getByRole("region", {name:"AI companies and supply chain",exact:true});
  await expect(directory.locator("details").first()).not.toHaveAttribute("open", "");
  await expect(directory.locator("li")).toHaveCount(0);
  await directory.locator("summary").click();
  await expect(directory.locator("li").first()).toBeVisible();
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
  await expect(page.getByRole("link",{name:"财报关系探索 →",exact:true})).toHaveCount(0);
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

for (const language of ["en", "zh-CN"]) test(`sector legend replaces discovery controls (${language})`, async ({page}) => {
 let followRequests = 0;
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*", r => {
  if(r.request().url().includes("/api/map-follows")) followRequests++;
  return r.request().url().includes("/api/knowledge-graph") ? r.fulfill({json:graph}) : r.fulfill({contentType:"text/html",body:html});
 });
 await page.goto(`http://graph.test/map?lang=${language}&account=1`);
 await expect(page.locator("canvas")).toBeVisible();
 await expect(page.getByText(/Guided journeys|探索路线|What’s new|Following ·/)).toHaveCount(0);
 const toggle=page.getByRole("button",{name:language==="en"?/^Sectors/:/^产业环节/});
 const compact=(page.viewportSize()?.width??1280)<=800;
 if(compact){
  await expect(toggle).toHaveAttribute("aria-expanded","false");
  await expect(page.getByText(language==="en"?"Tap a line for relationship evidence":"点按连线查看关系依据",{exact:true})).toBeVisible();
 }else{
  await expect(toggle).toBeHidden();
  await expect(page.getByText(language==="en"?"Hover a line to preview · Click for evidence":"悬停连线预览关系 · 点击查看依据",{exact:true})).toBeVisible();
 }
 async function revealSectors(){if(compact)await toggle.click();}
 const sector = page.getByRole("button",{name:language === "en" ? "AI compute" : "AI 算力",exact:true,includeHidden:true});
 await revealSectors();
 await sector.click();
 await expect(sector).toHaveAttribute("aria-pressed","true");
 await expect.poll(()=>page.locator('[data-sector-emphasis="member"]').count()).toBeGreaterThan(0);
 await revealSectors();
 await sector.click();
 await expect(sector).toHaveAttribute("aria-pressed","false");
 await expect(page.locator('[data-sector-emphasis]')).toHaveCount(0);
 await revealSectors();
 await sector.click();
 await page.getByRole("button",{name:language === "en" ? "Reset view" : "重置视图",exact:true}).click();
 await expect(sector).toHaveAttribute("aria-pressed","false");
 expect(followRequests).toBe(0);
});

test("opening relationship evidence preserves the current company",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto("http://graph.test/map?lang=en");
 await page.getByRole("textbox",{name:"Search companies"}).fill("NVDA");
 await page.getByRole("region", {name:/Search results|搜索结果/}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
 const canvas=page.locator("canvas");
 await canvas.scrollIntoViewIfNeeded();
 const bounds=(await canvas.boundingBox())!;
 const anchor=page.locator('[data-company-id="US:TSM"]');
 const projection=()=>anchor.evaluate(el=>el.parentElement!.parentElement!.style.transform);
 const initial=await projection();
 await page.mouse.move(bounds.x+bounds.width*.45,bounds.y+bounds.height*.65);
 await page.mouse.down();
 await page.mouse.move(bounds.x+bounds.width*.6,bounds.y+bounds.height*.7,{steps:12});
 await page.mouse.up();
 await expect.poll(projection).not.toBe(initial);
 await page.waitForTimeout(800);
 const orbited=await projection();
 expect(orbited).toContain("translate");
 await page.getByRole("button",{name:"TSMC → NVIDIA",exact:true}).click();
 await expect.poll(projection).toBe(orbited);
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
  await page.mouse.move(5,5);
  const labels=page.locator('button[class*="edgeLabel3d"]:visible');
  await expect(labels).toHaveCount(0);
  await page.getByRole("button",{name:"Dell Technologies → NVIDIA",exact:true}).click();
  await expect(labels).toHaveCount(1);
  await labels.first().click();
  await expect(page.getByRole("region",{name:"Selected connection"})).toBeVisible();
});


test("unselected zoom never shows context-free relationship labels", async ({page})=>{
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route("**/*",route=>route.request().url().includes("/api/knowledge-graph")?route.fulfill({json:graph}):route.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en");
  const canvas=page.locator("canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(()=>page.locator('[data-company-id]:visible').count()).toBeGreaterThan(0);
  await canvas.hover({position:{x:20,y:100}});
  await page.mouse.wheel(0,-1200);
  await expect.poll(()=>page.locator('[data-source]').evaluateAll(els=>{
    const nodes=[...document.querySelectorAll('[data-company-id]')].filter(el=>el.checkVisibility({visibilityProperty:true})).map(el=>el.getAttribute('data-company-id'));
    return els.filter(el=>el.checkVisibility({visibilityProperty:true})).filter(el=>!nodes.includes(el.getAttribute('data-source'))&&!nodes.includes(el.getAttribute('data-target'))).length;
  })).toBe(0);
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
 await expect(page.getByRole("button",{name:"NVIDIA · NVDA",exact:true})).toBeVisible();
 const largest=await page.locator('button[class*="label3d"] strong').evaluateAll(els=>Math.max(...els.map(el=>parseFloat(getComputedStyle(el).fontSize))));
 expect(largest).toBeLessThanOrEqual(14);
 await page.locator("canvas").scrollIntoViewIfNeeded();
 await page.screenshot({path:`output/cluster-labels-${test.info().project.name}.png`});
});

for(const language of ["en","zh-CN"]) test(`company names and cross-language search follow locale (${language})`,async({page})=>{
 const localized=structuredClone(graph);
 const nvda=localized.nodes.find(n=>n.id==="US:NVDA")!;
 nvda.names={en:"NVIDIA", "zh-CN":"英伟达"};nvda.aliases=["辉达"];
 const display=language==="en"?"NVIDIA":"英伟达";
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:localized}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto(`http://graph.test/map?lang=${language}`);
 const search=page.getByRole("textbox",{name:language==="en"?"Search companies":"搜索公司",exact:true});
 for(const query of ["NVIDIA","英伟达","辉达"]){
  await search.fill(query);
  await expect(page.getByRole("region",{name:language==="en"?"Search results":"搜索结果"}).getByRole("button",{name:`${display} · NVDA`,exact:true})).toBeVisible();
 }
 await page.getByRole("region",{name:language==="en"?"Search results":"搜索结果"}).getByRole("button").click();
 await expect(page.getByRole("heading",{name:display,exact:true})).toBeVisible();
 await expect(page.locator('[data-company-id="US:NVDA"]')).toHaveText(`${display}NVDA`);
 await expect(page.locator('[data-company-id="US:NVDA"]')).toBeVisible();
});

test("relationship labels always have a visible company endpoint",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto("http://graph.test/map?lang=en");
 await page.getByRole("textbox",{name:"Search companies",exact:true}).fill("NVDA");
 await page.getByRole("region",{name:"Search results"}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
 await page.getByRole("button",{name:"Dell Technologies → NVIDIA",exact:true}).click();
 await expect(page.locator('[data-active="true"]')).toBeVisible();
 const orphanLabels=()=>page.locator('[data-source]').evaluateAll(els=>{
  const visible=(el:Element)=>el.checkVisibility({visibilityProperty:true});
  const nodes=[...document.querySelectorAll('[data-company-id]')].filter(visible).map(el=>el.getAttribute('data-company-id'));
  return els.filter(visible).filter(el=>!nodes.includes(el.getAttribute('data-source'))&&!nodes.includes(el.getAttribute('data-target'))).length;
 });
 await expect.poll(orphanLabels).toBe(0);
 const canvas=page.locator("canvas");
 // Labels can now occupy this point; move the real pointer without requiring bare canvas.
 const hoverGraph=async()=>{await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();expect(box).not.toBeNull();await page.mouse.move(box!.x+20,box!.y+100);};
 await hoverGraph();
 await page.mouse.wheel(0,-2500);
 await expect.poll(orphanLabels).toBe(0);
 await hoverGraph();await page.mouse.wheel(0,2500);
 await expect.poll(orphanLabels).toBe(0);
});


test("company labels keep their placement during rotation and after release",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto("http://graph.test/map?lang=en");
 const canvas=page.locator("canvas");
 await expect(page.locator('[data-company-id]:visible').first()).toBeVisible();
 await canvas.scrollIntoViewIfNeeded();
 const sides=()=>page.locator('[data-company-id]:visible').evaluateAll(els=>els.map(el=>({id:el.getAttribute('data-company-id'),x:Math.sign(parseFloat((el as HTMLElement).style.getPropertyValue('--label-offset-x'))),y:Math.sign(parseFloat((el as HTMLElement).style.getPropertyValue('--label-offset-y')))})));
 const box=(await canvas.boundingBox())!;
 await page.mouse.move(box.x+box.width*.2,box.y+box.height*.8);
 await page.mouse.down();
 const before=await sides();
 await page.mouse.move(box.x+box.width*.28,box.y+box.height*.82,{steps:10});
 const during=await sides();
 const retained=during.filter(n=>before.some(b=>b.id===n.id));
 expect(retained.length).toBeGreaterThan(5);
 for(const node of retained)expect(node).toEqual(before.find(b=>b.id===node.id));
 // Let camera damping finish while held, then isolate the release from projection changes.
 await page.waitForTimeout(1000);
 const held=await sides();
 expect(held.some(node=>!before.some(old=>old.id===node.id))).toBe(true);
 expect(before.some(node=>!held.some(current=>current.id===node.id))).toBe(true);
 for(const node of held.filter(node=>before.some(old=>old.id===node.id)))expect(node).toEqual(before.find(old=>old.id===node.id));
 await page.mouse.up();
 await page.waitForTimeout(1000);
 expect(await sides()).toEqual(held);
 const hiddenPoints=await page.locator('[data-company-id]').evaluateAll(els=>els.filter(el=>getComputedStyle(el).visibility==='hidden').map(el=>{
   const box=el.parentElement!.getBoundingClientRect();
   return {id:el.getAttribute('data-company-id')!,x:box.x+box.width/2,y:box.y+box.height/2};
 }).filter(point=>document.elementFromPoint(point.x,point.y) instanceof HTMLCanvasElement));
 let revealed=false;
 for(const point of hiddenPoints.slice(0,20)){
   await page.mouse.move(point.x,point.y);
   const label=page.locator(`[data-company-id="${point.id}"]`);
   await page.waitForTimeout(80);
   if(await label.getAttribute('data-highlighted')!=='true')continue;
   await expect(label).toBeVisible();
   expect((await sides()).filter(node=>node.id!==point.id)).toEqual(held);
   revealed=true;break;
 }
 expect(revealed).toBe(true);
 await page.mouse.move(1,1);
 await expect.poll(sides).toEqual(held);
 await page.screenshot({path:'output/stable-rotation-'+test.info().project.name+'.png'});
});


test("company name emphasis scales gradually and respects reduced motion",async({page})=>{
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.route("**/*",r=>r.request().url().includes("/api/knowledge-graph")?r.fulfill({json:graph}):r.fulfill({contentType:"text/html",body:html}));
 await page.goto("http://graph.test/map?lang=en");
 const label=page.locator('[data-company-id="US:NVDA"]');
 await expect(label).toBeVisible();
 await page.locator("canvas").scrollIntoViewIfNeeded();
 const initial=await label.evaluate(el=>parseFloat((el as HTMLElement).style.getPropertyValue('--label-scale')));
 await page.getByRole("textbox",{name:"Search companies",exact:true}).fill("NVDA");
 await page.emulateMedia({reducedMotion:"no-preference"});
 const samples=page.evaluate(()=>new Promise<number[]>(resolve=>{
   const el=document.querySelector('[data-company-id="US:NVDA"]') as HTMLElement;
   const values:number[]=[];
   const observer=new MutationObserver(()=>values.push(parseFloat(el.style.getPropertyValue('--label-scale'))));
   observer.observe(el,{attributes:true,attributeFilter:['style']});
   setTimeout(()=>{observer.disconnect();resolve(values);},900);
 }));
 await page.getByRole("region",{name:"Search results",exact:true}).getByRole("button",{name:"NVIDIA · NVDA",exact:true}).click();
 const values=await samples;
 expect(new Set(values.filter(v=>v>initial+.01&&v<1.14)).size).toBeGreaterThan(2);
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.getByRole("button",{name:"Reset view",exact:true}).click();
 await page.mouse.move(1,1);
 await expect.poll(()=>label.evaluate(el=>parseFloat((el as HTMLElement).style.getPropertyValue('--label-scale')))).toBeCloseTo(initial,2);
});

test("company selection dims unrelated names and restores them on clear", async ({page}) => {
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route("**/*", r => r.request().url().includes("/api/knowledge-graph") ? r.fulfill({json:graph}) : r.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en&company=US%3AAMD");
  const selected = page.locator('[data-company-id="US:AMD"]');
  await expect(selected).toHaveAttribute("data-company-focus", "selected");
  await expect(selected).toHaveCSS("opacity", "1");
  const layout = layout3D(graph);
  const related = new Set(layout.edges.filter(e => e.source === "US:AMD" || e.target === "US:AMD").flatMap(e => [e.source,e.target]));
  const connected = layout.nodes.find(n => n.id !== "US:AMD" && related.has(n.id))!;
  const unrelated = layout.nodes.find(n => n.id !== "US:AMD" && !related.has(n.id))!;
  await expect(page.locator(`[data-company-id="${connected.id}"]`)).toHaveCSS("opacity", "1");
  const background = page.locator(`[data-company-id="${unrelated.id}"]`);
  await expect(background).toHaveAttribute("data-company-focus", "background");
  await expect(background).toHaveCSS("opacity", "0.18");
  await expect(page.locator("[data-company-id]")).toHaveCount(layout.nodes.length);
  const nextNode = page.locator('[data-company-focus="background"]:visible').first();
  const nextId = (await nextNode.getAttribute("data-company-id"))!;
  await nextNode.click({force:true});
  await expect(page.locator(`[data-company-id="${nextId}"]`)).toHaveAttribute("data-company-focus", "selected");
  await page.mouse.move(0,0);
  await expect(selected).toHaveAttribute("data-company-focus", "background");
  await expect(selected).toHaveCSS("opacity", "0.18");
  await page.getByRole("button",{name:"Clear selection",exact:true}).click();
  await expect(page.locator("[data-company-focus]")).toHaveCount(0);
  await expect(background).toHaveCSS("opacity", "1");
});
