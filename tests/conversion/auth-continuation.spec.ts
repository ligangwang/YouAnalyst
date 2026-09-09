import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { safeAuthDestination } from "../../src/lib/auth-continuation";
import type { AuthScenario } from "./fixtures/mocks";

const origin = "http://conversion.test";
const watchlistId = "owned & research+1";
const composer = `/predictions/new?${new URLSearchParams({ ticker: "AMD", watchlistId })}`;
let html: string;

for (const direction of ["UP", "DOWN"] as const) {
  test(`${direction} survives registration and is submitted to the selected watchlist`, async ({ page }) => {
    const destination = `/predictions/new?${new URLSearchParams({ ticker: "AMD", direction })}`;
    await page.goto(`${origin}/auth?${new URLSearchParams({ next: destination, mode: "register" })}`);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(`${origin}${destination}`);
    await expect(page.getByRole("button", { name: direction === "UP" ? "Bullish" : "Bearish", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#watchlist")).toHaveValue("default");
    await page.locator("#watchlist").selectOption(watchlistId);
    let submitted = false;
    await page.route(`${origin}/api/predictions`, route => {
      expect(route.request().postDataJSON()).toMatchObject({ ticker: "AMD", direction, watchlistId });
      submitted = true;
      return route.fulfill({ json: { id: "direction-test" } });
    });
    await page.getByRole("button", { name: "Publish prediction", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/predictions/direction-test`);
    expect(submitted).toBe(true);
  });
}

test("signed-out composer preserves bearish direction through its sign-in action", async ({ page }) => {
  await page.goto(`${origin}/predictions/new?ticker=AMD&direction=DOWN`);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("next")).toBe("/predictions/new?ticker=AMD&direction=DOWN");
});

test("empty account receives a default before list loading, with retry after failure", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  let ready = false;
  let attempts = 0;
  await page.route(`${origin}/api/watchlists/default`, route => {
    ready = ++attempts > 1;
    return route.fulfill(ready ? { json: { id: "new-default" } } : { status: 503, json: {} });
  });
  await page.route(`${origin}/api/watchlists?*`, route => {
    expect(ready).toBe(true);
    return route.fulfill({ json: { items: [{ id: "new-default", name: "My Watchlist", isPublic: true }] } });
  });
  await page.goto(`${origin}/predictions/new?ticker=AMD&direction=DOWN`);
  await expect(page.getByRole("alert")).toContainText("Unable to prepare your watchlist");
  await expect(page.getByRole("button", { name: "Publish prediction", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry watchlists" }).click();
  await expect(page.locator("#watchlist")).toHaveValue("new-default");
  await expect(page.getByRole("button", { name: "Bearish", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Publish prediction", exact: true })).toBeEnabled();
});

test("auth views identify the save funnel once without leaking the destination", async ({ page }) => {
  await page.goto(`${origin}/auth?${new URLSearchParams({ next: "/?company=NVDA", mode: "register" })}`);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("private@example.invalid");
  await page.getByRole("button", { name: "Have an account? Sign in", exact: true }).click();
  const events = await page.evaluate(() => (window.dataLayer ?? []).map((item) => Array.from(item as ArrayLike<unknown>)));
  const views = events.filter((event) => event[1] === "auth_view");
  expect(views).toHaveLength(1);
  expect(views[0][2]).toMatchObject({ entry_point: "map_save", action: "sign_up" });
  expect(JSON.stringify(events)).not.toMatch(/private@example|company=NVDA/);
});

test("signed-in visitors do not count as auth-page prospects", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  await page.goto(`${origin}/auth`);
  await expect(page.getByRole("heading", { name: "Signed in", exact: true })).toBeVisible();
  const events = await page.evaluate(() => (window.dataLayer ?? []).map((item) => (item as ArrayLike<unknown>)[1]));
  expect(events).not.toContain("auth_view");
});

test("short registration passwords are caught before attempting authentication", async ({ page }) => {
  await page.goto(`${origin}/auth?mode=register`);
  await page.getByLabel("Email", { exact: true }).fill("new@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("123");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  expect(await page.getByLabel("Password", { exact: true }).evaluate((input: HTMLInputElement) => input.validity.tooShort)).toBe(true);
  const events = await page.evaluate(() => (window.dataLayer ?? []).map((item) => (item as ArrayLike<unknown>)[1]));
  expect(events).not.toContain("auth_start");
});

test("map registration explains saving and saves before returning to the selected company", async ({ page }) => {
  const destination = "/?company=TSM";
  await page.goto(`${origin}/auth?${new URLSearchParams({ next: destination })}`);
  await expect(page.getByRole("heading", { name: "Keep TSM on your map" })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL(`${origin}${destination}`);
});

test("failed save stays signed in and retries before returning", async ({ page }) => {
  const destination = "/?company=TSM";
  let attempts = 0;
  await page.route(`${origin}/api/industry-graph/saved`, (route) => {
    attempts += 1;
    expect(route.request().postDataJSON()).toEqual({ ticker: "TSM", saved: true });
    return route.fulfill(attempts === 1 ? { status: 503, json: {} } : { json: { tickers: ["TSM"] } });
  });
  await page.goto(`${origin}/auth?${new URLSearchParams({ next: destination })}`);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("alert")).toContainText("saving TSM could not be confirmed");
  expect(new URL(page.url()).pathname).toBe("/auth");
  await page.getByRole("button", { name: "Save TSM and continue" }).click();
  await expect(page).toHaveURL(`${origin}${destination}`);
  expect(attempts).toBe(2);
});

test("map save opens email registration, supports Enter, and preserves the destination", async ({ page }) => {
  const destination = "/?company=NVDA";
  await page.goto(`${origin}/auth?${new URLSearchParams({ next: destination, mode: "register" })}`);
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveAttribute("autocomplete", "email");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "new-password");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("new@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByLabel("Password", { exact: true }).press("Enter");
  await expect(page).toHaveURL(`${origin}${destination}`);
  const events = await page.evaluate(() => (window.dataLayer ?? []).map((item) => Array.from(item as ArrayLike<unknown>)));
  expect(events.filter((event) => event[1] === "sign_up")).toHaveLength(1);
});

test("existing users can switch map registration to sign-in without losing context", async ({ page }) => {
  const destination = "/?company=MU";
  await page.goto(`${origin}/auth?${new URLSearchParams({ next: destination, mode: "register" })}`);
  await page.getByRole("button", { name: "Have an account? Sign in", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "current-password");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("existing@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(`${origin}${destination}`);
});

test.beforeAll(async () => {
  const mock = path.resolve("tests/conversion/fixtures/mocks.tsx");
  const result = await build({
    entryPoints: ["tests/conversion/fixtures/app.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
    define: { "process.env": "{}" },
    alias: {
      "@/components/providers/auth-provider": mock,
      "next/navigation": mock,
      "next/link": mock,
    },
  });
  html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="youanalyst-analytics" content="enabled" /></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});

test.beforeEach(async ({ page }) => {
  // Fulfill saves locally; block all external traffic and other mutations.
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname === "/api/watchlists/default" && request.method() === "POST") {
      expect(request.headers().authorization).toBe("Bearer isolated-test-token");
      return route.fulfill({ json: { id: "default" } });
    }
    if (url.origin === origin && url.pathname === "/api/industry-graph/saved" && request.method() === "POST") {
      const body = request.postDataJSON();
      expect(body.saved).toBe(true);
      return route.fulfill({ json: { tickers: [body.ticker] } });
    }
    if (url.origin !== origin || request.method() !== "GET") {
      await route.abort();
      throw new Error(`Unexpected request: ${request.method()} ${url.origin}${url.pathname}`);
    }
    if (url.pathname === "/api/watchlists") {
      return route.fulfill({ json: { items: [
        { id: "default", name: "My calls", isPublic: true },
        { id: watchlistId, name: "Research", isPublic: true },
      ] } });
    }
    if (url.pathname === "/api/tickers/search") return route.fulfill({ json: { items: [] } });
    if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    await route.abort();
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
});

for (const method of ["google-new", "google-existing", "email-new", "email-existing"] as const) {
  test(`${method} resumes the requested composer without publishing`, async ({ page }) => {
    await page.addInitScript((scenario: AuthScenario) => { window.authScenario = scenario; }, {
      googleNew: method === "google-new",
    });
    await page.goto(`${origin}${composer}`);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/auth?${new URLSearchParams({ next: composer })}`);
    if (method.startsWith("google")) {
      await page.getByRole("button", { name: "Continue with Google" }).click();
    } else {
      if (method === "email-new") await page.getByRole("button", { name: "Need an account? Create one" }).click();
      await page.getByPlaceholder("you@example.com").fill("test@example.invalid");
      await page.getByPlaceholder("Password", { exact: true }).fill("test-password");
      await page.getByRole("button", { name: method === "email-new" ? "Create account" : "Sign in", exact: true }).click();
    }
    await expect(page).toHaveURL(`${origin}${composer}`);
    await expect(page.getByRole("combobox", { name: "Ticker", exact: true })).toHaveValue("AMD");
    await expect(page.locator("#watchlist")).toHaveValue(watchlistId);
    const events = await page.evaluate(() => (window.dataLayer ?? []).map((item) => Array.from(item as ArrayLike<unknown>)));
    const success = method.endsWith("-new") ? "sign_up" : "login";
    expect(events.filter((event) => event[1] === success)).toHaveLength(1);
    expect(events.filter((event) => event[1] === (success === "sign_up" ? "login" : "sign_up"))).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain("test@example.invalid");
  });
}

test("unowned watchlist still falls back to the user's own watchlist", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  await page.goto(`${origin}/auth?${new URLSearchParams({ next: "/predictions/new?ticker=MU&watchlistId=someone-elses" })}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#watchlist")).toHaveValue("default");
});

for (const isNew of [true, false]) {
  test(`missing next preserves ${isNew ? "new" : "existing"} account default`, async ({ page }) => {
    await page.addInitScript((googleNew) => { window.authScenario = { googleNew }; }, isNew);
    await page.goto(`${origin}/auth`);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect(page).toHaveURL(`${origin}${isNew ? "/analysts/test-user?onboarding=nickname" : "/predictions"}`);
  });
}

test("signed-in auth without a safe next still goes to the feed", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  await page.goto(`${origin}/auth?${new URLSearchParams({ next: "/\\evil.example" })}`);
  await page.getByRole("button", { name: "Go to feed", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/predictions`);
});

test("auth failure keeps the continuation available for retry", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { authFails: true }; });
  await page.goto(`${origin}/auth?${new URLSearchParams({ next: composer })}`);
  await page.getByPlaceholder("you@example.com").fill("test@example.invalid");
  await page.getByPlaceholder("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Test authentication failed")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("next")).toBe(composer);
  const events = await page.evaluate(() => (window.dataLayer ?? []).map((item) => Array.from(item as ArrayLike<unknown>)));
  expect(events.filter((event) => event[1] === "auth_error")).toHaveLength(1);
  expect(events.filter((event) => ["login", "sign_up"].includes(String(event[1])))).toHaveLength(0);
});

