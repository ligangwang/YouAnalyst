import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import us from "../../data/ai-supply-chain/ai-us.json";
import cn from "../../data/ai-supply-chain/ai-cn-a.json";
import { combineGraphs, filterGraph, layoutGraph, type KnowledgeGraph } from "../../src/lib/knowledge-graph/model";
import { layoutCompanies } from "../../src/lib/knowledge-graph/constellation";

const graph = combineGraphs([us, cn] as unknown as (KnowledgeGraph & { id: string; language: string })[]);
let html: string;
test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React from "react";import {createRoot} from "react-dom/client";import {AiKnowledgeGraph} from "./src/components/ai-knowledge-graph";import {LocaleProvider} from "./src/components/providers/locale-provider";createRoot(document.getElementById("root")).render(<LocaleProvider locale={new URLSearchParams(location.search).get("lang")==="en"?"en":"zh-CN"}><AiKnowledgeGraph initialView={new URLSearchParams(location.search).get("view")==="3d"?"3d":"2d"}/></LocaleProvider>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outfile: "graph.js", platform: "browser" });
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
test("star layout retains isolated companies and only draws recorded company edges", () => {
  const layout = layoutCompanies(graph);
  expect(layout.nodes).toHaveLength(129);
  expect(layout.edges).toEqual(graph.relationships.filter(e => e.type !== "PARTICIPATES_IN"));
  expect(layout.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y) && n.x >= 0 && n.x <= layout.width && n.y >= 0 && n.y <= layout.height)).toBe(true);
  expect(layoutCompanies(graph)).toEqual(layout);
});
test("market toggles, search and sources work on the shared canvas", async ({ page }) => {
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill({ json: graph }) : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://graph.test/map?lang=zh-CN");
  await expect(page.getByRole("heading", { name: "公司图谱" })).toBeVisible();
  await expect(page.locator('span[role="status"]')).toContainText("129");
  await expect(page.locator('[data-company-node]')).toHaveCount(129);
  await expect(page.locator('[data-company-edge]')).toHaveCount(graph.relationships.filter(e => e.type !== "PARTICIPATES_IN").length);
  await page.screenshot({fullPage: true, path: `output/knowledge-${test.info().project.name}.png`});
  await page.getByRole("button", { name: "美股", exact: true }).click();
  await expect(page.locator('span[role="status"]')).toContainText("62");
  await expect(page.getByRole("button", { name: /NVIDIA/ })).toHaveCount(0);
  await expect(page).toHaveURL(/market=CN_A/);
  await page.getByRole("button", { name: "A 股", exact: true }).click();
  await expect(page.getByText("开启一个市场以查看公司。")).toBeVisible();

  await page.getByRole("button", { name: "美股", exact: true }).click();
  await expect(page.locator('span[role="status"]')).toContainText("67");
  await page.getByRole("textbox", { name: "搜索公司" }).fill("NVDA");
  await expect(page.locator('span[role="status"]')).toContainText("1 家公司");
  await page.getByRole("button", { name: /NVIDIA/ }).click();
  await expect(page.getByRole("heading", { name: "NVIDIA", exact: true })).toBeVisible();
  const links = page.getByRole("complementary").locator('a[href^="https://"]');
  expect(await links.count()).toBeGreaterThan(0);
  await expect(links.first()).toHaveAttribute("href", /^https:\/\//);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test("A-share profile links and keyboard camera controls work", async ({ page }) => {
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill({ json: graph }) : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://graph.test/map?lang=zh-CN");
  await page.getByRole("textbox", { name: "搜索公司" }).fill("688041");
  const node = page.locator('[data-company-node="XSHG:688041"]');
  const canvas = page.getByRole("region", { name: /公司图谱/ });
  const before = await node.boundingBox();
  await canvas.focus(); await page.keyboard.press("ArrowRight");
  expect((await node.boundingBox())!.x).toBeLessThan(before!.x);
  await page.getByRole("button", { name: "全图", exact: true }).click();
  await expect.poll(async () => (await node.boundingBox())!.x).toBeCloseTo(before!.x, 0);
  await node.click();
  await expect(page.getByRole("complementary").getByRole("link", { name: "公司详情 →" })).toHaveAttribute("href", "/ticker/XSHG:688041");
  await expect(page.getByRole("heading", { name: "海光信息", exact: true })).toBeVisible();
});
test("failed loads retry and English controls remain usable", async ({ page }) => {
  let fail = true;
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill(fail ? {status:503,json:{error:"unavailable"}} : {json:graph}) : route.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en");
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  fail = false;
  await page.getByRole("button", {name:"Try again"}).click();
  await expect(page.locator('span[role="status"]')).toContainText("129");
  await page.getByRole("button", {name:"Zoom in",exact:true}).click();
  await expect(page.getByText("120%",{exact:true})).toBeVisible();
});
test("rotation moves companies and edges together and Fit restores the view", async ({ page }) => {
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill({ json: graph }) : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://graph.test/map?lang=en");
  const node = page.locator('[data-company-node="US:ASML"]');
  await expect(node).toBeAttached();
  const before = await node.boundingBox();
  const edge = page.locator('[data-company-edge]').first();
  const path = await edge.getAttribute("d");
  await page.getByRole("button", { name: "Rotate right", exact: true }).click();
  await expect(page.getByLabel("Rotation", { exact: true })).toHaveText("15°");
  const after = await node.boundingBox();
  expect(Math.hypot(after!.x - before!.x, after!.y - before!.y)).toBeGreaterThan(1);
  expect(await edge.getAttribute("d")).not.toBe(path);
  await page.getByRole("button", { name: "Rotate left", exact: true }).click();
  await expect(page.getByLabel("Rotation", { exact: true })).toHaveText("0°");
  expect((await node.boundingBox())!.x).toBeCloseTo(before!.x, 0);
  const canvas = page.getByRole("region", { name: /Company graph/ });
  await canvas.focus(); await page.keyboard.press("Shift+ArrowLeft");
  await expect(page.getByLabel("Rotation", { exact: true })).toHaveText("345°");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await expect(page.getByLabel("Rotation", { exact: true })).toHaveText("0°");
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test("3D scene renders, orbits, focuses a company and switches back to 2D", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill({ json: graph }) : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://graph.test/map?lang=en&view=3d");
  await expect(page.getByRole("button", { name: "3D", exact:true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Focus company" })).toBeVisible();
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
  await page.getByRole("combobox", { name: "Focus company" }).selectOption("XSHG:688041");
  await expect(page.getByRole("heading", { name: "海光信息",exact:true })).toBeVisible();
  await page.getByRole("button", { name:"Fit",exact:true }).click();
  await expect(page.getByRole("combobox", { name:"Focus company" })).toHaveValue("");
  await page.getByRole("button", {name:"2D",exact:true}).click();
  await expect(page.locator('[data-company-node]')).toHaveCount(129);
  expect(errors).toEqual([]);
});


test("devices without WebGL can open the 2D graph", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type.includes("webgl")) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill({ json: graph }) : route.fulfill({contentType:"text/html",body:html}));
  await page.goto("http://graph.test/map?lang=en&view=3d");
  await page.getByRole("button", {name:"Open 2D map",exact:true}).click();
  await expect(page.locator('[data-company-node]')).toHaveCount(129);
  await expect(page.getByRole("button", {name:"2D",exact:true})).toHaveAttribute("aria-pressed","true");
});
