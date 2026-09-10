import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { filingEvent } from "../../src/lib/events/model";

const origin = "http://live-feed.test";
const initial = { items: Array.from({ length: 8 }, (_, index) => filingEvent({ type: index % 2 ? "SEC_13F" : "SEC_FORM4", accessionNumber: `0001234567-26-${String(index + 1).padStart(6, "0")}`, filingDate: "2026-09-09", sourceUrl: "https://www.sec.gov/Archives/edgar/data/1234567/filing.txt", entityName: ["Advanced Micro Devices", "Berkshire Hathaway", "NVIDIA", "Apple", "Microsoft", "Alphabet", "Tesla", "Amazon"][index], tickers: ["AMD", "NVDA"], amended: false }, `2026-09-10T12:00:0${8 - index}.000Z`)), nextCursor: "older-page" };
const incoming = filingEvent({ type: "SEC_FORM4", accessionNumber: "0001234567-26-000020", filingDate: "2026-09-10", sourceUrl: "https://www.sec.gov/Archives/edgar/data/1234567/new.txt", entityName: "New arrival", tickers: ["AMD"], amended: false }, "2026-09-10T13:00:00.000Z");
let html: string;
test.beforeAll(async () => {
  const result = await build({ stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client"; import {LiveEventFeed} from "./src/components/live-event-feed"; createRoot(document.getElementById("root")).render(<LiveEventFeed type={new URLSearchParams(location.search).get("type") || "all"} initialPage={window.emptyFeed ? {items:[],nextCursor:null} : ${JSON.stringify(initial)}}/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outfile: "feed.js", platform: "browser", alias: { "next/link": path.resolve("tests/industry/link.tsx") } });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#07111d;color:#f8fafc;font-family:Arial,sans-serif}a{color:inherit;text-decoration:none}button{cursor:pointer;font:inherit}h1,h2,p{margin:0}${result.outputFiles.find(file=>file.path.endsWith('.css'))!.text}</style></head><body><div id="root"></div><script>${result.outputFiles.find(file=>file.path.endsWith('.js'))!.text.replaceAll('</script','<\\/script')}</script></body></html>`;
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    class FeedSource extends EventTarget {
      onerror: (() => void) | null = null;
      update = (event: Event) => this.dispatchEvent(new MessageEvent("snapshot", { data: JSON.stringify((event as CustomEvent).detail) }));
      fail = () => this.onerror?.();
      constructor(url: string) { super(); Object.assign(window, {lastFeedUrl: url}); window.addEventListener("test-feed", this.update); window.addEventListener("test-feed-error", this.fail); }
      close() { window.removeEventListener("test-feed", this.update); window.removeEventListener("test-feed-error", this.fail); }
    }
    Object.defineProperty(window, "EventSource", { value: FeedSource });
  });
  await page.route("**/*", route => route.request().isNavigationRequest() ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
});

test("initial content appears, new events arrive without refresh, and source links are safe", async ({ page }, testInfo) => {
  await page.goto(origin);
  await expect(page.getByRole("article")).toHaveCount(8);
  await page.evaluate(next => window.dispatchEvent(new CustomEvent("test-feed", { detail: next })), { items: [incoming, ...initial.items], nextCursor: null });
  await expect(page.getByRole("status")).toHaveText("Live");
  await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", incoming.title);
  await expect(page.getByRole("link", { name: "Read filing" }).first()).toHaveAttribute("href", incoming.sourceUrl);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("live-feed.png"), fullPage: false });
});

test("arrivals wait while reading and applying them returns to the newest page", async ({ page }) => {
  await page.goto(origin);
  await page.getByRole("article").nth(4).scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  await page.evaluate(next => window.dispatchEvent(new CustomEvent("test-feed", { detail: next })), { items: [incoming, ...initial.items], nextCursor: null });
  await expect(page.getByRole("button", { name: "↑ New updates" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(8);
  expect(await page.evaluate(() => scrollY)).toBe(before);
  await page.getByRole("button", { name: "↑ New updates" }).click();
  await expect(page.getByRole("article").first()).toHaveAttribute("aria-label", incoming.title);
  await expect(page.getByRole("button", { name: "↑ New updates" })).toHaveCount(0);
});

test("pagination retries, deduplicates, and a reconnect does not clear loaded history", async ({ page }) => {
  await page.route("**/api/events?cursor=*", route => route.fulfill({ status: 503 }));
  await page.goto(origin);
  await page.evaluate(next => window.dispatchEvent(new CustomEvent("test-feed", { detail: next })), initial);
  await page.getByRole("button", { name: "Earlier events" }).click();
  await expect(page.getByRole("alert")).toContainText("Couldn’t load older events");
  await page.route("**/api/events?cursor=*", route => route.fulfill({ json: { items: [initial.items[0]], nextCursor: null } }));
  await page.getByRole("button", { name: "Earlier events" }).click();
  await expect(page.getByRole("button", { name: "Earlier events" })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("test-feed-error")));
  await expect(page.getByRole("status")).toHaveText("Reconnecting");
  await page.evaluate(next => window.dispatchEvent(new CustomEvent("test-feed", { detail: next })), initial);
  await expect(page.getByRole("status")).toHaveText("Live");
  await expect(page.getByRole("article")).toHaveCount(8);
  await expect(page.getByRole("button", { name: "Earlier events" })).toHaveCount(0);
});

test("empty feed is honest and fills itself when the first event arrives", async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { emptyFeed: true }));
  await page.goto(origin);
  await expect(page.getByRole("heading", { name: "You’re here early." })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.evaluate(next => window.dispatchEvent(new CustomEvent("test-feed", { detail: next })), { items: [incoming], nextCursor: null });
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "You’re here early." })).toHaveCount(0);
});

test("category links are shareable and pagination uses the selected live category", async ({ page }) => {
  await page.goto(origin + "/?type=SEC_FORM4");
  const filters = page.getByRole("navigation", { name: "Event types" });
  await expect(filters.getByRole("link", { name: "Insider activity" })).toHaveAttribute("aria-current", "page");
  await expect(filters.getByRole("link", { name: "Institutional holdings" })).toHaveAttribute("href", "/?type=SEC_13F");
  expect(await page.evaluate(() => (window as unknown as {lastFeedUrl:string}).lastFeedUrl)).toBe("/api/events/stream?type=SEC_FORM4");
  await page.route("**/api/events?cursor=*&type=SEC_FORM4", route => route.fulfill({ json: {items: [], nextCursor: null} }));
  await page.getByRole("button", { name: "Earlier events" }).click();
  await expect(page.getByRole("button", { name: "Earlier events" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
