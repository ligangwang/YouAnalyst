import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import us from "../../data/ai-supply-chain/ai-us.json";
import cn from "../../data/ai-supply-chain/ai-cn-a.json";
import { combineGraphs, filterGraph, layoutGraph, type KnowledgeGraph } from "../../src/lib/knowledge-graph/model";

const graph = combineGraphs([us, cn] as unknown as (KnowledgeGraph & { id: string; language: string })[]);
let html: string;
test.beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React from "react";import {createRoot} from "react-dom/client";import {AiKnowledgeGraph} from "./src/components/ai-knowledge-graph";import {LocaleProvider} from "./src/components/providers/locale-provider";createRoot(document.getElementById("root")).render(<LocaleProvider locale={new URLSearchParams(location.search).get("lang")==="en"?"en":"zh-CN"}><AiKnowledgeGraph/></LocaleProvider>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outfile: "graph.js", platform: "browser" });
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
test("market toggles, search and sources work on the shared canvas", async ({ page }) => {
  await page.route("**/*", route => route.request().url().includes("/api/knowledge-graph") ? route.fulfill({ json: graph }) : route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("http://graph.test/map?lang=zh-CN");
  await expect(page.getByRole("heading", { name: "AI 产业知识图谱" })).toBeVisible();
  await expect(page.locator('span[role="status"]')).toContainText("129");
  await page.screenshot({path: `output/knowledge-${test.info().project.name}.png`});
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
  const links = page.getByRole("complementary").getByRole("link");
  expect(await links.count()).toBeGreaterThan(0);
  await expect(links.first()).toHaveAttribute("href", /^https:\/\//);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
  await expect(page.getByText("90%",{exact:true})).toBeVisible();
});


