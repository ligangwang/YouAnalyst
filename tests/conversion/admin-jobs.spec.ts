import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const origin = "http://admin-jobs.test";
let html: string;

test("directory and ticker controls share task history and preview does not request writes", async ({page}) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  const requests: {path:string;body:Record<string,unknown>|null}[]=[];
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.isNavigationRequest())return route.fulfill({contentType:'text/html',body:html});
    if(url.pathname==='/api/admin/me')return route.fulfill({json:{isAdmin:true}});
    if(url.pathname==='/api/admin/jobs')return route.fulfill({json:{records:[],nextPageToken:null}});
    if(request.method()==='POST') {
      const body=request.postData()?request.postDataJSON():null;requests.push({path:url.pathname,body});
      return route.fulfill({status:body?.dryRun?200:202,json:{ok:true,operation:'op',dryRun:body?.dryRun,...(body?.dryRun?{written:0}:{queued:true,runId:'queued-ticker-request'})}});
    }
    return route.abort();
  });
  await page.goto(origin);
  await page.getByRole('combobox',{name:'Job',exact:true}).selectOption('directory');
  await page.getByRole('button',{name:'Run directory sync now'}).click();
  await expect.poll(()=>requests.length).toBe(1);
  expect(requests[0].path).toBe('/api/admin/jobs/directory');
  await page.getByRole('combobox',{name:'Job',exact:true}).selectOption('tickers');
  await expect(page.getByRole('button',{name:'Scheduler deliveries'})).toHaveCount(0);
  await page.getByLabel('Limit (blank for all)',{exact:true}).fill('12');
  await page.getByRole('button',{name:'Preview ticker sync'}).click();
  await expect(page.getByText('Preview complete. No catalog changes written.',{exact:true})).toBeVisible();
  expect(requests[1].body).toMatchObject({dryRun:true,limit:12,country:'United States',currency:'USD'});
  await page.getByRole('button',{name:'Sync ticker catalog now'}).click();
  await expect(page.getByText('Ticker sync queued. Processing continues in the background. Refresh run history for results.',{exact:true})).toBeVisible();
  await expect(page.getByText('Ticker sync completed.',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('combobox',{name:'Job',exact:true})).toBeEnabled();
  expect(requests[2].body?.dryRun).toBe(false);
});
test.beforeAll(async () => {
  const bundled = await build({
    stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client";
      import {AdminJobsPage} from "./src/components/admin-jobs-page";
      import {AdminAccessGuard} from "./src/components/admin-access-guard";
      createRoot(document.getElementById("root")).render(<AdminAccessGuard><AdminJobsPage /></AdminAccessGuard>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: "fixture.js", platform: "browser", define: { "process.env": "{}" },
    alias: { "next/link": path.resolve("tests/industry/link.tsx"), "@/components/providers/auth-provider": path.resolve("tests/conversion/fixtures/mocks.tsx") },
  });
  const css = await postcss([tailwind()]).process('@import "tailwindcss";', { from: path.resolve("admin-job-test.css") });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}body{background:#07111d;color:#f8fafc;font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script>${bundled.outputFiles.find(f => f.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});

test("admin can page through runs and errors, inspect details and change job without keeping old cursors", async ({ page }, testInfo) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  const queries: URLSearchParams[] = [];
  await page.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/admin/me") return route.fulfill({ json: { isAdmin: true } });
    if (url.pathname === "/api/admin/jobs") {
      queries.push(url.searchParams);
      const next = url.searchParams.has("pageToken");
      return route.fulfill({ json: { records: [{ id: next ? "run-older" : "run-latest", execution: next ? "run-older" : "run-latest", startedAt: "2026-09-21T01:00:00Z", endedAt: "2026-09-21T01:00:30Z", durationMs: 30000, status: next ? "Failed" : "Succeeded", summary: { processed: 11, failed: next ? 1 : 0, error: next ? { message: "SEC request failed (429)" } : undefined } }], nextPageToken: next ? null : "next-page" } });
    }
    return route.abort();
  });
  await page.goto(origin);
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.getByText("Succeeded", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await page.getByText("Details", { exact: true }).click();
  await expect(page.locator("pre")).toContainText("SEC request failed (429)");
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByText("Succeeded", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View run logs" }).click();
  await expect.poll(() => queries.at(-1)?.get("execution")).toBe("run-latest");
  await page.getByRole("button", { name: "Errors only" }).click();
  await expect.poll(() => queries.at(-1)?.get("view")).toBe("errors");
  await page.getByRole("combobox", { name: "Job", exact: true }).selectOption("china");
  await expect.poll(() => queries.at(-1)?.get("job")).toBe("china");
  expect(queries.at(-1)?.has("pageToken")).toBe(false);
  expect(queries.at(-1)?.has("execution")).toBe(false);
  await page.getByRole("button", { name: "Scheduler deliveries" }).click();
  await expect(page.getByText("Delivered means the scheduler reached its target.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("admin-job-history.png"), fullPage: true });
});

test("non-admins never fetch job history", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  let historyCalls = 0;
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/admin/me") return route.fulfill({ status: 403, json: { isAdmin: false } });
    if (url.pathname === "/api/admin/jobs") historyCalls++;
    return route.abort();
  });
  await page.goto(origin);
  await expect(page.getByRole("alert")).toHaveText("This page is available to administrators only.");
  expect(historyCalls).toBe(0);
});

test("admin selects a date and queues EOD once, then sees acceptance and refreshed history", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  const posts: unknown[] = [];
  let finish: (() => void) | undefined;
  let historyReads = 0;
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/admin/me") return route.fulfill({ json: { isAdmin: true } });
    if (url.pathname === "/api/admin/jobs" && req.method() === "POST") {
      posts.push(req.postDataJSON());
      await new Promise<void>(resolve => { finish = resolve; });
      return route.fulfill({ status: 202, json: { ok: true, result: { queued: true, runId: "manual-run", market: "US", runDate: "2026-01-02" } } });
    }
    if (url.pathname === "/api/admin/jobs") {
      historyReads++;
      return route.fulfill({ json: { records: [], nextPageToken: null } });
    }
    return route.abort();
  });
  await page.goto(origin);
  await page.getByRole("combobox", { name: "Job", exact: true }).selectOption("us");
  await page.getByLabel("Trading date", { exact: true }).fill("2026-01-02");
  await page.getByRole("button", { name: "Rerun for this date", exact: true }).click();
  await expect(page.getByRole("button", { name: "Running…", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "Job", exact: true })).toBeDisabled();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ job: "us", runDate: "2026-01-02" });
  const readsBefore = historyReads;
  finish!();
  await expect(page.getByRole("status").filter({ hasText: "Request manual-run" })).toContainText("Queued. Follow progress in run history.");
  await expect.poll(() => historyReads).toBeGreaterThan(readsBefore);
  await expect(page.getByRole("button", { name: "Rerun for this date", exact: true })).toBeEnabled();
});

