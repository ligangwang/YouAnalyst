import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let html: string;
test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `
      import React from "react";
      import {createRoot} from "react-dom/client";
      import Page from "./src/app/my/predictions/page";
      import {LocaleProvider} from "./src/components/providers/locale-provider";
      createRoot(document.getElementById("root")).render(<LocaleProvider locale={location.pathname.startsWith("/zh-cn")?"zh-CN":"en"}><Page/></LocaleProvider>);
    `, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, write: false, platform: "browser", define: { "process.env": "{}" },
    alias: { "@/components/providers/auth-provider": path.resolve("tests/conversion/fixtures/mocks.tsx") },
    plugins: [{ name: "profile-navigation", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "const router={replace:href=>location.replace(href)};export function useRouter(){return router;}", loader: "js" }));
    } }],
  });
  html = `<div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script>`;
});

for (const prefix of ["en", "zh-cn"]) for (const signedIn of [false, true]) {
  test(`retired My views opens ${signedIn ? "profile history" : "sign-in continuation"} (${prefix})`, async ({ page }) => {
    await page.addInitScript(signedIn => { window.authScenario = { signedIn }; }, signedIn);
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: new URL(route.request().url()).pathname.endsWith("/my/predictions") ? html : "<h1>Destination</h1>" }));
    await page.goto(`http://profile-redirect.test/${prefix}/my/predictions`);
    if (signedIn) {
      await expect(page).toHaveURL(`http://profile-redirect.test/${prefix}/analysts/test-user#profile-views`);
    } else {
      await expect(page).toHaveURL(/\/auth\?next=/);
      expect(new URL(page.url()).searchParams.get("next")).toBe(`/${prefix}/my/predictions`);
    }
  });
}
