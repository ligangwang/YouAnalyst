import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import type { CommunityComparison, ComparisonComment } from "../../src/lib/compare-community";
import { comparisonVoteTotals } from "../../src/lib/compare-community";

const origin = "http://comparison-community.test", postId = "a".repeat(64);
let html: string;
const sample: CommunityComparison = { id: postId, title: "Chips over one year", body: "Watch this race.", requestId: "existing-community-request", userId: "author1", authorName: "Chip Analyst", createdAt: "2026-10-19T12:00:00.000Z", likes: 3, dislikes: 1, netLikes: 2, commentCount: 0, viewerVote: 0,
  comparison: { theme: "dark", config: { symbols: ["AMD", "NVDA"], start: "2025-01-01", end: "2025-12-31", style: "bar", colors: { AMD: "#123456", NVDA: "#654321" } } } };

test.beforeAll(async () => {
  const mock = path.resolve("tests/conversion/fixtures/mocks.tsx");
  const bundle = await build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { ComparisonCommunity, CommunityComparisonDetail, ComparisonCredit } from "./src/components/compare-community";
      import { LocaleProvider } from "./src/components/providers/locale-provider";
      const sample = ${JSON.stringify(sample)};
      const detail = window.location.pathname.includes("/community/");
      createRoot(document.getElementById("root")).render(<LocaleProvider locale="en">{detail ? <CommunityComparisonDetail id={sample.id}/> : <main><ComparisonCredit post={sample}/><ComparisonCommunity comparison={sample.comparison} ready/></main>}</LocaleProvider>);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: "community.js", platform: "browser", define: { "process.env": "{}" },
    alias: { "@/components/providers/auth-provider": mock, "next/navigation": mock, "next/link": mock },
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text, css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--background:#07111d;--foreground:#f8fafc;--text-secondary:#9ba8b7;--color-line:#ffffff26}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;background:var(--background);color:var(--foreground)}main{max-width:1100px;margin:auto;padding:16px}button{background:transparent;color:inherit}h1,h2,h3,p{margin:8px 0}${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
});

