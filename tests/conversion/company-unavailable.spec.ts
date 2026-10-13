import { expect, test } from "@playwright/test";
import { componentFixtureHtml } from "./fixtures/component-html";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let html: string;
test.beforeAll(async () => {
  const css = await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: path.resolve("src/app/globals.css") });
  html = await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {LocaleProvider} from './src/components/providers/locale-provider';import {CompanyUnavailable} from './src/components/company-unavailable';createRoot(document.getElementById('root')).render(<LocaleProvider locale={location.pathname.startsWith('/zh-cn')?'zh-CN':'en'}><CompanyUnavailable label="openabc"/></LocaleProvider>);`, { alias: { "next/link": path.resolve("tests/industry/link.tsx") } }, css.css);
});
for (const locale of ["en", "zh-cn"]) test(`missing company recovery follows theme and ${locale} locale`, async ({ page }, info) => {
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto(`http://company.test/${locale}/company/openabc`);
  await expect(page.getByRole("heading", { name: locale === "en" ? "Company profile not available" : "暂无公司资料" })).toBeVisible();
  await expect(page.getByText(/openabc/)).toBeVisible();
  await expect(page.getByRole("link", { name: locale === "en" ? "Search companies" : "搜索公司", exact: true })).toHaveAttribute("href", `/${locale}/companies`);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const colors = await page.locator("section").evaluate(el => {
      const context = document.createElement("canvas").getContext("2d")!;
      context.fillStyle = getComputedStyle(el.querySelector("h1")!).color;
      context.fillRect(0, 0, 1, 1);
      return { background: getComputedStyle(el).backgroundImage, text: Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3) };
    });
    expect(colors.background).toContain(theme === "light" ? "rgb(255, 255, 255)" : "rgb(15, 23, 42)");
    if (theme === "light") expect(colors.text).toEqual([20, 37, 54]);
    else expect(Math.min(...colors.text)).toBeGreaterThan(240);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`company-unavailable-${theme}.png`) });
  }
});
