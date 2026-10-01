import { expect, test, type Page, type Route } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const origin = "http://admin-company-graph.test";
let html: string;

type RequestItem = {
  id: string;
  ticker: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  requestedCount: number;
  firstRequestedAt: string;
  lastRequestedAt: string;
  updatedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  error: string | null;
};

function request(ticker: string, status: RequestItem["status"]): RequestItem {
  return {
    id: ticker,
    ticker,
    status,
    requestedCount: 3,
    firstRequestedAt: "2026-09-20T10:00:00Z",
    lastRequestedAt: "2026-09-25T10:00:00Z",
    updatedAt: "2026-09-25T10:00:00Z",
    completedAt: status === "COMPLETED" ? "2026-09-25T10:00:00Z" : null,
    failedAt: status === "FAILED" ? "2026-09-25T10:00:00Z" : null,
    error: status === "FAILED" ? "Previous extraction failed" : null,
  };
}

async function openFixture(page: Page, handler: (route: Route) => Promise<void>) {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (new URL(req.url()).origin !== origin) return route.abort();
    if (req.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    expect(new URL(req.url()).pathname).toBe(req.method() === "POST"
      ? "/api/admin/company-graph/extract"
      : "/api/admin/company-graph/requests");
    expect(req.headers().authorization).toBe("Bearer isolated-test-token");
    return handler(route);
  });
  await page.goto(origin);
}

function row(page: Page, ticker: string) {
  return page.getByRole("article").filter({ has: page.getByRole("heading", { name: `$${ticker}`, exact: true }) });
}

