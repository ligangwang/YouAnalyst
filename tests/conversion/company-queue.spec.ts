import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

test("company queue processes pending identities, shows sources and requires review before publication", async ({ page }) => {
  const result = await build({ stdin: { contents: 'import React from "react";import {createRoot} from "react-dom/client";import {AdminCompanyResearch} from "./src/components/admin-company-research";createRoot(document.getElementById("root")).render(<AdminCompanyResearch/>);', loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", define: { "process.env": "{}" }, alias: { "@/components/providers/auth-provider": path.resolve("tests/conversion/fixtures/mocks.tsx") } });
  const calls: Record<string, unknown>[] = [];
  await page.route("**/*", route => {
    const request = route.request();
    if (request.url().includes("/api/admin/company-research")) {
      if (request.method() === "POST") { calls.push(request.postDataJSON()); return route.fulfill({ json: { ok: true, started: 1 } }); }
      const status = new URL(request.url()).searchParams.get("status");
      return route.fulfill({ json: { sync: { count: 5201, snapshot: "2026-6" }, nextCursor: null, candidates: [{ id: "XSHG:688041", name: "海光信息", status, attempts: 1, ...(status === "DRAFT" ? { profile: { description: "公司业务说明", source: "https://example.com/report", sourceLabel: "公司报告" } } : {}) }] } });
    }
    return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>window.authScenario={signedIn:true};${result.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script>` });
  });
  await page.goto("http://localhost/queue");
  await expect(page.getByText("5201 companies · CNI snapshot 2026-6")).toBeVisible();
  await page.getByRole("button", { name: "Process up to 5 pending companies" }).click();
  await expect(page.getByRole("combobox")).toHaveValue("RESEARCHING");
  expect(calls[0]).toMatchObject({ action: "process" });
  await page.getByRole("combobox").selectOption("DRAFT");
  await expect(page.getByRole("link", { name: "公司报告" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish company", exact: true })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Publish company", exact: true }).click();
  expect(calls.at(-1)).toMatchObject({ action: "publish", id: "XSHG:688041" });
});
