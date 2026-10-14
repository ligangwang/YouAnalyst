import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import us from "../../data/ai-supply-chain/ai-us.json";
import cn from "../../data/ai-supply-chain/ai-cn-a.json";
import { combineGraphs, type KnowledgeGraph } from "../../src/lib/knowledge-graph/model";

// The real company search card and AI-map company list, with Next's router mocked: a push
// records the destination and renders it, so navigation is observable without a server.
const origin = "http://companies.test";
const graph = combineGraphs([us, cn] as unknown as (KnowledgeGraph & { id: string; language: string })[]);
const nvidia = { id: "US:NVDA", kind: "ticker", symbol: "NVDA", name: "NVIDIA Corporation", exchange: "NASDAQ", micCode: "XNAS", type: "Common Stock", market: "US" };
const leveraged = { id: "US:NVDL", kind: "ticker", symbol: "NVDL", name: "GraniteShares 2x Long NVDA Daily ETF", exchange: "NASDAQ", micCode: "XNAS", type: "ETF", market: "US" };
const openai = { id: "ORG:OPENAI", kind: "ticker", symbol: "ORG:OPENAI", name: "OpenAI", exchange: null, micCode: null, type: null, market: "GLOBAL" };
let html: string;

test.beforeAll(async () => {
  const mock = path.resolve("tests/conversion/fixtures/mocks.tsx");
  const bundled = await build({
    stdin: { contents: `
      import React, { useSyncExternalStore } from "react";
      import { createRoot } from "react-dom/client";
      import { CompanySearchCard } from "./src/components/company-search-card";
      import { MostConnectedCompanies } from "./src/components/most-connected-companies";
      import { LocaleProvider } from "./src/components/providers/locale-provider";
      const subscribe = (notify) => { window.addEventListener("route-change", notify); return () => window.removeEventListener("route-change", notify); };
      function App() {
        const path = useSyncExternalStore(subscribe, () => location.pathname);
        const locale = new URLSearchParams(location.search).get("lang") === "zh-CN" ? "zh-CN" : "en";
        return <LocaleProvider locale={locale}>{path === "/" ? <><CompanySearchCard /><MostConnectedCompanies /></> : <p>Destination {path}</p>}</LocaleProvider>;
      }
      createRoot(document.getElementById("root")).render(<App />);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: "fixture.js", platform: "browser", define: { "process.env": "{}" },
    alias: { "next/navigation": mock, "next/link": mock, "@/components/providers/auth-provider": mock },
  });
  // esbuild does not compile Tailwind. Keep the suggestion list and the Go button laid out as
  // on the site, so a list that covered the button would fail these tests.
  const positioning = ".relative{position:relative}.absolute{position:absolute}.top-full{top:100%}.left-0{left:0}.right-0{right:0}.z-20{z-index:20}.grid{display:grid}.gap-3{gap:.75rem}.max-h-72{max-height:18rem}.overflow-y-auto{overflow-y:auto}.bg-slate-950{background:#020617}.grid-cols-\\[minmax\\(0\\,1fr\\)_auto\\]{grid-template-columns:minmax(0,1fr) auto}";
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${positioning}${bundled.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? ""}</style></head><body><div id="root"></div><script>${bundled.outputFiles.find(file => file.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});

async function open(page: Page, query = "", delayMs = 0) {
  const searches: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin || request.method() !== "GET") return route.abort();
    if (url.pathname === "/api/tickers/search") {
      searches.push(url.search);
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      const q = url.searchParams.get("q")?.toUpperCase() ?? "";
      const items = q.startsWith("OPEN") ? [openai] : q.startsWith("NV") ? [nvidia, leveraged] : [];
      return route.fulfill({ json: { items: items.slice(0, Number(url.searchParams.get("limit") ?? 8)) } });
    }
    if (url.pathname === "/api/knowledge-graph") return route.fulfill({ json: graph });
    if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${origin}/${query}`);
  return searches;
}
const input = (page: Page) => page.getByRole('combobox', {name:/^(Search company|搜索公司)$/});
async function launch(page:Page) { await page.getByRole('button',{name:/^(Search company|搜索公司)$/}).click(); }
for (const chinese of [false,true]) test(`shared company dialog selects and navigates in ${chinese?'Chinese':'English'}`,async({page})=>{
  await open(page,chinese?'?lang=zh-CN':'');await launch(page);
  await expect(input(page)).toBeFocused();await input(page).fill('nvidia');
  await expect(page.getByRole('option')).toHaveCount(2);
  await input(page).press('Enter');
  await expect(page.getByText(`Destination /${chinese?'zh-cn':'en'}/company/nvidia`,{exact:true})).toBeVisible();
});
test('typing starts search, control keys do not, and Escape restores the entry point',async({page})=>{
 await open(page);await page.locator('body').click({position:{x:1,y:1}});
 for(const key of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape','Tab','F2','Control+a','Alt+a','Meta+a']){
  await page.keyboard.press(key);await expect(page.getByRole('dialog',{name:'Search company',exact:true})).toHaveCount(0);
 }
 await page.keyboard.type('nvidia');await expect(input(page)).toHaveValue('nvidia');
 await expect(page.getByRole('option')).toHaveCount(2);await input(page).press('ArrowDown');
 await expect(page.getByRole('option').filter({hasText:'NVDL'})).toHaveAttribute('aria-selected','true');
 await input(page).press('Escape');await expect(input(page)).toHaveCount(0);
 await launch(page);await input(page).fill('openai');await page.getByRole('option',{name:/OpenAI/}).click();
 await expect(page.getByText('Destination /en/company/openai',{exact:true})).toBeVisible();
});
test('missing company results stay in search rather than fabricating a destination',async({page})=>{
 await open(page);await launch(page);await input(page).fill('no such co');
 await expect(page.getByRole('status')).toHaveText('No matching companies.');await input(page).press('Enter');
 await expect(page).toHaveURL(`${origin}/`);
});

test('inactive page search never captures typing from an active fullscreen surface',async({page})=>{
 await open(page);
 await page.evaluate(()=>{document.getElementById('root')!.inert=true;});
 await page.keyboard.press('n');
 await expect(page.getByRole('dialog',{name:'Search company',exact:true})).toHaveCount(0);
 await page.evaluate(()=>{document.getElementById('root')!.inert=false;});
 await page.keyboard.press('n');await expect(input(page)).toHaveValue('n');
});

test("the AI map's most-connected companies link to their company pages", async ({ page }, testInfo) => {
  await open(page);
  const list = page.getByTestId("most-connected-companies");
  await expect(page.getByRole("heading", { name: "Most-connected companies on the AI map" })).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(10);
  const first = list.getByRole("link").first();
  await expect(first).toContainText("NVIDIA");
  await expect(first).toContainText("NVDA");
  await expect(first).toContainText("AI compute");
  await expect(first).toHaveAttribute("href", "/en/company/nvidia");
  await expect(first).toContainText(/\d+connections/);
  // Counts never increase down the list.
  const counts = await list.locator("li a > span:last-child > span").allTextContents();
  expect(counts.map(Number)).toEqual([...counts.map(Number)].sort((a, b) => b - a));
  await page.screenshot({ path: testInfo.outputPath("companies.png"), fullPage: true });
});

test('Enter before suggestions arrive opens the best match once the pending request completes',async({page})=>{
 await open(page,'',600);await launch(page);await input(page).fill('nvidia');await input(page).press('Enter');
 await expect(page.getByText('Destination /en/company/nvidia',{exact:true})).toBeVisible();
});
test('editing or dismissing a pending Enter never opens a stale company',async({page})=>{
 const searches=await open(page,'',600);await launch(page);await input(page).fill('nvidia');
 await expect.poll(()=>searches.length).toBe(1);await input(page).press('Enter');await input(page).fill('openai');
 await expect(page.getByRole('option',{name:/OpenAI/})).toBeVisible();await expect(page).toHaveURL(`${origin}/`);
 await input(page).fill('nvidia');await input(page).press('Enter');await input(page).press('Escape');
 await page.waitForTimeout(800);await expect(page).toHaveURL(`${origin}/`);await expect(input(page)).toHaveCount(0);
});