test("guests view public replays and author credit but posting and voting lead to sign-in", async ({ page }) => {
  let writes = 0;
  await page.route("**/*", route => {
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (route.request().method() !== "GET") writes++;
    return route.fulfill({ json: { items: [sample], nextCursor: null } });
  });
  await page.goto(origin + "/en/compare");
  await expect(page.getByText("Community favorite", { exact: false })).toBeVisible();
  await expect(page.locator("aside details")).not.toHaveAttribute("open");
  await page.locator("aside summary").click();
  await expect(page.locator("aside").getByRole("link", { name: "Chip Analyst" })).toHaveAttribute("href", "/en/analysts/author1");
  await page.getByText("Post this comparison", { exact: true }).click();
  const authLink = page.getByRole("link", { name: "Sign in or create an account to post" });
  const destination = new URL((await authLink.getAttribute("href"))!, origin).searchParams.get("next")!;
  expect(destination).toContain("symbols=AMD%2CNVDA"); expect(destination).toContain("style=bar"); expect(destination).toContain("colors=123456%2C654321");
  await expect(page.getByRole("button", { name: "Publish comparison", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Like 3", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(`/en/compare/community/${postId}`);
  expect(writes).toBe(0);
});

test("signed-in authors publish the exact replay snapshot and retry with the same request ID", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  const requests: Array<Record<string, unknown>> = [];
  await page.route("**/*", route => {
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (route.request().method() === "POST") {
      expect(route.request().headers().authorization).toBe("Bearer isolated-test-token");
      requests.push(route.request().postDataJSON());
      return requests.length === 1 ? route.fulfill({ status: 503, json: { error: "Please retry publishing" } }) : route.fulfill({ status: 201, json: { id: "b".repeat(64) } });
    }
    return route.fulfill({ json: { items: [sample], nextCursor: null } });
  });
  await page.goto(origin + "/en/compare");
  await page.getByText("Post this comparison", { exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("My favorite chip race");
  await page.getByLabel("Message (optional)").fill("A fun comparison of this period.");
  await page.getByRole("button", { name: "Publish comparison", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Please retry publishing");
  await page.getByRole("button", { name: "Publish comparison", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Published to the community.");
  expect(requests).toHaveLength(2); expect(requests[0].requestId).toBe(requests[1].requestId);
  expect(requests[1].comparison).toEqual(sample.comparison);
  expect(requests[1].title).toBe("My favorite chip race");
  await expect(page.getByRole("link", { name: "View your post" })).toHaveAttribute("href", `/en/compare/community/${"b".repeat(64)}`);
});

test("likes and dislikes switch and toggle off with visible net scores", async ({ page }, info) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  let post = structuredClone(sample);
  await page.route("**/*", route => {
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (route.request().method() === "POST") {
      const next = route.request().postDataJSON().value;
      const result = { ...comparisonVoteTotals(post.likes, post.dislikes, post.viewerVote, next), viewerVote: next };
      post = { ...post, ...result };
      return route.fulfill({ json: result });
    }
    return route.fulfill({ json: { items: [post], nextCursor: null } });
  });
  await page.goto(origin + "/en/compare");
  const card = page.getByRole("article");
  await card.getByRole("button", { name: "Like 3", exact: true }).click();
  await expect(card.getByRole("button", { name: "Like 4", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(card).toContainText("Net likes: 3");
  await card.getByRole("button", { name: "Dislike 1", exact: true }).click();
  await expect(card.getByRole("button", { name: "Like 3", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(card.getByRole("button", { name: "Dislike 2", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(card).toContainText("Net likes: 1");
  await card.getByRole("button", { name: "Dislike 2", exact: true }).click();
  await expect(card).toContainText("Net likes: 2");
  await page.screenshot({ path: info.outputPath("comparison-community.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("discussion replays saved stocks and styles, accepts plain-text comments and paginates", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  let commentRequest: Record<string, unknown> | null = null;
  const oldComment: ComparisonComment = { id: "c".repeat(64), userId: "user2", authorName: "Another analyst", content: "An older reply", createdAt: "2026-10-18T00:00:00.000Z" };
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/en/compare/embed") return route.fulfill({ contentType: "text/html", body: "Replay fixture" });
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname.endsWith("/comments")) {
      if (route.request().method() === "POST") {
        commentRequest = route.request().postDataJSON();
        return route.fulfill({ status: 201, json: { id: "d".repeat(64), userId: "test-user", authorName: "Signed-in analyst", content: commentRequest!.content, createdAt: "2026-10-19T14:00:00.000Z" } });
      }
      return route.fulfill({ json: url.searchParams.has("cursor") ? { items: [oldComment], nextCursor: null } : { items: [], nextCursor: "older" } });
    }
    return route.fulfill({ json: sample });
  });
  await page.goto(origin + `/en/compare/community/${postId}`);
  const frame = page.getByTitle("Replay Chips over one year");
  await expect(frame).toBeVisible();
  const embed = new URL((await frame.getAttribute("src"))!, origin);
  expect(embed.searchParams.get("symbols")).toBe("AMD,NVDA"); expect(embed.searchParams.get("style")).toBe("bar"); expect(embed.searchParams.get("colors")).toBe("123456,654321");
  const content = "<script>window.bad = true</script> What a race!";
  await page.getByLabel("Add a public comment").fill(content);
  await page.getByRole("button", { name: "Post comment", exact: true }).click();
  await expect(page.getByRole("region", { name: "Comments", exact: true }).getByRole("article").getByText(content, { exact: true })).toBeVisible();
  expect(commentRequest!.content).toBe(content);
  expect(await page.evaluate(() => "bad" in window)).toBe(false);
  await page.getByRole("button", { name: "Load more comments" }).click();
  await expect(page.getByText("An older reply", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Comments (1)" })).toBeVisible();
});
