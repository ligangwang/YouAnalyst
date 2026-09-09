import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let html = "";
test.beforeAll(async () => {
  const result = await build({ stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {AdminIndustryResearch} from "./src/components/admin-industry-research"; createRoot(document.getElementById("root")).render(<AdminIndustryResearch/>);', resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", define: { "process.env": "{}" }, alias: { "@/components/providers/auth-provider": path.resolve("tests/conversion/fixtures/mocks.tsx") } });
  html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script>window.authScenario={signedIn:true};${result.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});
test("admin researches once and publishes only explicitly selected draft connections", async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  const run = { id: "00000000-0000-4000-8000-000000000001", industry: "Semiconductors", status: "DRAFT", model: "gpt-5.4", createdAt: "2026-09-09", result: {
    companies: [{ ticker: "TSM", name: "TSMC" }, { ticker: "AMD", name: "AMD" }], withheld: 0,
    relationships: [{ id: "TSM__SUPPLIER_OF__AMD", source: "TSM", target: "AMD", type: "SUPPLIER_OF", evidence: [{ url: "https://www.example.com/source", title: "Company announcement", summary: "Synthetic research.", sourceDate: null }] }],
  } };
  await page.route("**/*", route => {
    const request = route.request();
    if (request.url().includes("/api/admin/industry-research")) {
      if (request.method() === "GET") return route.fulfill({ json: { items: [] } });
      requests.push(request.postDataJSON());
      return route.fulfill({ json: { item: { ...run, status: requests.at(-1)?.action === "publish" ? "PUBLISHED" : "DRAFT" } } });
    }
    if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    return route.abort();
  });
  await page.goto("http://localhost/research-fixture");
  await page.getByRole("button", { name: "Research industry", exact: true }).click();
  await expect(page.getByRole("link", { name: "Company announcement" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish 0 reviewed connections" })).toBeDisabled();
  expect(requests).toHaveLength(1);
  await page.getByRole("checkbox", { name: "Approve TSM supplies AMD" }).check();
  await page.getByRole("button", { name: "Publish 1 reviewed connections" }).click();
  expect(requests[1]).toMatchObject({ action: "publish", selectedIds: ["TSM__SUPPLIER_OF__AMD"] });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-auth-user", { detail: null })));
  await expect(page.getByRole("link", { name: "Company announcement" })).toHaveCount(0);
});
