import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let script = "";
test.beforeAll(async () => {
  const result = await build({ stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import AdminLayout from "./src/app/admin/layout"; createRoot(document.getElementById("root")).render(<AdminLayout><button>Private admin tool</button></AdminLayout>);', resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", define: { "process.env": "{}" }, alias: { "@/components/providers/auth-provider": path.resolve("tests/conversion/fixtures/mocks.tsx") } });
  script = result.outputFiles[0].text.replaceAll("</script", "<\\/script");
});

for (const scenario of ["anonymous", "member", "admin", "error"] as const) {
  test(`admin pages restrict access for ${scenario}`, async ({ page }) => {
    let checks = 0;
    await page.route("**/*", async route => {
      if (route.request().url().includes("/api/admin/me")) {
        checks++;
        expect(route.request().headers().authorization).toBe("Bearer isolated-test-token");
        return route.fulfill({ status: scenario === "error" ? 500 : 200, json: { isAdmin: scenario === "admin" } });
      }
      return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>window.authScenario={signedIn:${scenario !== "anonymous"}};${script}</script>` });
    });
    await page.goto("http://localhost/admin");
    if (scenario === "admin") {
      await expect(page.getByRole("button", { name: "Private admin tool" })).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("test-auth-user", { detail: null })));
    }
    await expect(page.getByRole("alert")).toContainText("administrators only");
    await expect(page.getByRole("button", { name: "Private admin tool" })).toHaveCount(0);
    expect(checks).toBe(scenario === "anonymous" ? 0 : 1);
  });
}
