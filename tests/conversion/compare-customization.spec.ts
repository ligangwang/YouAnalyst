import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const origin = "http://compare-customization.test";
let html: string;
test.beforeAll(async () => {
  const mock = path.resolve("tests/conversion/fixtures/mocks.tsx");
  const bundle = await build({
    stdin: { contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { CompareCustomization, useCompareAppearance } from "./src/components/compare-customization";
      import { companyCompareColor } from "./src/lib/compare-appearance";
      import { LocaleProvider } from "./src/components/providers/locale-provider";
      function App() {
        const preferences = useCompareAppearance(false);
        return <><CompareCustomization preferences={preferences} symbols={["AAPL","NVDA"]} style="bar" light={false} colors={{}} next="/en/compare?symbols=AAPL,NVDA" onChange={preferences.change}/>
          <div data-testid="aapl-color">{companyCompareColor("AAPL",preferences.appearance)}</div></>;
      }
      createRoot(document.getElementById("root")).render(<LocaleProvider locale="en"><App/></LocaleProvider>);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: "compare-customization.js", platform: "browser", define: { "process.env": "{}" },
    alias: { "@/components/providers/auth-provider": mock, "next/navigation": mock, "next/link": mock },
  });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
});

test("guests must sign in to customize and keep their comparison destination", async ({ page }) => {
  let privateRequests = 0;
  await page.route("**/*", route => {
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    privateRequests++; return route.fulfill({ status: 401 });
  });
  await page.goto(origin + "/en/compare");
  await page.getByText("Colors & style templates", { exact: true }).click();
  const link = page.getByRole("link", { name: "Sign in or create an account to customize" });
  await expect(link).toBeVisible();
  expect(new URL((await link.getAttribute("href"))!, origin).searchParams.get("next")).toBe("/en/compare?symbols=AAPL,NVDA");
  await expect(page.getByLabel("Color for AAPL")).toHaveCount(0);
  expect(privateRequests).toBe(0);
});

test("company colors and templates save, reload, reset and clear on sign-out", async ({ page }, info) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  let appearance = { template: "classic", style: "line", companyColors: {} };
  await page.route("**/*", async route => {
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    expect(route.request().headers().authorization).toBe("Bearer isolated-test-token");
    if (route.request().method() === "PATCH") appearance = route.request().postDataJSON();
    return route.fulfill({ json: { appearance } });
  });
  await page.goto(origin + "/en/compare");
  await page.getByText("Colors & style templates", { exact: true }).click();
  const picker = page.getByLabel("Color for AAPL");
  await expect(picker).toBeEnabled();
  await picker.fill("#123456");
  await page.getByRole("button", { name: "Pastel", exact: true }).click();
  await expect(picker).toHaveValue("#123456");
  await expect(page.getByTestId("aapl-color")).toHaveText("#123456");
  await page.getByRole("button", { name: "Save custom colors" }).click();
  await expect(page.getByRole("status")).toHaveText("Custom colors saved to your account.");
  expect(appearance).toEqual({ template: "pastel", style: "bar", companyColors: { AAPL: "#123456" } });
  await page.reload();
  await page.getByText("Colors & style templates", { exact: true }).click();
  await expect(picker).toHaveValue("#123456");
  await expect(page.getByRole("button", { name: "Pastel", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath("compare-customization.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("group", { name: "AAPL color settings" }).getByRole("button", { name: "System default color" }).click();
  await page.getByRole("button", { name: "Save custom colors" }).click();
  await expect(page.getByRole("status")).toHaveText("Custom colors saved to your account.");
  expect(appearance.companyColors).toEqual({});
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-auth-user", { detail: null })));
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in or create an account to customize" })).toBeVisible();
});

test("failed profile loads prevent overwriting existing preferences and can retry", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  let failed = true;
  await page.route("**/*", route => route.request().isNavigationRequest() ? route.fulfill({ contentType: "text/html", body: html }) : failed
    ? route.fulfill({ status: 503, json: {} })
    : route.fulfill({ json: { appearance: { template: "classic", style: "line", companyColors: { AAPL: "#123456" } } } }));
  await page.goto(origin + "/en/compare");
  await page.getByText("Colors & style templates", { exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save custom colors" })).toBeDisabled();
  failed = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByLabel("Color for AAPL")).toHaveValue("#123456");
  await expect(page.getByRole("button", { name: "Save custom colors" })).toBeEnabled();
});


test("NVDA restores its last saved apple green after edits, reload and a failed save", async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  let appearance = { template: "classic", style: "line", companyColors: {} as Record<string,string> };
  let failSave = false;
  await page.route("**/*", route => {
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    if (route.request().method() === "PATCH") {
      if (failSave) return route.fulfill({ status: 503, json: {error:"unavailable"} });
      appearance = route.request().postDataJSON();
    }
    return route.fulfill({ json: { appearance } });
  });
  await page.goto(origin + "/en/compare");
  const open = () => page.getByText("Colors & style templates", { exact: true }).click();
  await open();
  const group = page.getByRole("group", {name:"NVDA color settings",exact:true});
  const picker = group.getByLabel("Color for NVDA");
  const restore = group.getByRole("button", {name:"Restore custom color",exact:true});
  await expect(picker).toBeEnabled();
  await picker.fill("#dfffa3");
  await page.getByRole("button", {name:"Save custom colors",exact:true}).click();
  await expect(page.getByRole("status")).toHaveText("Custom colors saved to your account.");
  expect(appearance.companyColors.NVDA).toBe("#dfffa3");
  await picker.fill("#ff00ff");await restore.click();await expect(picker).toHaveValue("#dfffa3");
  await page.reload();await open();await expect(picker).toHaveValue("#dfffa3");
  await page.getByRole("button", {name:"Pastel",exact:true}).click();
  await expect(picker).toHaveValue("#dfffa3");
  await picker.fill("#ff00ff");failSave = true;
  await page.getByRole("button", {name:"Save custom colors",exact:true}).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await restore.click();await expect(picker).toHaveValue("#dfffa3");
  await group.getByRole("button", {name:"System default color",exact:true}).click();
  await expect(picker).toHaveValue("#b7db9c");
  await restore.click();await expect(picker).toHaveValue("#dfffa3");
  failSave = false;await picker.fill("#64dd17");
  await page.getByRole("button", {name:"Save custom colors",exact:true}).click();
  await expect(page.getByRole("status")).toHaveText("Custom colors saved to your account.");
  await picker.fill("#ff00ff");await restore.click();await expect(picker).toHaveValue("#64dd17");
});
