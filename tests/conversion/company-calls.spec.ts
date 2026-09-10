import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import type { CompanyCall } from "../../src/lib/predictions/company-calls";

const origin = "http://calls.test";
let html = "";
const bullish: CompanyCall = { id: "bull", watchlistId: "main", watchlistName: "My Watchlist", isDefault: true, visibility: "Public", direction: "UP", status: "OPEN", createdAt: "2026-09-07T18:00:00Z", entryDate: "2026-09-08", entryPrice: 150.25, cancelUntil: null };
const bearish: CompanyCall = { ...bullish, id: "bear", watchlistId: "hedges", watchlistName: "Hedges", isDefault: false, visibility: "Private", direction: "DOWN" };

test.beforeAll(async () => {
  const bundled = await build({ stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client"; import {CompanyCallActions} from "./src/components/company-call-actions"; createRoot(document.getElementById("root")).render(<CompanyCallActions ticker="AMD"/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outfile: "fixture.js", platform: "browser", define: { "process.env": "{}" }, alias: { "next/link": path.resolve("tests/industry/link.tsx"), "@/components/providers/auth-provider": path.resolve("tests/conversion/fixtures/mocks.tsx") } });
  const css = await postcss([tailwind()]).process('@import "tailwindcss";', { from: path.resolve("calls-test.css") });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${bundled.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? ""}${css.css}body{background:#07111d;color:white;padding:16px;font-family:Arial}</style></head><body><div id="root"></div><script>${bundled.outputFiles.find(file => file.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  await page.route("**/*", route => route.request().isNavigationRequest() && new URL(route.request().url()).origin === origin ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
});

test("multiple watchlists show their own call; close sends only the selected call and reason", async ({ page }, testInfo) => {
  await page.route(`${origin}/api/ticker/AMD/my-calls`, route => route.fulfill({ json: { items: [bullish, bearish] } }));
  const mutations: string[] = [];
  await page.route(`${origin}/api/predictions/*/close`, route => {
    mutations.push(route.request().url());
    expect(route.request().postDataJSON()).toEqual({ reason: "Thesis changed" });
    expect(route.request().headers().authorization).toBe("Bearer isolated-test-token");
    return route.fulfill({ json: { status: "CLOSING" } });
  });
  await page.goto(origin);
  await expect(page.getByRole("link", { name: "Bullish", exact: true })).toHaveCount(0);
  await expect(page.getByText("Entry $150.25 · recorded 2026-09-08")).toHaveCount(2);
  await expect(page.getByText("Default watchlist · Public")).toBeVisible();
  await page.getByRole("button", { name: "Close Bearish", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm close Bearish" })).toBeDisabled();
  await page.getByLabel("Why are you closing this call?").fill("Thesis changed");
  await page.getByRole("button", { name: "Confirm close Bearish" }).click();
  await expect(page.getByRole("article", { name: "Hedges: Bearish" })).toContainText("Closing — awaiting end-of-day settlement.");
  await expect(page.getByRole("button", { name: "Close Bullish", exact: true })).toBeVisible();
  expect(mutations).toEqual([`${origin}/api/predictions/bear/close`]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("company-calls.png"), fullPage: true });
});

test("pending call can be canceled and direction buttons return", async ({ page }) => {
  await page.route(`${origin}/api/ticker/AMD/my-calls`, route => route.fulfill({ json: { items: [{ ...bullish, status: "CREATED", entryPrice: null, entryDate: null, cancelUntil: new Date(Date.now() + 60_000).toISOString() }] } }));
  await page.route(`${origin}/api/predictions/bull/cancel`, route => route.fulfill({ json: { status: "CANCELED" } }));
  await page.goto(origin);
  await expect(page.getByText("Entry price pending the next end-of-day update.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel Bullish" }).click();
  await expect(page.getByRole("link", { name: "Bullish", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bearish", exact: true })).toBeVisible();
});

test("expired pending calls and closing calls do not offer invalid close actions", async ({ page }) => {
  await page.route(`${origin}/api/ticker/AMD/my-calls`, route => route.fulfill({ json: { items: [{ ...bullish, status: "CREATED", entryPrice: null, entryDate: null, cancelUntil: "2020-01-01T00:00:00Z" }, { ...bearish, status: "CLOSING" }] } }));
  await page.goto(origin);
  await expect(page.getByText("The five-minute cancellation window has ended.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /Close|Cancel/ })).toHaveCount(0);
});

test("loading failure does not pretend there are no calls; retry recovers", async ({ page }) => {
  await page.route(`${origin}/api/ticker/AMD/my-calls`, route => route.fulfill({ status: 503, json: {} }));
  await page.goto(origin);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("link", { name: "Bullish", exact: true })).toHaveCount(0);
  await page.route(`${origin}/api/ticker/AMD/my-calls`, route => route.fulfill({ json: { items: [] } }));
  await page.getByRole("button", { name: "Refresh your calls" }).click();
  await expect(page.getByRole("link", { name: "Bullish", exact: true })).toBeVisible();
});

test("failed close preserves the open call and reason, then allows retry", async ({ page }) => {
  await page.route(`${origin}/api/ticker/AMD/my-calls`, route => route.fulfill({ json: { items: [bullish] } }));
  await page.route(`${origin}/api/predictions/bull/close`, route => route.fulfill({ status: 400, json: { error: "Must remain open through one completed market day." } }));
  await page.goto(origin);
  await page.getByRole("button", { name: "Close Bullish", exact: true }).click();
  await page.getByLabel("Why are you closing this call?").fill("Thesis changed");
  await page.getByRole("button", { name: "Confirm close Bullish" }).click();
  await expect(page.getByRole("alert")).toContainText("Must remain open");
  await expect(page.getByLabel("Why are you closing this call?")).toHaveValue("Thesis changed");
  await expect(page.getByText("Closing — awaiting end-of-day settlement.")).toHaveCount(0);
  await page.route(`${origin}/api/predictions/bull/close`, route => route.fulfill({ json: { status: "CLOSING" } }));
  await page.getByRole("button", { name: "Confirm close Bullish" }).click();
  await expect(page.getByText("Closing — awaiting end-of-day settlement.")).toBeVisible();
});

test("signing out removes private calls immediately", async ({ page }) => {
  await page.route(`${origin}/api/ticker/AMD/my-calls`, route => route.fulfill({ json: { items: [bearish] } }));
  await page.goto(origin);
  await expect(page.getByRole("article", { name: "Hedges: Bearish" })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-auth-user", { detail: null })));
  await expect(page.getByRole("article", { name: "Hedges: Bearish" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Bearish", exact: true })).toHaveAttribute("href", /mode=register/);
});
