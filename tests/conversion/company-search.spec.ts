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
const nvidia = { supportState: "SUPPORTED", id: "US:NVDA", kind: "ticker", symbol: "NVDA", name: "NVIDIA Corporation", exchange: "NASDAQ", micCode: "XNAS", type: "Common Stock", market: "US" };
const leveraged = { supportState: "SUPPORTED", id: "US:NVDL", kind: "ticker", symbol: "NVDL", name: "GraniteShares 2x Long NVDA Daily ETF", exchange: "NASDAQ", micCode: "XNAS", type: "ETF", market: "US" };
const openai = { supportState: "SUPPORTED", id: "ORG:OPENAI", kind: "ticker", symbol: "ORG:OPENAI", name: "OpenAI", exchange: null, micCode: null, type: null, market: "GLOBAL" };
let html: string;

test.beforeAll(async () => {
  const mock = path.resolve("tests/conversion/fixtures/mocks.tsx");
  const bundled = await build({
    stdin: { contents: `
      import React, { useSyncExternalStore } from "react";
      import { createRoot } from "react-dom/client";
      import { CompanySearchCard } from "./src/components/company-search-card";
      import { CompanySearch } from "./src/components/company-search";
      import { MostConnectedCompanies } from "./src/components/most-connected-companies";
      import { LocaleProvider } from "./src/components/providers/locale-provider";
      const subscribe = (notify) => { window.addEventListener("route-change", notify); return () => window.removeEventListener("route-change", notify); };
      function App() {
        const path = useSyncExternalStore(subscribe, () => location.pathname);
        const locale = new URLSearchParams(location.search).get("lang") === "zh-CN" ? "zh-CN" : "en";
        return <LocaleProvider locale={locale}>{path === "/" ? <><CompanySearch owner="global"/><CompanySearchCard /><MostConnectedCompanies /></> : <p>Destination {path}</p>}</LocaleProvider>;
      }
      createRoot(document.getElementById("root")).render(<App />);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: "fixture.js", platform: "browser", define: { "process.env": "{}" },
    alias: { "next/navigation": mock, "next/link": mock, "@/components/providers/auth-provider": mock },
  });
  // esbuild does not compile Tailwind; provide the layout utilities used by the fixture.
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
      expect(url.searchParams.get('scope')).toBe('directory');
      if (!url.searchParams.get('q')) return route.fulfill({ json: { items: [], total: 123 } });
      searches.push(url.search);
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      const q = url.searchParams.get("q")?.toUpperCase() ?? "";
      const items = q.startsWith("OPEN") ? [openai] : q.startsWith("NV") || q === '英伟达' || q === 'YINGWEIDA' || q === 'YWD' ? [nvidia, leveraged] : [];
      return route.fulfill({ json: { items: items.slice(0, Number(url.searchParams.get("limit") ?? 8)), total: 123 } });
    }
    if (url.pathname === "/api/knowledge-graph") return route.fulfill({ json: graph });
    if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${origin}/${query}`);
  return searches;
}
const input = (page: Page) => page.getByRole('combobox', {name:/^(Search company|搜索公司)$/});
async function launch(page:Page) { await input(page).click(); await expect(page.getByRole('dialog',{name:/^(Search company|搜索公司)$/})).toHaveCount(0); }
for (const chinese of [false,true]) test(`embedded company search selects and navigates in ${chinese?'Chinese':'English'}`,async({page})=>{
  await open(page,chinese?'?lang=zh-CN':'');await launch(page);
  await expect(input(page)).toBeFocused();await input(page).fill('nvidia');
  await expect(page.getByRole('option')).toHaveCount(2);
  await input(page).press('Enter');
  await expect(page.getByText(`Destination /${chinese?'zh-cn':'en'}/company/nvidia`,{exact:true})).toBeVisible();
});
test('typing focuses embedded search, control keys do not start it, and Escape dismisses suggestions',async({page})=>{
 await open(page);await page.locator('body').click({position:{x:1,y:1}});
 for(const key of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape','Tab','F2','Control+a','Alt+a','Meta+a']){
  await page.keyboard.press(key);await expect(page.getByRole('dialog',{name:'Search company',exact:true})).toHaveCount(0);
 }
 await page.keyboard.type('nvidia');await expect(input(page)).toHaveValue('nvidia');
 await expect(page.getByRole('option')).toHaveCount(2);await input(page).press('ArrowDown');
 await expect(page.getByRole('option').filter({hasText:'NVDL'})).toHaveAttribute('aria-selected','true');
 await input(page).press('Escape');await expect(input(page)).toBeVisible();await expect(page.getByRole('option')).toHaveCount(0);
 await launch(page);await input(page).fill('openai');await page.getByRole('option',{name:/OpenAI/}).click();
 await expect(page.getByText('Destination /en/company/openai',{exact:true})).toBeVisible();
});
test('missing company results stay in search rather than fabricating a destination',async({page})=>{
 await open(page);await launch(page);await input(page).fill('no such co');
 await expect(page.getByRole('status')).toHaveText('No companies match your search.');await input(page).press('Enter');
 await expect(page).toHaveURL(`${origin}/`);
});

test('inactive page search never captures typing from an active fullscreen surface',async({page})=>{
 await open(page);
 await page.evaluate(()=>{document.getElementById('root')!.inert=true;});
 await page.keyboard.press('n');
 await expect(input(page)).toHaveValue('');
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
 await page.waitForTimeout(800);await expect(page).toHaveURL(`${origin}/`);await expect(input(page)).toBeVisible();await expect(page.getByRole('option')).toHaveCount(0);
});

test('page search is directly visible, header focuses it and suggestions stay below the field',async({page},info)=>{
 let countRequests = 0;
 page.on('request', request => { const url = new URL(request.url()); if (url.pathname === '/api/tickers/search' && !url.searchParams.get('q')) countRequests++; });
 await open(page);
 await expect(input(page)).toBeVisible();await expect(input(page)).not.toBeFocused();
 await expect(page.getByText('All companies · Request full support', {exact:true})).toBeVisible();
 expect(countRequests).toBe(0);
 await page.getByRole('button',{name:'Search company',exact:true}).click();
 await expect(input(page)).toBeFocused();await expect(page.getByRole('dialog')).toHaveCount(0);
 await input(page).fill('nvidia');await expect(page.getByRole('option')).toHaveCount(2);
 const field=(await input(page).boundingBox())!,suggestion=(await page.getByRole('option').first().boundingBox())!;
 expect(suggestion.y).toBeGreaterThanOrEqual(field.y+field.height);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:`output/embedded-company-search-${info.project.name}.png`});
 await page.mouse.click(1,1);
 await expect(page.getByRole('option')).toHaveCount(0);await expect(input(page)).toHaveValue('nvidia');
 await input(page).click();await expect(page.getByRole('option')).toHaveCount(2);
 await page.getByRole('button',{name:'Search company',exact:true}).focus();
 await expect(page.getByRole('option')).toHaveCount(0);
});

test('embedded search accepts Chinese IME and pinyin without selecting during composition',async({page})=>{
 await open(page,'?lang=zh-CN');await input(page).click();
 await input(page).dispatchEvent('compositionstart');await input(page).fill('英伟达');
 await expect(page.getByRole('option')).toHaveCount(2);
 await input(page).dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});await expect(page).toHaveURL(`${origin}/?lang=zh-CN`);
 await input(page).dispatchEvent('compositionend');
 await input(page).fill('yingweida');await expect(page.getByRole('option')).toHaveCount(2);
 await input(page).fill('ywd');await expect(page.getByRole('option')).toHaveCount(2);
 await input(page).press('Enter');await expect(page.getByText('Destination /zh-cn/company/nvidia',{exact:true})).toBeVisible();
});

