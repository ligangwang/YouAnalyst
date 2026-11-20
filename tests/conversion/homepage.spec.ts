import { expect, test } from "@playwright/test";
import path from "node:path";
import { componentFixtureHtml } from "./fixtures/component-html";

for (const locale of ["en", "zh-CN"]) {
  test(`${locale} lean homepage opens company search only on demand`, async ({ page }) => {
    const html = await componentFixtureHtml(`
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {HomeIntroduction} from './src/components/home-introduction';
      import {LocaleProvider} from './src/components/providers/locale-provider';
      createRoot(document.getElementById('root')).render(<LocaleProvider locale="${locale}"><HomeIntroduction/></LocaleProvider>);
    `, { mockThemeCatalog: false, alias: {
      "next/link": path.resolve("tests/conversion/fixtures/mocks.tsx"),
      "@/components/providers/auth-provider": path.resolve("tests/conversion/fixtures/mocks.tsx"),
    }});
    const apiRequests: string[] = [];
    await page.route("**/*", route => {
      if (new URL(route.request().url()).pathname.startsWith("/api/")) {
        apiRequests.push(route.request().url());
        return route.fulfill({ json: { items: [], total: 0 } });
      }
      return route.fulfill({ contentType: "text/html", body: html });
    });
    await page.goto("http://homepage.test");
    await expect(page.getByRole("heading")).toHaveText(locale === "en" ? "Start with a company." : "从一家公司开始。");
    await page.waitForTimeout(1500);
    expect(apiRequests).toEqual([]);
    await page.getByRole("button").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("combobox").fill("NVDA");
    await expect.poll(() => apiRequests.some(url => url.includes("q=NVDA"))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
