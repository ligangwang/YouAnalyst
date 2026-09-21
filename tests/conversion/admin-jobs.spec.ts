import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const origin = "http://admin-jobs.test";
let html: string;
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
  await expect(page.getByRole("heading", { name: "Scheduled jobs" })).toBeVisible();
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

test("admin selects a date and reruns EOD once, then sees the result and refreshed history", async ({ page }) => {
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
      return route.fulfill({ json: { ok: true, result: { runId: "manual-run", priceLoad: { cacheHits: 60, loaded: 7, failed: 0 } } } });
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
  await expect(page.getByRole("status").filter({ hasText: "Run manual-run" })).toContainText("Cached 60, fetched 7, failed 0");
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
