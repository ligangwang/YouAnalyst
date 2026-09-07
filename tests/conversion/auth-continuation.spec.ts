import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { safeAuthDestination } from "../../src/lib/auth-continuation";
import type { AuthScenario } from "./fixtures/mocks";

const origin = "http://conversion.test";
const watchlistId = "owned & research+1";
const composer = `/predictions/new?${new URLSearchParams({ ticker: "AMD", watchlistId })}`;
let html: string;

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
  html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});

test.beforeEach(async ({ page }) => {
  // Block every external request and every mutation, even if a fixture regresses.
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
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
});

test("destination validation rejects external and ambiguous paths", () => {
  for (const destination of [undefined, "", "https://evil.example", "javascript:alert(1)", "//evil.example", "/\\evil.example", "/\n/evil.example", "/.//evil.example", "/%2f%2fevil.example", "/%5cevil.example", "/%00", "/%zz"]) {
    expect(safeAuthDestination(destination), String(destination)).toBeNull();
  }
  expect(safeAuthDestination("/ticker/AMD")).toBe("/ticker/AMD");
  expect(safeAuthDestination(composer)).toBe(composer);
});