test("admin starts SEC job in the background without a trading date",async({page})=>{
 await page.addInitScript(()=>{window.authScenario={signedIn:true};});
 let starts=0;
 await page.route("**/*",route=>{
  const url=new URL(route.request().url());
  if(url.pathname==="/api/admin/me")return route.fulfill({json:{isAdmin:true}});
  if(url.pathname==="/api/admin/jobs/sec"){expect(route.request().method()).toBe("POST");starts++;return route.fulfill({status:202,json:{ok:true,operation:"operations/test"}});}
  if(url.pathname==="/api/admin/jobs")return route.fulfill({json:{records:[],nextPageToken:null}});
  return route.fulfill({contentType:"text/html",body:html});
 });
 await page.goto(origin);
 await expect(page.getByLabel("Trading date",{exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Run SEC fundamentals now",exact:true}).click();
 await expect(page.getByRole("status").filter({hasText:"Run requested."})).toContainText("continues in the background");
 expect(starts).toBe(1);
 await page.getByLabel("Job",{exact:true}).selectOption("us");
 await expect(page.getByRole("button",{name:"Run SEC fundamentals now",exact:true})).toHaveCount(0);
});

test("admin starts the A-share fundamentals job from its own Run now button",async({page})=>{
 await page.addInitScript(()=>{window.authScenario={signedIn:true};});
 const posts:string[]=[];const history:string[]=[];
 await page.route("**/*",route=>{
  const url=new URL(route.request().url());
  if(url.pathname==="/api/admin/me")return route.fulfill({json:{isAdmin:true}});
  if(url.pathname.startsWith("/api/admin/jobs/")){expect(route.request().method()).toBe("POST");posts.push(url.pathname);return route.fulfill({status:202,json:{ok:true,operation:"operations/cn"}});}
  if(url.pathname==="/api/admin/jobs"){history.push(url.searchParams.get("job")!);return route.fulfill({json:{records:[{id:"cn-run",startedAt:"2026-09-27T12:00:00Z",status:"Succeeded",summary:{annual:{updated:60,skipped:2,failed:0,deferred:0}}}],nextPageToken:null}});}
  return route.fulfill({contentType:"text/html",body:html});
 });
 await page.goto(origin);
 await page.getByLabel("Job",{exact:true}).selectOption("cnFundamentals");
 await expect(page.getByText(/Refresh annual revenue and net income attributable to the parent through AKShare/)).toBeVisible();
 await expect(page.getByText(/annual financials:.*"updated":60/)).toBeVisible();
 await expect(page.getByText("Weekdays, 9:30 AM New York (after China EOD)")).toBeVisible();
 await expect(page.getByRole("button",{name:"Run SEC fundamentals now",exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Run A-share fundamentals now",exact:true}).click();
 await expect(page.getByRole("status").filter({hasText:"Run requested."})).toBeVisible();
 expect(posts).toEqual(["/api/admin/jobs/cn-fundamentals"]);
 expect(history).toContain("cnFundamentals");
});

test("admin starts the private valuation job from its own Run now button",async({page})=>{
 await page.addInitScript(()=>{window.authScenario={signedIn:true};});
 const posts:string[]=[];const history:string[]=[];
 await page.route("**/*",route=>{
  const url=new URL(route.request().url());
  if(url.pathname==="/api/admin/me")return route.fulfill({json:{isAdmin:true}});
  if(url.pathname.startsWith("/api/admin/jobs/")){expect(route.request().method()).toBe("POST");posts.push(url.pathname);return route.fulfill({status:202,json:{ok:true,operation:"operations/private"}});}
  if(url.pathname==="/api/admin/jobs"){history.push(url.searchParams.get("job")!);return route.fulfill({json:{records:[],nextPageToken:null}});}
  return route.fulfill({contentType:"text/html",body:html});
 });
 await page.goto(origin);
 await page.getByLabel("Job",{exact:true}).selectOption("privateValuations");
 await expect(page.getByText("Monthly, day 1 at 9 AM New York")).toBeVisible();
 await expect(page.getByRole("button",{name:"Run SEC fundamentals now",exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"Run private valuation check now",exact:true}).click();
 await expect(page.getByRole("status").filter({hasText:"Run requested."})).toBeVisible();
 expect(posts).toEqual(["/api/admin/jobs/private-valuations"]);
 expect(history).toContain("privateValuations");
});

test("SEC filing discovery separates published events from downstream processing", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  const queries: string[] = [];
  await page.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/admin/me") return route.fulfill({ json: { isAdmin: true } });
    if (url.pathname === "/api/admin/jobs") {
      queries.push(url.searchParams.get("job") ?? "");
      return route.fulfill({ json: { records: [{ id: "collector-1", execution: "collector-1", startedAt: "2026-10-01T00:00:00Z", status: "Succeeded", summary: { discovered: 3, published: 3 } }], nextPageToken: null } });
    }
    return route.abort();
  });
  await page.goto(origin);
  await page.getByRole("combobox", { name: "Job", exact: true }).selectOption("secFilings");
  await expect.poll(() => queries.at(-1)).toBe("secFilings");
  await expect(page.getByText("Discovery queues filing events.", { exact: false })).toBeVisible();
  await expect(page.getByText("discovered: 3 · published: 3", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scheduler deliveries", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run SEC fundamentals now", exact: true })).toHaveCount(0);
});

test("company graph publisher and subscriber histories distinguish queue acceptance from processing", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  const queries: string[] = [];
  await page.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/admin/me") return route.fulfill({ json: { isAdmin: true } });
    if (url.pathname === "/api/admin/jobs") {
      queries.push(url.searchParams.get("job") ?? "");
      return route.fulfill({ json: { records: [], nextPageToken: null } });
    }
    return route.abort();
  });
  await page.goto(origin);
  await page.getByRole("combobox", { name: "Job", exact: true }).selectOption("companyGraph");
  await expect.poll(() => queries.at(-1)).toBe("companyGraph");
  await expect(page.getByText("A successful publisher run means requests were queued.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scheduler deliveries", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Job", exact: true }).selectOption("companyGraphBatches");
  await expect.poll(() => queries.at(-1)).toBe("companyGraphBatches");
  await expect(page.getByText("Request and filing deliveries retry independently.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Scheduler deliveries", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run SEC fundamentals now", exact: true })).toHaveCount(0);
});
