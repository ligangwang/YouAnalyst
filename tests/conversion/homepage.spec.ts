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
    const videoRequests: string[] = [];
    await page.route("**/*", route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith(".mp4")) videoRequests.push(pathname);
      if (pathname.startsWith("/api/")) {
        apiRequests.push(route.request().url());
        return route.fulfill({ json: { items: [], total: 0 } });
      }
      return route.fulfill({ contentType: "text/html", body: html });
    });
    await page.goto("http://homepage.test");
    await expect(page.getByRole("heading", {level:1})).toHaveText(locale === "en" ? "Start with a company." : "从一家公司开始。");
    await page.waitForTimeout(1500);
    expect(apiRequests).toEqual([]);
    expect(videoRequests).toEqual([]);
    const preview = page.getByRole("region", { name: locale === "en" ? "Turn your market view into a video" : "把你的投资观点做成视频" });
    await expect(preview.locator("video")).toBeVisible();
    const createLink = await preview.getByRole("link").first().getAttribute("href");
    const destination = new URL(createLink!, "http://homepage.test");
    expect(destination.pathname).toBe("/auth");
    expect(destination.searchParams.get("next")).toBe(locale === "en" ? "/en/compare" : "/zh-cn/compare");
    await expect(page.getByRole("img")).toBeVisible();
    await page.getByRole("searchbox").fill("NVDA");
    await expect.poll(() => apiRequests.some(url => url.includes("q=NVDA"))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
