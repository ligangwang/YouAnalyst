import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const origin = "http://research-topics.test";
let html: string;
test.beforeAll(async () => {
  const mock = path.resolve("tests/conversion/fixtures/mocks.tsx");
  const bundle = await build({ stdin: { contents: `
    import {createRoot} from "react-dom/client";
    import {InfrastructureResearchPage} from "./src/components/infrastructure-research-page";
    import {infrastructureTopics} from "./src/lib/research/infrastructure-topics";
    import {LocaleProvider} from "./src/components/providers/locale-provider";
    const chinese=location.pathname.startsWith("/zh-cn/");
    const topic=infrastructureTopics.find(topic=>location.pathname.endsWith(topic.slug));
    createRoot(document.getElementById("root")).render(<LocaleProvider locale={chinese?"zh-CN":"en"}>{topic?<InfrastructureResearchPage topic={topic} chinese={chinese}/>:<p>Authentication destination</p>}</LocaleProvider>);
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, outfile: "topics.js", platform: "browser", define: { "process.env": "{}" }, alias: { "@/components/providers/auth-provider": mock, "next/navigation": mock, "next/link": mock } });
  const css = await postcss([tailwind()]).process('@import "tailwindcss";', { from: path.resolve("topics-test.css") });
  html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="youanalyst-analytics" content="disabled"><style>${css.css}${bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? ""}body{background:#07111d;color:#f8fafc;font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script>${bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text.replaceAll("</script", "<\\/script")}</script></body></html>`;
});
test.beforeEach(async ({page}) => {
  page.on("pageerror", error => { throw error; });
  await page.route("**/*", route => {
    const request=route.request(),url=new URL(request.url());
    if(url.origin !== origin || request.method() !== "GET") return route.abort();
    if(request.isNavigationRequest())return route.fulfill({contentType:"text/html",body:html});
    return route.fulfill({json:{companyIds:[]}});
  });
});
for(const prefix of ["en","zh-cn"])for(const slug of ["hbm-supply","ai-infrastructure-bottlenecks"]){
  test(`${prefix} ${slug} exposes evidence limits and readable next steps`,async({page},info)=>{
    await page.goto(`${origin}/${prefix}/research/${slug}`);
    await expect(page.getByRole("heading",{level:1})).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(4);
    await expect(page.getByText(prefix === "en" ? "Evidence limit:" : "证据边界：",{exact:true})).toHaveCount(4);
    await expect(page.getByRole("link",{name:prefix === "en" ? "Follow companies and track sourced updates" : "关注公司，追踪有来源的更新",exact:true})).toHaveAttribute("href",`/${prefix}/feed?scope=following`);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`${slug}-${prefix}.png`),fullPage:true});
  });
}
test("HBM evidence keeps samples separate and a follow preserves the exact article anchor",async({page})=>{
  const destination="/en/research/hbm-supply#samsung-hbm4e";
  await page.goto(origin+destination);
  const card=page.locator("#samsung-hbm4e");
  await expect(card).toContainText("Sample shipments; production planned");
  await expect(card.getByRole("link",{name:"Samsung · HBM4E sample shipments ↗",exact:true})).toHaveAttribute("href","https://news.samsung.com/uk/samsung-begins-shipment-of-industry-first-hbm4e-samples");
  await card.getByRole("button",{name:"＋ Follow",exact:true}).click();
  const url=new URL(page.url());
  expect(url.pathname).toBe("/auth");
  expect(url.searchParams.get("next")).toBe("/en/research/hbm-supply?followCompany=ORG%3ASAMSUNG-ELECTRONICS#samsung-hbm4e");
});
