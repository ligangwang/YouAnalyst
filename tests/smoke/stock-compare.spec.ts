import { expect, test, type Page } from "@playwright/test";

async function mockPrices(page: Page) {
  await page.route("**/api/compare?*", async route => {
    const params = new URL(route.request().url()).searchParams;
    const symbols = params.get("symbols")!.split(",");
    await route.fulfill({ json: { dates: ["2025-01-02","2025-02-03","2025-03-03","2025-04-01","2025-05-01","2025-06-02"], frequency: "Daily", source: "Test fixture",
      series: symbols.map((symbol,i) => ({ symbol, values: [0, 5-i*3, 10-i*4, -12+i*7, 8-i*3, 20-i*5] })) } });
  });
  await page.route("**/api/tickers/search?*", route => route.fulfill({ json: { items: [] } }));
}
const query="symbols=AAPL,MSFT,NVDA,GOOGL,AMZN&start=2025-01-01&end=2025-12-31&style=line";
test("comparison exports a watermarked video without a server encoding request", async ({ page }) => {
  await mockPrices(page);
  await page.goto('/en/compare?' + query);
  const exporter = page.getByRole('region', { name: 'Export comparison video' });
  await expect(exporter).toContainText('YouAnalyst watermark.');
  await exporter.getByLabel('Video duration').selectOption('10');
  const download = page.waitForEvent('download');
  await exporter.getByRole('button', { name: 'Export video', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^YouAnalyst-line-2025-01-02-2025-06-02\.(mp4|webm)$/);
  await expect(exporter.getByRole('status')).toContainText('Video ready.');
});
test("public comparison plays, scrubs, switches style, and shares its configuration", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read","clipboard-write"]);
  await mockPrices(page);
  await page.goto("/en/compare?"+query);
  await expect(page.getByRole("heading",{name:"Stock performance playback",exact:true})).toHaveClass("sr-only");
  await expect(page.getByTestId("comparison-date")).toHaveText("2025-06-02");
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button",{name:"Play animation",exact:true}).click();
  await expect(page.getByRole("button",{name:"Pause animation",exact:true})).toBeVisible();
  await expect(page.getByTestId("comparison-date")).toHaveText("2025-01-02");
  await page.getByRole("button",{name:"Pause animation",exact:true}).click();
  await page.getByRole("slider",{name:"Comparison timeline"}).fill("0.5");
  await expect(page.getByTestId("comparison-date")).toHaveText("2025-03-03");
  await expect(page.getByRole("row").filter({ hasText: "AAPL" }).locator("td").last()).toHaveText("+10.00%");
  await expect(page.getByTestId("chart-watermark")).toBeVisible();
  await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
  await page.screenshot({path:"test-results/compare-desktop.png",fullPage:true});
  await page.getByRole("button",{name:"Bar",exact:true}).click();
  await expect(page.getByRole("button",{name:"Bar",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("button",{name:"Copy link",exact:true}).click();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  const shared=new URL(copied);
  expect(shared.searchParams.get("style")).toBe("bar");
  expect(shared.searchParams.get("symbols")).toBe("AAPL,MSFT,NVDA,GOOGL,AMZN");
  expect(shared.searchParams.get("start")).toBe("2025-01-01");
  const xLink=new URL((await page.getByRole("link",{name:"Post to X"}).getAttribute("href"))!);
  expect(new URL(xLink.searchParams.get("url")!).searchParams.get("style")).toBe("bar");
  await page.goto(copied);
  await expect(page.getByRole("button",{name:"Bar",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByTestId("comparison-date")).toHaveText("2025-06-02");
});
test("ten stocks fit on mobile, enforce the limit, and can be removed", async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await mockPrices(page);
  const symbols="AAPL,MSFT,NVDA,GOOGL,AMZN,META,TSLA,AMD,AVGO,INTC";
  await page.goto("/en/compare?"+query.replace("AAPL,MSFT,NVDA,GOOGL,AMZN",symbols));
  await expect(page.getByRole("table")).toBeVisible();
  await page.route("**/api/tickers/search?*", route => route.fulfill({ json: { total: 178, items: [{ id: "IBM", symbol: "IBM", name: "IBM", market: "US" }] } }));
  await page.getByRole("button",{name:"Selected stocks",exact:true}).click();
  await page.locator('main').getByRole("combobox",{name:"Search company",exact:true}).fill("IBM");
  await page.getByRole("option",{name:/IBM/}).click();
  await expect(page.getByRole("status").filter({hasText:"You can compare up to 10 stocks."})).toBeVisible();
  await expect(page.getByRole("button",{name:"Remove IBM",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Bar",exact:true}).click();
  await expect(page.locator("canvas")).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
  await page.screenshot({path:"test-results/compare-mobile.png",fullPage:true});
  await page.getByRole("button",{name:"Remove INTC",exact:true}).click();
  await page.getByRole("button",{name:"Compare",exact:true}).click();
  await expect(page.getByRole("row")).toHaveCount(10);
});
test("coverage failures can be retried and no chart is fabricated", async ({ page }) => {
  await page.route("**/api/compare?*",route=>route.fulfill({status:503,json:{error:"Not enough stored price history for NVDA in this period."}}));
  await page.goto("/en/compare?"+query);
  await expect(page.locator("main").getByRole("alert")).toContainText("Not enough stored price history");
  await expect(page.getByRole("button",{name:"Share",exact:true})).toBeDisabled();
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.unroute("**/api/compare?*");
  await mockPrices(page);
  await page.getByRole("button",{name:"Retry",exact:true}).click();
  await expect(page.getByRole("table")).toBeVisible();
});
test("comparison API rejects oversized selections and invalid dates before reading prices",async({request})=>{
  const tooMany=await request.get("/api/compare?symbols=A,B,C,D,E,F,G,H,I,J,K&start=2025-01-01&end=2025-12-31");
  expect(tooMany.status()).toBe(400);
  const invalid=await request.get("/api/compare?symbols=AAPL&start=2025-02-30&end=2025-12-31");
  expect(invalid.status()).toBe(400);
  const image=await request.get("/api/compare/share-image?"+query);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/png");
});
test("default selection is five stocks and works without signing in",async({page})=>{
  await mockPrices(page);
  const request=page.waitForRequest(request=>new URL(request.url()).pathname==="/api/compare");
  await page.goto("/en/compare");
  const params=new URL((await request).url()).searchParams;
  expect(params.get("symbols")).toBe("AAPL,MSFT,NVDA,GOOGL,AMZN");
  await expect(page.getByRole("button",{name:"Line",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByRole("table")).toBeVisible();
});
test("a browser without WebGL still shows readable returns",async({page})=>{
  await page.addInitScript(`const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      return type==='webgl'||type==='webgl2'?null:original.call(this,type,...args);
    };`);
  await mockPrices(page);
  await page.goto("/en/compare?"+query);
  await expect(page.getByText("Animation is unavailable in this browser. Returns are shown in the table below.")).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
});

test("Chinese listings can be found and selected through the comparison picker", async ({ page }) => {
  await mockPrices(page);
  await page.route("**/api/tickers/search?*", route => route.fulfill({ json: { total: 178, items: [{ id: "XSHG:600519", symbol: "600519", name: "贵州茅台", exchange: "SSE", micCode: "XSHG", type: "Common Stock", market: "CN_A" }] } }));
  await page.goto("/en/compare?" + query);
  const search = page.waitForRequest(request => new URL(request.url()).pathname === "/api/tickers/search" && new URL(request.url()).searchParams.has("q"));
  await page.getByRole("button",{name:"Selected stocks",exact:true}).click();
  await page.locator('main').getByRole("combobox", { name: "Search company", exact: true }).fill("茅台");
  expect(new URL((await search).url()).searchParams.get("scope")).toBe("covered");
  await page.getByRole("option", { name: /贵州茅台/ }).click();
  await expect(page.getByRole("button", { name: "Remove XSHG:600519", exact: true })).toBeVisible();
  await expect(page.locator('main').getByText("178 companies covered · More coming soon", {exact:true})).toBeVisible();
});

test("copied widget works inside a foreign website with its theme, watermark and playback", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write", "local-network-access"]);
  await mockPrices(page);
  await page.goto("/en/compare?" + query);
  await page.getByRole("button", { name: "Embed", exact: true }).click();
  await page.getByLabel("Widget theme", { exact: true }).selectOption("light");
  await page.getByRole("button", { name: "Copy embed code", exact: true }).click();
  const code = await page.evaluate(() => navigator.clipboard.readText());
  expect(code).toContain("&amp;theme=light");
  // Use a different origin and grant test-only loopback access for Chromium's
  // local-network checks; production embeds use the public YouAnalyst origin.
  const publisher = "http://localhost:3018/comparison";
  await page.route(publisher, route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body style="margin:0"><div style="width:390px;max-width:100%">${code}</div></body></html>` }));
  await page.goto(publisher);
  const widget = page.frameLocator("iframe");
  await expect(widget.getByTestId("chart-watermark")).toBeVisible();
  await expect(widget.locator("[data-embed-theme]")).toHaveAttribute("data-embed-theme", "light");
  await expect(widget.getByRole("navigation")).toHaveCount(0);
  await expect(widget.getByLabel("Edit comparison", { exact: true })).toHaveCount(0);
  await expect(widget.getByTestId("comparison-date")).toHaveText("2025-06-02");
  await widget.getByRole("button", { name: "Play animation", exact: true }).click();
  await expect(widget.getByRole("button", { name: "Pause animation", exact: true })).toBeVisible();
  await widget.getByRole("button", { name: "Pause animation", exact: true }).click();
  await widget.getByRole("slider", { name: "Comparison timeline" }).fill("0.59");
  await expect(widget.getByTestId("comparison-date")).toHaveText("2025-03-03");
  await widget.getByRole("button", { name: "Bar", exact: true }).click();
  await expect(widget.getByTestId("chart-watermark")).toBeVisible();
  await expect(widget.getByRole("link", { name: "Open in YouAnalyst" })).toHaveAttribute("href", /\/en\/compare\?.*style=bar/);
  await widget.getByText("View returns table", { exact: true }).click();
  await expect(widget.getByRole("row").filter({ hasText: "AAPL" }).locator("td").last()).toHaveText("+10.00%");
  expect(await widget.locator("html").evaluate(element => element.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator("iframe").screenshot({ path: "test-results/compare-widget-light.png" });
});

test("a narrow dark ten-stock widget has a readable fallback without WebGL", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 1100 });
  await page.addInitScript(`const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){
      return type==='webgl'||type==='webgl2'?null:original.call(this,type,...args);
    };`);
  await mockPrices(page);
  const symbols = "AAPL,MSFT,NVDA,GOOGL,AMZN,META,TSLA,AMD,AVGO,INTC";
  await page.goto("/zh-cn/compare/embed?" + query.replace("AAPL,MSFT,NVDA,GOOGL,AMZN", symbols).replace("style=line", "style=bar") + "&theme=dark");
  await expect(page.locator("[data-embed-theme]")).toHaveAttribute("data-embed-theme", "dark");
  await expect(page.getByTestId("chart-watermark")).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(11);
  await expect(page.getByRole("link", { name: "在 YouAnalyst 中打开" })).toHaveAttribute("href", /\/zh-cn\/compare\?/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