test('typing from below the embedded field scrolls it into view',async({page})=>{
 await open(page);await page.addStyleTag({content:'#root{padding-top:1200px}'});
 await page.evaluate(()=>window.scrollTo(0,1400));
 await page.keyboard.type('nvidia');await expect(input(page)).toHaveValue('nvidia');await expect(input(page)).toBeFocused();
 const field=(await input(page).boundingBox())!;
 expect(field.y).toBeGreaterThanOrEqual(0);expect(field.y+field.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

for(const state of ['QUEUED','PROCESSING','BLOCKED','CIK_UNMATCHED'] as const)test(`directory search displays ${state} without another request action`,async({page})=>{
 await open(page);await page.route('**/api/tickers/search?*',route=>route.fulfill({json:{items:[{...nvidia,supportState:state}]}}));
 await input(page).fill('nvda');
 const label={QUEUED:'Onboarding Queued',PROCESSING:'Onboarding…',BLOCKED:'Onboarding Needs Attention',CIK_UNMATCHED:'CIK not matched'}[state];
 await expect(page.getByRole('option')).toContainText(label);
 await expect(page.getByRole('button',{name:'Request Full Support',exact:true})).toHaveCount(0);
});

test('registered user queues once with a bearer token and sees the confirmed status',async({page},info)=>{
 await page.addInitScript(()=>{window.authScenario={signedIn:true};});await open(page);
 await page.route('**/api/tickers/search?*',route=>route.fulfill({json:{items:[{...nvidia,supportState:'ELIGIBLE'}]}}));
 let writes=0;await page.route('**/api/company-onboarding/requests',async route=>{
  writes++;expect(route.request().headers().authorization).toBe('Bearer isolated-test-token');expect(route.request().postDataJSON()).toEqual({companyId:'US:NVDA'});
  await new Promise(resolve=>setTimeout(resolve,250));await route.fulfill({json:{ok:true,status:'QUEUED'}});
 });
 await input(page).fill('nvda');await page.getByRole('button',{name:'Request Full Support',exact:true}).click();
 await expect(page.getByRole('button',{name:'Requesting…',exact:true})).toBeDisabled();
 await expect(page.getByRole('option')).toContainText('Onboarding Queued');expect(writes).toBe(1);await expect(page).toHaveURL(`${origin}/`);
 await page.screenshot({path:info.outputPath('onboarding-queued.png')});
});

test('signed-out search offers sign-in and never enqueues on Enter',async({page})=>{
 await open(page);await page.route('**/api/tickers/search?*',route=>route.fulfill({json:{items:[{...nvidia,supportState:'ELIGIBLE'}]}}));
 let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++;});
 await input(page).fill('nvda');await expect(page.getByRole('button',{name:'Sign in to request full support',exact:true})).toBeVisible();
 await input(page).press('Enter');await expect(page.getByText('Destination /en/company/nvidia',{exact:true})).toBeVisible();expect(writes).toBe(0);
});

test('failed onboarding request stays eligible and can be retried',async({page})=>{
 await page.addInitScript(()=>{window.authScenario={signedIn:true};});await open(page);
 await page.route('**/api/tickers/search?*',route=>route.fulfill({json:{items:[{...nvidia,supportState:'ELIGIBLE'}]}}));
 await page.route('**/api/company-onboarding/requests',route=>route.fulfill({status:503,json:{error:'unavailable'}}));
 await input(page).fill('nvda');await page.getByRole('button',{name:'Request Full Support',exact:true}).click();
 await expect(page.getByRole('alert')).toHaveText('Unable to request full support. Try again.');
 await expect(page.getByRole('button',{name:'Request Full Support',exact:true})).toBeEnabled();await expect(page.getByText('Onboarding Queued',{exact:true})).toHaveCount(0);
});
