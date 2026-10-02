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
  let budgetCalls = 0;
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/admin/me") return route.fulfill({ status: 403, json: { isAdmin: false } });
    if (url.pathname === "/api/admin/jobs") historyCalls++;
    if (url.pathname === "/api/admin/company-graph/budget") budgetCalls++;
    return route.abort();
  });
  await page.goto(origin);
  await expect(page.getByRole("alert")).toHaveText("This page is available to administrators only.");
  expect(historyCalls).toBe(0);
  expect(budgetCalls).toBe(0);
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

const initialGraphBudget = { limitUsd: 5, spentUsd: 1.25, reservedUsd: 0.5, remainingUsd: 3.25, day: "2026-10-01", timezone: "America/New_York", blocked: false, newRequestsPaused: false, pricingValidUntil: "2026-10-31T00:00:00Z" };

test("new paid request pause stays visible with available budget and failed history after the limit is raised", async ({ page }, testInfo) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  let current = { ...initialGraphBudget, newRequestsPaused: true };
  const writes: { path: string; body: unknown }[] = [];
  await page.route("**/*", route => {
    const req = route.request(), url = new URL(req.url());
    if (req.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (req.method() !== "GET") writes.push({ path: url.pathname, body: req.postDataJSON() });
    if (url.pathname === "/api/admin/me") return route.fulfill({ json: { isAdmin: true } });
    if (url.pathname === "/api/admin/jobs") return route.fulfill({ status: 502, json: { error: "Cloud Logging history is unavailable." } });
    if (url.pathname === "/api/admin/company-graph/budget") {
      expect(req.headers().authorization).toBe("Bearer isolated-test-token");
      if (req.method() === "PATCH") {
        const { limitUsd } = req.postDataJSON();
        current = { ...current, limitUsd, remainingUsd: limitUsd - current.spentUsd - current.reservedUsd };
      }
      return route.fulfill({ json: current });
    }
    return route.abort();
  });
  await page.goto(origin);
  const panel = page.getByRole("region", { name: "Company graph OpenAI budget" });
  const pause = panel.getByRole("status").filter({ hasText: "New paid requests are temporarily paused" });
  const input = panel.getByLabel("Daily limit (USD)", { exact: true });
  await expect(page.getByRole("alert").filter({ hasText: "Cloud Logging history is unavailable." })).toBeVisible();
  await expect(pause).toContainText("raising it will not resume new paid requests");
  await expect(input).toHaveValue("5.00");
  await expect(input).toBeEnabled();
  for (const value of ["US$5.00", "US$1.25", "US$0.50", "US$3.25"]) {
    await expect(panel.getByText(value, { exact: true })).toBeVisible();
  }
  await expect(panel.getByText("New OpenAI calls are blocked by the budget or pricing validity checks.", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("Paused. New OpenAI calls are blocked.", { exact: true })).toHaveCount(0);
  await input.fill("10");
  await panel.getByRole("button", { name: "Save daily limit", exact: true }).click();
  await expect(panel.getByText("Daily limit saved.", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("10.00");
  for (const value of ["US$10.00", "US$1.25", "US$0.50", "US$8.25"]) {
    await expect(panel.getByText(value, { exact: true })).toBeVisible();
  }
  await expect(pause).toBeVisible();
  await panel.getByRole("button", { name: "Refresh budget", exact: true }).click();
  await expect(pause).toBeVisible();
  await expect(input).toHaveValue("10.00");
  expect(writes).toEqual([{ path: "/api/admin/company-graph/budget", body: { limitUsd: 10 } }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("admin-graph-paid-requests-paused.png"), fullPage: true });
});

test("graph budget remains editable when job history fails and zero pauses new calls", async ({ page }, testInfo) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  const writes: number[] = [];
  let current = { ...initialGraphBudget };
  let finish: (() => void) | undefined;
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/admin/me") return route.fulfill({ json: { isAdmin: true } });
    if (url.pathname === "/api/admin/jobs") return route.fulfill({ status: 502, json: { error: "Cloud Logging history is unavailable." } });
    if (url.pathname === "/api/admin/company-graph/budget") {
      expect(req.headers().authorization).toBe("Bearer isolated-test-token");
      if (req.method() === "PATCH") {
        expect(req.postDataJSON()).toEqual({ limitUsd: 0 });
        writes.push(req.postDataJSON().limitUsd);
        await new Promise<void>(resolve => { finish = resolve; });
        current = { ...current, limitUsd: 0, remainingUsd: 0, blocked: true };
      }
      return route.fulfill({ json: current });
    }
    return route.abort();
  });
  await page.goto(origin);
  const panel = page.getByRole("region", { name: "Company graph OpenAI budget" });
  await expect(page.getByRole("alert").filter({ hasText: "Cloud Logging history is unavailable." })).toBeVisible();
  await expect(panel.getByText("US$5.00", { exact: true })).toBeVisible();
  await expect(panel.getByText("US$1.25", { exact: true })).toBeVisible();
  await expect(panel.getByText("US$0.50", { exact: true })).toBeVisible();
  await expect(panel.getByText("US$3.25", { exact: true })).toBeVisible();
  await expect(panel.getByText(/New paid requests are temporarily paused/)).toHaveCount(0);
  await expect(panel.getByText("Budget day: 2026-10-01 · America/New_York", { exact: true })).toBeVisible();
  await expect(panel.getByText(/not your provider invoice or ChatGPT allowance/)).toBeVisible();
  await expect(panel.getByText(/does not reverse charges/)).toBeVisible();
  await panel.getByLabel("Daily limit (USD)", { exact: true }).fill("0");
  await panel.getByRole("button", { name: "Save daily limit", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Saving budget…", exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Refresh budget", exact: true })).toBeDisabled();
  await expect.poll(() => writes.length).toBe(1);
  finish!();
  await expect(panel.getByText("Daily limit saved.", { exact: true })).toBeVisible();
  await expect(panel.getByText("Paused. New OpenAI calls are blocked.", { exact: true })).toBeVisible();
  await expect(panel.getByLabel("Daily limit (USD)", { exact: true })).toHaveValue("0.00");
  await expect(panel.getByText("US$1.25", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("admin-graph-budget-paused.png"), fullPage: true });
});

