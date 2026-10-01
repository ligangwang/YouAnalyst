import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const origin = "http://auth-measurement.test";
let html: string;
const events = (page: Page) => page.evaluate(() => (window.dataLayer ?? []).map(item => Array.from(item as ArrayLike<unknown>)));

// Use the real AuthPage and AuthProvider, including Firebase's friendly-error
// boundary. The SDK operations, profile bootstrap and follow writes are local
// fixtures only; every other network request is blocked.
test.beforeAll(async () => {
  const mocks = path.resolve("tests/conversion/fixtures/auth-measurement-mocks.ts");
  const bundle = await build({
    stdin: {
      contents: `
        import React, { useSyncExternalStore } from "react";
        import { createRoot } from "react-dom/client";
        import { AuthPage } from "./src/components/auth-page";
        import { AuthProvider } from "./src/components/providers/auth-provider";
        import { LocaleProvider } from "./src/components/providers/locale-provider";
        const subscribe = fn => { window.addEventListener("route-change", fn); window.addEventListener("popstate", fn); return () => { window.removeEventListener("route-change", fn); window.removeEventListener("popstate", fn); }; };
        function App() {
          useSyncExternalStore(subscribe, () => window.location.href);
          const url = new URL(window.location.href);
          return <AuthProvider><LocaleProvider locale="en">{url.pathname === "/auth" ? <AuthPage requestedNext={url.searchParams.get("next") ?? undefined} initialCreate={url.searchParams.get("mode") === "register"} /> : <p>Research destination</p>}</LocaleProvider></AuthProvider>;
        }
        createRoot(document.getElementById("root")).render(<App />);`,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, platform: "browser", define: { "process.env": "{}" },
    alias: { "firebase/auth": mocks, "@/lib/firebase/client": mocks, "next/navigation": mocks },
  });
  html = `<!doctype html><html><head><meta name="youanalyst-analytics" content="enabled"></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});

test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => { throw error; });
  await page.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (request.isNavigationRequest() && request.method() === "GET") return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/users/bootstrap" && request.method() === "POST") return route.fulfill({ json: { created: true } });
    if (url.pathname === "/api/knowledge-graph" && request.method() === "GET") return route.fulfill({ json: { nodes: [] } });
    if (url.pathname === "/api/map-follows" && request.method() === "PATCH") {
      expect(request.headers().authorization).toBe("Bearer measurement-token");
      expect(request.postDataJSON()).toEqual({ companyId: "US:AMD", follow: true });
      return route.fulfill({ json: { companyIds: ["US:AMD"] } });
    }
    void route.abort();
    throw new Error(`Unexpected local request: ${request.method()} ${url.pathname}`);
  });
});

for (const destination of ["/en/ticker/AMD?tab=research#evidence", "/?company=AMD"]) {
  test(`follow continuation gets its own funnel attribution from ${destination}`, async ({ page }) => {
    const next = new URL(destination, origin);
    next.searchParams.set("followCompany", "US:AMD");
    await page.goto(`${origin}/auth?${new URLSearchParams({ next: next.pathname + next.search + next.hash, mode: "register" })}`);
    await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
    await expect(page).toHaveURL(origin + destination);
    const recorded = await events(page);
    for (const name of ["auth_view", "auth_start", "sign_up"]) {
      const matching = recorded.filter(event => event[1] === name);
      expect(matching).toHaveLength(1);
      expect(matching[0][2]).toMatchObject({ entry_point: "company_follow" });
    }
    expect(recorded.find(event => event[1] === "auth_start")?.[2]).toMatchObject({ action: "sign_up", method: "google" });
    expect(recorded.filter(event => event[1] === "company_follow")).toHaveLength(1);
    expect(recorded.some(event => event[1] === "graph_save_complete")).toBe(false);
    expect(JSON.stringify(recorded)).not.toMatch(/private@example|Private Name|measurement-user|measurement-token|US:AMD|followCompany|tab=research/);
  });
}

for (const next of ["/en/ticker/AMD?followCompany=invalid", "https://evil.example/?followCompany=US%3AAMD", "/en/ticker/AMD?entry_point=company_follow"]) {
  test(`invalid or untrusted follow-looking continuation is not attributed as follow: ${next}`, async ({ page }) => {
    await page.goto(`${origin}/auth?${new URLSearchParams({ next })}`);
    await expect.poll(async () => (await events(page)).filter(event => event[1] === "auth_view").length).toBe(1);
    expect((await events(page)).find(event => event[1] === "auth_view")?.[2]).toMatchObject({ entry_point: "general" });
  });
}

for (const [mode, method, code, reason] of [
  ["register", "email", "auth/email-already-in-use", "account_exists"],
  ["login", "email", "auth/invalid-credential", "invalid_credentials"],
  ["register", "google", "auth/popup-blocked", "popup_blocked"],
  ["login", "google", "auth/network-request-failed", "network"],
  ["register", "google", "private-code@example.invalid", "unknown"],
] as const) {
  test(`${method} ${mode} ${reason} errors preserve a bounded reason across the real provider`, async ({ page }) => {
    await page.addInitScript(errorCode => { window.authMeasurementScenario = { errorCode }; }, code);
    await page.goto(`${origin}/auth?${new URLSearchParams({ mode, next: "/en/feed?scope=following" })}`);
    if (method === "email") {
      await page.getByLabel("Email", { exact: true }).fill("private@example.invalid");
      await page.getByLabel("Password", { exact: true }).fill("test-password");
      await page.getByRole("button", { name: mode === "register" ? "Create account" : "Sign in", exact: true }).click();
    } else await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
    await expect.poll(async () => (await events(page)).filter(event => event[1] === "auth_error").length).toBe(1);
    const recorded = await events(page), action = mode === "register" ? "sign_up" : "login";
    expect(recorded.find(event => event[1] === "auth_start")?.[2]).toMatchObject({ method, action, entry_point: "following" });
    expect(recorded.find(event => event[1] === "auth_error")?.[2]).toMatchObject({ method, action, entry_point: "following", error_reason: reason });
    expect(recorded.some(event => ["sign_up", "login", "auth_cancel"].includes(String(event[1])))).toBe(false);
    expect(JSON.stringify(recorded)).not.toMatch(/private@example|private-code|test-password|Private test detail|auth\//);
  });
}

test("cancel then retry and Back do not replay authentication or follow intent", async ({ page }) => {
  await page.addInitScript(() => { window.authMeasurementScenario = { errorCode: "auth/popup-closed-by-user" }; });
  const next = "/en/ticker/AMD?followCompany=US%3AAMD";
  await page.goto(`${origin}/auth?${new URLSearchParams({ next, mode: "register" })}`);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect.poll(async () => (await events(page)).filter(event => event[1] === "auth_cancel").length).toBe(1);
  expect((await events(page)).find(event => event[1] === "auth_cancel")?.[2]).toMatchObject({ action: "sign_up", error_reason: "canceled", entry_point: "company_follow" });
  await page.evaluate(() => { window.authMeasurementScenario = {}; });
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page).toHaveURL(origin + "/en/ticker/AMD");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Signed in", exact: true })).toBeVisible();
  const recorded = await events(page);
  expect(recorded.filter(event => event[1] === "auth_start")).toHaveLength(2);
  expect(recorded.filter(event => event[1] === "sign_up")).toHaveLength(1);
  expect(recorded.filter(event => event[1] === "company_follow")).toHaveLength(1);
  expect(recorded.filter(event => event[1] === "auth_view")).toHaveLength(1);
  expect(recorded.some(event => ["auth_error", "company_follow_intent"].includes(String(event[1])))).toBe(false);
});

test("failed follow then retry records one signup and only confirmed follow completion", async ({ page }) => {
  let attempts = 0;
  await page.route(origin + "/api/map-follows", route => route.fulfill(++attempts === 1 ? { status: 503, json: {} } : { json: { companyIds: ["US:AMD"] } }));
  await page.goto(`${origin}/auth?${new URLSearchParams({ next: "/en/ticker/AMD?followCompany=US%3AAMD", mode: "register" })}`);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("follow was not saved");
  expect((await events(page)).filter(event => event[1] === "company_follow")).toHaveLength(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(origin + "/en/ticker/AMD");
  const recorded = await events(page);
  expect(recorded.filter(event => event[1] === "auth_start")).toHaveLength(1);
  expect(recorded.filter(event => event[1] === "sign_up")).toHaveLength(1);
  expect(recorded.filter(event => event[1] === "company_follow")).toHaveLength(1);
  expect(recorded.some(event => ["auth_error", "company_follow_intent"].includes(String(event[1])))).toBe(false);
});

test("analytics opt-out suppresses auth diagnostics and follow completion", async ({ page }) => {
  await page.context().addCookies([{ name: "youanalyst_analytics_opt_out", value: "1", url: origin }]);
  await page.addInitScript(() => { window.authMeasurementScenario = { errorCode: "auth/network-request-failed" }; });
  await page.goto(`${origin}/auth?${new URLSearchParams({ next: "/en/ticker/AMD?followCompany=US%3AAMD", mode: "register" })}`);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.getByText("Network problem. Check your connection and try again.", { exact: true })).toBeVisible();
  await page.evaluate(() => { window.authMeasurementScenario = {}; });
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page).toHaveURL(origin + "/en/ticker/AMD");
  expect(await events(page)).toEqual([]);
});

test("repeated activation stays disabled during pending profile bootstrap", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(origin + "/api/users/bootstrap", async route => {
    await pending;
    await route.fulfill({ json: { created: true } });
  });
  await page.goto(`${origin}/auth?${new URLSearchParams({ next: "/en/ticker/AMD?followCompany=US%3AAMD", mode: "register" })}`);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  const saving = page.getByRole("button", { name: "Saving…", exact: true });
  await expect(saving).toBeDisabled();
  // Repeated mouse/keyboard activation while the request is pending cannot
  // submit another SDK request or write the continuation prematurely.
  await saving.dispatchEvent("click");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.authMeasurementAttempts)).toEqual(["google"]);
  expect((await events(page)).filter(event => event[1] === "auth_start")).toHaveLength(1);
  expect((await events(page)).filter(event => event[1] === "company_follow")).toHaveLength(0);
  release();
  await expect(page).toHaveURL(origin + "/en/ticker/AMD");
  expect((await events(page)).filter(event => event[1] === "company_follow")).toHaveLength(1);
});
