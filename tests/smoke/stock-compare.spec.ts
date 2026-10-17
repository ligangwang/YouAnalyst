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
test("public comparison plays, scrubs, switches style, and shares its configuration", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read","clipboard-write"]);
  await mockPrices(page);
  await page.goto("/en/compare?"+query);
  await expect(page.getByRole("heading",{name:"Compare stocks",exact:true})).toBeVisible();
  await expect(page.getByTestId("comparison-date")).toHaveText("2025-06-02");
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button",{name:"Play animation",exact:true}).click();
  await expect(page.getByRole("button",{name:"Pause animation",exact:true})).toBeVisible();
  await expect(page.getByTestId("comparison-date")).toHaveText("2025-01-02");
  await page.getByRole("button",{name:"Pause animation",exact:true}).click();
  await page.getByRole("slider",{name:"Comparison timeline"}).fill("0.5");
  await expect(page.getByTestId("comparison-date")).toHaveText("2025-03-03");
  await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
  await page.screenshot({path:"test-results/compare-desktop.png",fullPage:true});
  await page.getByRole("button",{name:"Bar race",exact:true}).click();
  await expect(page.getByRole("button",{name:"Bar race",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.getByRole("button",{name:"Copy link",exact:true}).click();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  const shared=new URL(copied);
  expect(shared.searchParams.get("style")).toBe("bar");
  expect(shared.searchParams.get("symbols")).toBe("AAPL,MSFT,NVDA,GOOGL,AMZN");
  expect(shared.searchParams.get("start")).toBe("2025-01-01");
  const xLink=new URL((await page.getByRole("link",{name:"Post to X"}).getAttribute("href"))!);
  expect(new URL(xLink.searchParams.get("url")!).searchParams.get("style")).toBe("bar");
  await page.goto(copied);
  await expect(page.getByRole("button",{name:"Bar race",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(page.getByTestId("comparison-date")).toHaveText("2025-06-02");
});
test("ten stocks fit on mobile, enforce the limit, and can be removed", async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await mockPrices(page);
  const symbols="AAPL,MSFT,NVDA,GOOGL,AMZN,META,TSLA,AMD,AVGO,INTC";
  await page.goto("/en/compare?"+query.replace("AAPL,MSFT,NVDA,GOOGL,AMZN",symbols));
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByLabel("Add a stock",{exact:true}).fill("IBM");
  await expect(page.getByRole("button",{name:"Add",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"Bar race",exact:true}).click();
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
  await expect(page.getByRole("button",{name:"Line race",exact:true})).toHaveAttribute("aria-pressed","true");
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