test("graph budget saves cents and displays authoritative amounts when lowered below committed usage", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  const writes: number[] = [];
  await page.route("**/*", route => {
    const req = route.request(), url = new URL(req.url());
    if (req.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/admin/me") return route.fulfill({ json: { isAdmin: true } });
    if (url.pathname === "/api/admin/jobs") return route.fulfill({ json: { records: [], nextPageToken: null } });
    if (url.pathname === "/api/admin/company-graph/budget") {
      if (req.method() === "PATCH") {
        const { limitUsd } = req.postDataJSON();
        writes.push(limitUsd);
        return route.fulfill({ json: { ...initialGraphBudget, limitUsd, remainingUsd: 0, blocked: true } });
      }
      return route.fulfill({ json: initialGraphBudget });
    }
    return route.abort();
  });
  await page.goto(origin);
  const panel = page.getByRole("region", { name: "Company graph OpenAI budget" });
  await panel.getByLabel("Daily limit (USD)", { exact: true }).fill("0.29");
  await panel.getByRole("button", { name: "Save daily limit", exact: true }).click();
  await expect(panel.getByText("Daily limit saved.", { exact: true })).toBeVisible();
  await expect(panel.getByText("US$0.29", { exact: true })).toBeVisible();
  await expect(panel.getByText("US$1.25", { exact: true })).toBeVisible();
  await expect(panel.getByText("US$0.50", { exact: true })).toBeVisible();
  await expect(panel.getByText("US$0.00", { exact: true })).toBeVisible();
  await expect(panel.getByText("New OpenAI calls are blocked by the budget or pricing validity checks.", { exact: true })).toBeVisible();
  expect(writes).toEqual([0.29]);
});

test("graph budget read failure keeps history usable and supports independent retry", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  let reads = 0;
  let historyReads = 0;
  await page.route("**/*", route => {
    const req = route.request(), url = new URL(req.url());
    if (req.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/admin/me") return route.fulfill({ json: { isAdmin: true } });
    if (url.pathname === "/api/admin/jobs") {
      historyReads++;
      return route.fulfill({ json: { records: [{ id: "ok", status: "Succeeded", startedAt: "2026-10-01T00:00:00Z", summary: { processed: 1 } }], nextPageToken: null } });
    }
    if (url.pathname === "/api/admin/company-graph/budget") {
      reads++;
      return reads === 1 ? route.fulfill({ status: 503, json: { error: "Unable to load the company graph budget." } }) : route.fulfill({ json: initialGraphBudget });
    }
    return route.abort();
  });
  await page.goto(origin);
  const panel = page.getByRole("region", { name: "Company graph OpenAI budget" });
  await expect(panel.getByRole("alert")).toHaveText("Unable to load the company graph budget.");
  await expect(panel.getByLabel("Daily limit (USD)", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Succeeded", { exact: true })).toBeVisible();
  const initialHistoryReads = historyReads;
  await panel.getByRole("button", { name: "Refresh budget", exact: true }).click();
  await expect(panel.getByLabel("Daily limit (USD)", { exact: true })).toHaveValue("5.00");
  await expect(panel.getByRole("alert")).toHaveCount(0);
  expect(reads).toBe(2);
  expect(historyReads).toBe(initialHistoryReads);
});

test("graph budget failed update keeps the last confirmed limit and invalid inputs never write", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  const writes: number[] = [];
  await page.route("**/*", route => {
    const req = route.request(), url = new URL(req.url());
    if (req.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/admin/me") return route.fulfill({ json: { isAdmin: true } });
    if (url.pathname === "/api/admin/jobs") return route.fulfill({ json: { records: [], nextPageToken: null } });
    if (url.pathname === "/api/admin/company-graph/budget") {
      if (req.method() === "PATCH") {
        writes.push(req.postDataJSON().limitUsd);
        return route.fulfill({ status: 503, json: { error: "Unable to save. Refresh the budget to check the current limit." } });
      }
      return route.fulfill({ json: initialGraphBudget });
    }
    return route.abort();
  });
  await page.goto(origin);
  const panel = page.getByRole("region", { name: "Company graph OpenAI budget" });
  const input = panel.getByLabel("Daily limit (USD)", { exact: true });
  for (const invalid of ["", "-1", "0.001", "1000000.01"]) {
    await input.fill(invalid);
    await panel.getByRole("button", { name: "Save daily limit", exact: true }).click();
    expect(await input.evaluate((element: HTMLInputElement) => element.checkValidity())).toBe(false);
  }
  expect(writes).toEqual([]);
  await input.fill("6.25");
  await panel.getByRole("button", { name: "Save daily limit", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveText("Unable to save. Refresh the budget to check the current limit.");
  await expect(panel.getByText("Daily limit saved.", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("US$5.00", { exact: true })).toBeVisible();
  expect(writes).toEqual([6.25]);
  await panel.getByRole("button", { name: "Refresh budget", exact: true }).click();
  await expect(input).toHaveValue("5.00");
  await expect(panel.getByRole("alert")).toHaveCount(0);
});
