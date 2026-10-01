import path from "node:path";
import { test, expect } from "@playwright/test";
import { build } from "esbuild";

let html = "";
test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: `import React from "react";
      import {createRoot} from "react-dom/client";
      import {LocaleProvider} from "./src/components/providers/locale-provider";
      import {ResearchQuickLinks,ResearchStartingPoints} from "./src/components/research-starting-points";
      import {researchStartingPoints} from "./src/lib/research/starting-points";
      createRoot(document.getElementById("root")).render(<LocaleProvider locale={location.pathname.startsWith("/zh-cn")?"zh-CN":"en"}><ResearchQuickLinks entries={researchStartingPoints}/><ResearchStartingPoints entries={researchStartingPoints}/></LocaleProvider>);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, outfile: "research-starts.js", platform: "browser",
    alias: { "next/link": path.resolve("tests/industry/link.tsx") },
    define: { "process.env.NODE_ENV": '"test"' },
  });
  const css = result.outputFiles.find(file => file.path.endsWith(".css"))!.text;
  const js = result.outputFiles.find(file => file.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script");
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="youanalyst-analytics" content="enabled"><style>body{margin:0;padding:24px;background:#060c19;font-family:Arial,sans-serif}*{box-sizing:border-box}${css}</style></head><body><main id="root"></main><script>${js}</script></body></html>`;
});

test.beforeEach(async ({ page }) => {
  // No local/deployed app, authentication, API calls or external requests.
  await page.route("**/*", route => {
    if (route.request().isNavigationRequest() && new URL(route.request().url()).hostname === "research-starts.test") return route.fulfill({ contentType: "text/html", body: html });
    return route.abort();
  });
});

for (const language of ["en", "zh-cn"]) test(`research starts are bilingual, source-linked and fit the viewport (${language})`, async ({ page }) => {
  await page.goto(`http://research-starts.test/${language}`);
  const section = page.getByRole("region", { name: language === "en" ? "Research and evidence" : "研究与证据" });
  await expect(section).toBeVisible();
  await expect(section.getByRole("article")).toHaveCount(3);
  const headings = section.getByRole("heading", { level: 2 });
  await expect(headings).toHaveText(language === "en" ? ["Who supplies NVIDIA? →", "Which AMD deployments are live? →", "Where are AI infrastructure bottlenecks? →"] : ["谁在为英伟达供货？ →", "AMD 的哪些部署已落地？ →", "AI 基础设施的瓶颈在哪里？ →"]);
  await expect(headings.nth(0).getByRole("link")).toHaveAttribute("href", `/${language}/research/nvidia-ai-ecosystem?relation=supplier#connections`);
  await expect(headings.nth(1).getByRole("link")).toHaveAttribute("href", `/${language}/research/amd-ai-ecosystem?product=EPYC&relation=integration#AMZN`);
  await expect(headings.nth(2).getByRole("link")).toHaveAttribute("href", `/${language}/research/ai-infrastructure-bottlenecks`);
  const evidence = section.getByRole("list", { name: language === "en" ? "Primary sources" : "原始来源" });
  await expect(evidence).toHaveCount(3);
  for (const source of await evidence.getByRole("link").all()) {
    await expect(source).toHaveAttribute("href", /^https:\/\//);
    await expect(source).toHaveAttribute("rel", "noopener noreferrer");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("question links support keyboard navigation and browser back/forward", async ({ page }) => {
  await page.goto("http://research-starts.test/en");
  const question = page.getByRole("navigation", { name: "Research starting points" }).getByRole("link", { name: "Who supplies NVIDIA?" });
  await page.keyboard.press("Tab");
  await expect(question).toBeFocused();
  await expect(question).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("http://research-starts.test/en/research/nvidia-ai-ecosystem?relation=supplier#connections");
  await page.goBack();
  await expect(page).toHaveURL("http://research-starts.test/en");
  await page.getByRole("link", { name: "AMD deployment progress" }).click();
  await expect(page).toHaveURL("http://research-starts.test/en/research/amd-ai-ecosystem?product=EPYC&relation=integration#AMZN");
  await page.goBack();
  await page.goForward();
  await expect(page).toHaveURL(/amd-ai-ecosystem\?product=EPYC&relation=integration#AMZN$/);
});

test("research starts reuse existing analytics and honor opt-out", async ({ page }) => {
  await page.goto("http://research-starts.test/en");
  // Keep the page in place to inspect the existing analytics queue after activation.
  await page.locator("main").evaluate(main => main.addEventListener("click", event => event.preventDefault()));
  await page.getByRole("navigation", { name: "Research starting points" }).getByRole("link", { name: "Who supplies NVIDIA?" }).click();
  await page.getByRole("link", { name: /NVIDIA FY2026 10-K/ }).click();
  expect(await page.evaluate(() => window.dataLayer?.map(value => Array.from(value as ArrayLike<unknown>)))).toEqual([
    ["event", "graph_discovery_open", { question_id: "nvidia-suppliers", entry_point: "homepage_research", graph_origin: "no", surface: "youanalyst", graph_version: "v2" }],
    ["event", "graph_source_open", { question_id: "nvidia-suppliers", entry_point: "homepage_research", graph_origin: "no", surface: "youanalyst", graph_version: "v2" }],
  ]);
  await page.evaluate(() => { window.dataLayer = []; document.cookie = "youanalyst_analytics_opt_out=1; Path=/"; });
  await page.getByRole("navigation", { name: "Research starting points" }).getByRole("link", { name: "Who supplies NVIDIA?" }).click();
  await page.getByRole("link", { name: /NVIDIA FY2026 10-K/ }).click();
  expect(await page.evaluate(() => window.dataLayer)).toEqual([]);
  await page.evaluate(() => { document.cookie = "youanalyst_analytics_opt_out=; Max-Age=0; Path=/"; document.querySelector('meta[name="youanalyst-analytics"]')!.setAttribute("content", "disabled"); });
  await page.getByRole("navigation", { name: "Research starting points" }).getByRole("link", { name: "Who supplies NVIDIA?" }).click();
  expect(await page.evaluate(() => window.dataLayer)).toEqual([]);
});


for (const language of ["en", "zh-cn"]) test(`compact intro contains only one benefit and three entry links (${language})`, async ({ page }) => {
  await page.goto(`http://research-starts.test/${language}`);
  const intro = page.getByRole("region", { name: language === "en" ? "Start your investment research" : "开始投资研究" });
  const links = intro.getByRole("link");
  await expect(links).toHaveText(language === "en" ? ["Who supplies NVIDIA? →", "AMD deployment progress →", "AI infrastructure bottlenecks →"] : ["谁在为英伟达供货？ →", "AMD 部署进展 →", "AI 基础设施瓶颈 →"]);
  await expect(intro.locator("p")).toHaveCount(1);
  await expect(intro.getByRole("article")).toHaveCount(0);
  await expect(intro.getByRole("list")).toHaveCount(0);
  expect((await intro.boundingBox())!.height).toBeLessThan(200);
  for (const link of await links.all()) {
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(36);
  }
  await links.nth(2).click();
  await expect(page).toHaveURL(`http://research-starts.test/${language}/research/ai-infrastructure-bottlenecks`);
});
