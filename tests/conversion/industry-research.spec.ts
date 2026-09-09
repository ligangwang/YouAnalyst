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
  await expect(page.getByRole("combobox", { name: "Sector", exact: true })).toHaveValue("45");
  await expect(page.getByRole("combobox", { name: "Industry", exact: true })).toHaveValue("453010");
  await page.getByRole("button", { name: "Research industry", exact: true }).click();
  await expect(page.getByRole("link", { name: "Company announcement" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish 0 reviewed connections" })).toBeDisabled();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ category: { sectorCode: "45", industryCode: "453010" }, industry: "AI data-center supply chain" });
  await page.getByRole("checkbox", { name: "Approve TSM supplies AMD" }).check();
  await page.getByRole("button", { name: "Publish 1 reviewed connections" }).click();
  expect(requests[1]).toMatchObject({ action: "publish", selectedIds: ["TSM__SUPPLIER_OF__AMD"] });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-auth-user", { detail: null })));
  await expect(page.getByRole("link", { name: "Company announcement" })).toHaveCount(0);
});

test("sector changes reset industry and scope; custom topics remain available", async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await page.route("**/*", route => {
    if (route.request().url().includes("/api/admin/industry-research")) {
      if (route.request().method() === "GET") return route.fulfill({ json: { items: [] } });
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: { item: { id: "test", industry: "Topic", status: "PROCESSING", createdAt: "2026-09-09" } } });
    }
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
    return route.abort();
  });
  await page.goto("http://localhost/research-fixture");
  await page.getByRole("combobox", { name: "Sector", exact: true }).selectOption("35");
  await expect(page.getByRole("combobox", { name: "Industry", exact: true })).toHaveValue("351010");
  await expect(page.getByLabel("Research scope (optional)")).toHaveValue("");
  await page.getByRole("combobox", { name: "Industry", exact: true }).selectOption("352020");
  await page.getByRole("button", { name: "Research industry", exact: true }).click();
  expect(requests[0]).toMatchObject({ category: { sectorCode: "35", industryCode: "352020" }, industry: "" });
  await page.getByRole("combobox", { name: "Sector", exact: true }).selectOption("custom");
  await expect(page.getByRole("combobox", { name: "Industry", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Research industry", exact: true })).toBeDisabled();
  await page.getByLabel("Custom research topic").fill("AI in healthcare and cloud");
  await page.getByRole("button", { name: "Research industry", exact: true }).click();
  expect(requests[1]).toMatchObject({ category: null, industry: "AI in healthcare and cloud" });
});

test("recent sector filter keeps legacy runs and hides unrelated drafts", async ({ page }) => {
  const items = [
    { id: "legacy", industry: "Old custom batch", status: "FAILED", createdAt: "2026-09-08" },
    { id: "health", industry: "Pharmaceuticals", status: "DRAFT", createdAt: "2026-09-09", topic: { sectorCode: "35", sectorName: "Health Care", industryName: "Pharmaceuticals" } },
  ];
  await page.route("**/*", route => route.request().url().includes("/api/admin/industry-research")
    ? route.fulfill({ json: { items } })
    : route.request().isNavigationRequest() ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
  await page.goto("http://localhost/research-fixture");
  await page.getByLabel("Recent runs by sector").selectOption("35");
  await expect(page.getByRole("combobox", { name: "Research run", exact: true }).locator("option")).toHaveCount(2);
  await page.getByRole("combobox", { name: "Research run", exact: true }).selectOption("health");
  await expect(page.getByText("Health Care / Pharmaceuticals", { exact: true })).toBeVisible();
  await page.getByLabel("Recent runs by sector").selectOption("custom");
  await expect(page.getByText("Health Care / Pharmaceuticals", { exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Research run", exact: true }).selectOption("legacy");
  await expect(page.getByText("FAILED", { exact: true })).toBeVisible();
});
