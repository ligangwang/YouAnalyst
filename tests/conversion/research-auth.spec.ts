import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const origin = "http://research-auth.test";
let html: string;

// Real auth route and following page; authentication and all network responses
// stay in memory. No account creation, external auth or production writes.
test.beforeAll(async () => {
  const mock = path.resolve("tests/conversion/fixtures/mocks.tsx");
  const bundle = await build({
    stdin: {
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import AuthRoutePage from "./src/app/auth/page";
        import { FollowedCompaniesPage } from "./src/components/followed-companies-page";
        import { LocaleProvider } from "./src/components/providers/locale-provider";
        import { pathLocale, unlocalizedPath } from "./src/lib/i18n/urls";
        const root = createRoot(document.getElementById("root"));
        async function render() {
          const url = new URL(window.location.href);
          const pathname = unlocalizedPath(url.pathname);
          const locale = pathLocale(url.pathname) ?? (url.searchParams.get("lang") === "zh-CN" ? "zh-CN" : sessionStorage.getItem("test-locale") ?? "en");
          sessionStorage.setItem("test-locale", locale);
          const scopes = url.searchParams.getAll("scope");
          const following = pathname === "/watchlists/following" || pathname === "/feed" && scopes.length === 1 && scopes[0] === "following";
          const element = pathname === "/auth"
            ? await AuthRoutePage({ searchParams: Promise.resolve({ next: url.searchParams.get("next") ?? undefined, mode: url.searchParams.get("mode") ?? undefined }) })
            : following ? <FollowedCompaniesPage key={url.pathname} feed={pathname === "/feed"} /> : <p>Destination reached</p>;
          root.render(<LocaleProvider locale={locale}>{element}</LocaleProvider>);
        }
        window.addEventListener("route-change", () => void render());
        window.addEventListener("popstate", () => void render());
        void render();
      `,
      resolveDir: process.cwd(), loader: "tsx",
    },
    bundle: true, write: false, outfile: "research-auth.js", platform: "browser",
    define: { "process.env": "{}" },
    alias: { "@/components/providers/auth-provider": mock, "next/navigation": mock, "next/link": mock },
  });
  const css = await postcss([tailwind()]).process('@import "tailwindcss";', { from: path.resolve("research-auth-test.css") });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="youanalyst-analytics" content="enabled"><style>${css.css}body{background:#07111d;color:#f8fafc;font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script>${bundle.outputFiles.find(f => f.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});

test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => { throw error; });
  await page.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin || request.method() !== "GET") {
      void route.abort();
      throw new Error(`Unexpected request: ${request.method()} ${url.origin}${url.pathname}`);
    }
    if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname === "/api/knowledge-graph") return route.fulfill({ json: { nodes: [], relationships: [], sources: [], asOf: "2026-09-15" } });
    if (url.pathname === "/api/map-follows") return route.fulfill({ json: { companyIds: [] } });
    if (url.pathname === "/api/company-updates") return route.fulfill({ json: { items: [] } });
    void route.abort();
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
});

for (const view of ["Companies", "Updates"] as const) {
  for (const method of ["google-new", "google-existing", "email-new", "email-existing"] as const) {
    test(`${view} ${method} keeps research context and returns to the selected view`, async ({ page }, info) => {
      await page.addInitScript(googleNew => { window.authScenario = { googleNew }; }, method === "google-new");
      await page.goto(origin + "/en/watchlists/following");
      if (view === "Updates") await page.getByRole("button", { name: view, exact: true }).click();
      const destination = view === "Updates" ? "/en/feed?scope=following" : "/en/watchlists/following";
      const link = page.getByRole("link", { name: "Sign in / create account" });
      await expect(link).toHaveAttribute("href", `/auth?${new URLSearchParams({ next: destination })}`);
      await link.click();
      await expect(page.getByRole("heading", { name: "Keep your research in one place", exact: true })).toBeVisible();
      await expect(page.getByText("No bullish or bearish call required.", { exact: true })).toBeVisible();
      await expect(page.getByText("Sign in or create an account to save and follow companies in your private list and track sourced updates.", { exact: true })).toBeVisible();
      await expect(page.locator("main")).not.toContainText("Choose a company, pick Bullish or Bearish");
      await expect(page.locator("main")).not.toContainText("Your first watchlist is ready automatically");
      await expect(page.locator("main")).not.toContainText("confirm your call");
      if (method === "email-new") {
        await page.getByRole("button", { name: "Need an account? Create one", exact: true }).click();
        await expect(page.getByText("No bullish or bearish call required.", { exact: true })).toBeVisible();
        await page.screenshot({ path: info.outputPath(`research-signup-${view.toLowerCase()}.png`), fullPage: true });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (method.startsWith("google")) {
        await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
      } else {
        await page.getByLabel("Email", { exact: true }).fill("research@example.invalid");
        await page.getByLabel("Password", { exact: true }).fill("test-password");
        await page.getByRole("button", { name: method === "email-new" ? "Create account" : "Sign in", exact: true }).click();
      }
      await expect(page).toHaveURL(origin + destination);
      const events = await page.evaluate(() => (window.dataLayer ?? []).map(item => Array.from(item as ArrayLike<unknown>)));
      expect(events.find(event => event[1] === "auth_view")?.[2]).toMatchObject({ entry_point: "following" });
      expect(JSON.stringify(events)).not.toMatch(/research@example|test-user|scope=following/);
      await expect(page.getByRole("button", { name: view, exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByText("You haven’t followed any companies yet.", { exact: true })).toBeVisible();
    });
  }
}

for (const destination of ["/zh-cn/watchlists/following", "/zh-cn/feed?scope=following&filter=BUSINESS#updates"]) {
  test(`Chinese research signup and sign-in preserve ${destination}`, async ({ page }, info) => {
    await page.goto(`${origin}/auth?${new URLSearchParams({ next: destination, mode: "register", lang: "zh-CN" })}`);
    await expect(page.getByRole("heading", { name: "保存关注，继续研究", exact: true })).toBeVisible();
    await expect(page.getByText("无需发表看多或看空判断。", { exact: true })).toBeVisible();
    await expect(page.getByText("登录后将返回刚才的研究页面。", { exact: true })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("再确认观点");
    await page.getByRole("button", { name: "已有账号？登录", exact: true }).click();
    await expect(page.getByText("无需发表看多或看空判断。", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("research-signin-chinese.png"), fullPage: true });
    await page.getByLabel("邮箱", { exact: true }).fill("research@example.invalid");
    await page.getByLabel("密码", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(origin + destination);
  });
}

test("canceling Google auth and Back/Forward keep the research continuation available for retry", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { googleErrorCode: "auth/popup-closed-by-user" }; });
  await page.goto(origin + "/en/watchlists/following");
  await page.getByRole("button", { name: "Updates", exact: true }).click();
  await page.getByRole("link", { name: "Sign in / create account" }).click();
  const authUrl = page.url();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(authUrl);
  await expect(page.locator("main")).not.toContainText("Popup dismissed");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Following", exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByText("No bullish or bearish call required.", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(authUrl);
  await page.evaluate(() => { window.authScenario = {}; });
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page).toHaveURL(origin + "/en/feed?scope=following");
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Signed in", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(origin + "/en/feed?scope=following");
});

test("email auth failure, mode switches and retry retain the full research destination", async ({ page }) => {
  const destination = "/en/feed?scope=following&filter=BUSINESS#updates";
  await page.addInitScript(() => { window.authScenario = { authFails: true }; });
  await page.goto(`${origin}/auth?${new URLSearchParams({ next: destination, mode: "register" })}`);
  await page.getByLabel("Email", { exact: true }).fill("research@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText("Test authentication failed", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("next")).toBe(destination);
  await page.getByRole("button", { name: "Have an account? Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Need an account? Create one", exact: true }).click();
  await expect(page.getByText("No bullish or bearish call required.", { exact: true })).toBeVisible();
  await page.evaluate(() => { window.authScenario = {}; });
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(origin + destination);
});

for (const direction of ["UP", "DOWN"]) {
  test(`intentional ${direction} call keeps its existing review-before-publishing copy`, async ({ page }) => {
    const destination = `/predictions/new?ticker=AMD&direction=${direction}`;
    await page.goto(`${origin}/auth?${new URLSearchParams({ next: destination, mode: "register" })}`);
    await expect(page.getByRole("heading", { name: `Track your ${direction === "UP" ? "bullish" : "bearish"} view on AMD`, exact: true })).toBeVisible();
    await expect(page.getByText("Your company and direction will carry through. Review your call before publishing; creating an account does not publish it.", { exact: true })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("No bullish or bearish call required.");
    await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
    await expect(page).toHaveURL(origin + destination);
  });
}

for (const destination of ["https://evil.example/feed?scope=following", "//evil.example/watchlists/following", "/%2f%2fevil.example/feed?scope=following"]) {
  test(`unsafe research-looking next falls back safely: ${destination}`, async ({ page }) => {
    await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
    await page.goto(`${origin}/auth?${new URLSearchParams({ next: destination })}`);
    await page.getByRole("button", { name: "Go to feed", exact: true }).click();
    await expect(page).toHaveURL(origin + "/predictions");
  });
}
