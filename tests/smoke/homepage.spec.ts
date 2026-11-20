import { expect, test } from "./member-fixture";

for (const [locale, heading] of [["en", "Start with a company."], ["zh-cn", "从一家公司开始。"]]) {
  test(`${locale} homepage waits for a research action before loading data`, async ({ page }) => {
    const researchRequests: string[] = [];
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (/^\/api\/(intelligence|knowledge-graph|investment-themes|tickers\/search)/.test(path)) {
        researchRequests.push(path);
      }
    });
    await page.goto(`/${locale}?utm_source=homepage-test`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await page.waitForTimeout(2000);
    expect(researchRequests).toEqual([]);
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("link").first()).toHaveAttribute("href", new RegExp("^/auth\\?next="));
    await expect(page.getByRole("main").getByRole("searchbox")).toBeVisible();
    await expect(page.getByRole("img", {name: /Illustrative|示意对比/})).toBeVisible();
  });
}