test("publication analytics fires only after a successful response, without sending thesis or account IDs", async ({ page }) => {
  await page.addInitScript(() => {
    window.authScenario = { signedIn: true };
    window.sessionStorage.setItem("youanalyst:graph-visit", String(Date.now()));
  });
  await page.goto(`${origin}/predictions/new?ticker=AMD`);
  await page.getByLabel("Thesis", { exact: true }).fill("Private research must never enter analytics.");
  // Local response only; this handler intercepts the mutation and never reaches a server.
  await page.route(`${origin}/api/predictions`, (route) => route.fulfill({ status: 400, json: { error: "Test rejection" } }));
  await page.getByRole("button", { name: "Publish prediction", exact: true }).click();
  await expect(page.getByText("Test rejection")).toBeVisible();
  expect(await page.evaluate(() => (window.dataLayer ?? []).filter((item) => (item as ArrayLike<unknown>)[1] === "prediction_publish").length)).toBe(0);
  await page.route(`${origin}/api/predictions`, (route) => route.fulfill({ json: { id: "test-prediction" } }));
  await page.getByRole("button", { name: "Publish prediction", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/predictions/test-prediction`);
  const events = await page.evaluate(() => (window.dataLayer ?? []).map((item) => Array.from(item as ArrayLike<unknown>)));
  expect(events.filter((event) => event[1] === "prediction_publish")).toHaveLength(1);
  expect(JSON.stringify(events)).toContain('"graph_origin":"yes"');
  expect(JSON.stringify(events)).not.toMatch(/Private research|test-user|test-prediction/);
});

test("destination validation rejects external and ambiguous paths", () => {
  for (const destination of [undefined, "", "https://evil.example", "javascript:alert(1)", "//evil.example", "/\\evil.example", "/\n/evil.example", "/.//evil.example", "/%2f%2fevil.example", "/%5cevil.example", "/%00", "/%zz"]) {
    expect(safeAuthDestination(destination), String(destination)).toBeNull();
  }
  expect(safeAuthDestination("/ticker/AMD")).toBe("/ticker/AMD");
  expect(safeAuthDestination(composer)).toBe(composer);
});

for (const code of ["auth/popup-closed-by-user", "auth/cancelled-popup-request"]) {
  test(`Google dismissal ${code} is abandonment rather than an auth error`, async ({ page }) => {
    await page.addInitScript((googleErrorCode) => { window.authScenario = { googleErrorCode }; }, code);
    await page.goto(`${origin}/auth`);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await expect.poll(() => page.evaluate(() => (window.dataLayer ?? []).filter((item) => (item as ArrayLike<unknown>)[1] === "auth_cancel").length)).toBe(1);
    const events = await page.evaluate(() => (window.dataLayer ?? []).map((item) => (item as ArrayLike<unknown>)[1]));
    expect(events).not.toContain("auth_error");
    expect(events).not.toContain("sign_up");
    expect(events).not.toContain("login");
    await expect(page).toHaveURL(`${origin}/auth`);
  });
}