test("terminal failures offer a reviewed fresh generation without silently charging on retry", async ({ page }) => {
  const items = [request("AMD", "FAILED")], posts: unknown[] = [];
  await openFixture(page, async route => {
    if (route.request().method() === "POST") {
      posts.push(route.request().postDataJSON());
      items[0] = { ...items[0], status: "QUEUED", error: null };
      return route.fulfill({ status: 202, json: { ok: true, ticker: "AMD", status: "QUEUED", dispatch: { status: "PUBLISHED" } } });
    }
    return route.fulfill({ json: { items } });
  });
  await row(page, "AMD").getByRole("button", { name: "Start fresh extraction", exact: true }).click();
  await expect(row(page, "AMD").getByText(/may incur another OpenAI charge/)).toBeVisible();
  expect(posts).toEqual([]);
  await row(page, "AMD").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(row(page, "AMD").getByRole("button", { name: "Confirm fresh extraction", exact: true })).toHaveCount(0);
  expect(posts).toEqual([]);
  await row(page, "AMD").getByRole("button", { name: "Start fresh extraction", exact: true }).click();
  await row(page, "AMD").getByRole("button", { name: "Confirm fresh extraction", exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts).toEqual([{ ticker: "AMD", force: true }]);
  await expect(page.getByRole("status")).toContainText("regeneration queued");
});

test.beforeAll(async () => {
  const bundled = await build({
    stdin: {
      contents: `import React from "react"; import {createRoot} from "react-dom/client";
        import {AdminCompanyGraphRequestsPage} from "./src/components/admin-company-graph-requests-page";
        createRoot(document.getElementById("root")).render(<AdminCompanyGraphRequestsPage/>);`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "browser",
    define: { "process.env": "{}" },
    alias: {
      "next/link": path.resolve("tests/industry/link.tsx"),
      "@/components/providers/auth-provider": path.resolve("tests/conversion/fixtures/mocks.tsx"),
    },
  });
  html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script>${bundled.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});

test("queues a request once, reports background acceptance, and retains request history", async ({ page }) => {
  const items = [request("AMD", "FAILED"), request("MSFT", "COMPLETED"), request("NVDA", "PROCESSING")];
  const posts: unknown[] = [];
  let release!: () => void;
  let reads = 0;
  await openFixture(page, async (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request().postDataJSON());
      await new Promise<void>((resolve) => { release = resolve; });
      items[0] = { ...items[0], status: "QUEUED", error: null };
      return route.fulfill({ status: 202, json: { ok: true, ticker: "AMD", status: "QUEUED", dispatch: { status: "PUBLISHED" } } });
    }
    reads++;
    return route.fulfill({ json: { items } });
  });

  await expect(row(page, "NVDA").getByRole("button", { name: "Processing", exact: true })).toBeDisabled();
  await row(page, "AMD").getByRole("button", { name: "Queue retry", exact: true }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect.poll(() => posts.length).toBe(1);
  await expect(row(page, "AMD").getByRole("button", { name: "Submitting...", exact: true })).toBeDisabled();
  await expect(row(page, "MSFT").getByRole("button", { name: "Queue regeneration", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  release();

  await expect(page.getByRole("status")).toHaveText("AMD graph extraction queued. Processing continues in the background. Refresh request history for results.");
  await expect(row(page, "AMD").getByRole("button", { name: "Queued", exact: true })).toBeDisabled();
  await expect(row(page, "MSFT").getByRole("button", { name: "Queue regeneration", exact: true })).toBeEnabled();
  await expect(page.getByRole("article")).toHaveCount(3);
  await expect(row(page, "AMD")).toContainText("Requested 3 times");
  await expect(page.getByText(/generated with|Estimated OpenAI cost/)).toHaveCount(0);
  expect(posts).toEqual([{ ticker: "AMD", force: false }]);
  expect(reads).toBe(2);

  items[0] = { ...items[0], status: "COMPLETED" };
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(row(page, "AMD").getByRole("button", { name: "Queue regeneration", exact: true })).toBeEnabled();
});

test("pending dispatch stays accepted if history refresh fails, without losing other rows", async ({ page }) => {
  const items = [request("AMD", "COMPLETED"), request("MSFT", "FAILED")];
  const posts: unknown[] = [];
  let reads = 0;
  await openFixture(page, async (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request().postDataJSON());
      return route.fulfill({ status: 202, json: { ok: true, ticker: "AMD", status: "QUEUED", dispatch: { status: "PENDING", error: "Internal publisher error" } } });
    }
    reads++;
    return reads === 1
      ? route.fulfill({ json: { items } })
      : route.fulfill({ status: 503, json: { error: "History temporarily unavailable" } });
  });
  await row(page, "AMD").getByRole("button", { name: "Queue regeneration", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("AMD graph regeneration queued. Processing continues in the background. Refresh request history for results. The request is saved; worker dispatch is pending.");
  await expect(page.getByRole("alert")).toHaveText("History temporarily unavailable");
  await expect(row(page, "AMD").getByRole("button", { name: "Queued", exact: true })).toBeDisabled();
  await expect(row(page, "AMD").getByText("QUEUED", { exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByText("Internal publisher error", { exact: true })).toHaveCount(0);
  expect(posts).toEqual([{ ticker: "AMD", force: true }]);
});

for (const status of ["ALREADY_QUEUED", "AVAILABLE"] as const) {
  test(`handles ${status} without inventing synchronous results`, async ({ page }) => {
    let item = request("AMD", "FAILED");
    let posts = 0;
    await openFixture(page, async (route) => {
      if (route.request().method() === "POST") {
        posts++;
        item = { ...item, status: status === "AVAILABLE" ? "COMPLETED" : "PROCESSING", error: null };
        return route.fulfill({ status: status === "AVAILABLE" ? 200 : 202, json: { ok: true, ticker: "AMD", status, dispatch: { status: "PUBLISHED" } } });
      }
      return route.fulfill({ json: { items: [item] } });
    });
    await row(page, "AMD").getByRole("button", { name: "Queue retry", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(status === "AVAILABLE"
      ? "AMD graph is already available."
      : "AMD graph extraction is already queued or processing. Refresh request history for results.");
    await expect(page.getByText(/generated with|Estimated OpenAI cost/)).toHaveCount(0);
    if (status === "ALREADY_QUEUED") {
      await expect(row(page, "AMD").getByRole("button", { name: "Processing", exact: true })).toBeDisabled();
    } else {
      await expect(row(page, "AMD").getByRole("button", { name: "Queue regeneration", exact: true })).toBeEnabled();
    }
    expect(posts).toBe(1);
  });
}

for (const failure of ["network", "invalid-success", "server-error"] as const) {
  test(`${failure} preserves uncertainty and requires a manual history refresh before resubmission`, async ({ page }) => {
    let posts = 0;
    let reads = 0;
    await openFixture(page, async (route) => {
      if (route.request().method() === "POST") {
        posts++;
        if (failure === "network") return route.abort("failed");
        if (failure === "invalid-success") return route.fulfill({ status: 202, body: "invalid JSON" });
        return route.fulfill({ status: 500, json: { error: "Server failure after write" } });
      }
      reads++;
      if (reads === 2) return route.fulfill({ status: 503, json: { error: "History temporarily unavailable" } });
      return route.fulfill({ json: { items: [request("AMD", reads > 2 ? "PROCESSING" : "COMPLETED"), request("MSFT", "FAILED")] } });
    });
    await row(page, "AMD").getByRole("button", { name: "Queue regeneration", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "durable request" })).toHaveText("AMD request could not be confirmed. A durable request may already exist. Refresh request history before submitting again.");
    await expect(row(page, "AMD").getByRole("button", { name: "Refresh to verify", exact: true })).toBeDisabled();
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(page.getByRole("alert").filter({ hasText: "History temporarily unavailable" })).toBeVisible();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(row(page, "AMD").getByRole("button", { name: "Processing", exact: true })).toBeDisabled();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(posts).toBe(1);
  });
}

test("an explicit rejection remains visible after a successful history refresh", async ({ page }) => {
  await openFixture(page, async (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 403, json: { error: "Forbidden" } })
    : route.fulfill({ json: { items: [request("AMD", "FAILED")] } }));
  await row(page, "AMD").getByRole("button", { name: "Queue retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Forbidden");
  await expect(row(page, "AMD").getByRole("button", { name: "Queue retry", exact: true })).toBeEnabled();
  await expect(page.getByRole("status")).toHaveCount(0);
});

for (const cached of [false, true]) {
test(`legacy deployments can process queued requests and show actual ${cached ? "cached" : "synchronous"} results`, async ({ page }) => {
  let item = request("AMD", "QUEUED");
  const posts: unknown[] = [];
  await openFixture(page, async (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request().postDataJSON());
      item = { ...item, status: "COMPLETED" };
      return route.fulfill({ json: { ok: true, ticker: "AMD", edges: [{}, {}], cached, extraction: { usageEvent: { estimatedCostUsd: 0.02 } } } });
    }
    return route.fulfill({ json: { items: [item] } });
  });
  await row(page, "AMD").getByRole("button", { name: "Queue extraction", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(cached
    ? "AMD graph is already current."
    : "AMD graph generated with 2 edges. Estimated OpenAI cost: $0.02.");
  await expect(row(page, "AMD").getByRole("button", { name: "Queue regeneration", exact: true })).toBeEnabled();
  expect(posts).toEqual([{ ticker: "AMD", force: false }]);
});
}
