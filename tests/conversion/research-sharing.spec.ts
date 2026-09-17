import { test, expect } from "@playwright/test";
import { build } from "esbuild";
let html = "";
test.beforeAll(async()=>{
  const bundle = await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";import {ShareResearchView} from "./src/components/research-actions";import {LocaleProvider} from "./src/components/providers/locale-provider";createRoot(document.getElementById("root")).render(<LocaleProvider locale={location.pathname.startsWith("/zh-cn")?"zh-CN":"en"}><ShareResearchView/></LocaleProvider>);`,loader:"tsx",resolveDir:process.cwd()},bundle:true,write:false,outfile:"share.js",platform:"browser",define:{"process.env":"{}"}});
  html=`<html><head><meta name="youanalyst-analytics" content="disabled"></head><body><div id="root"></div><script>${bundle.outputFiles.find(f=>f.path.endsWith(".js"))!.text}</script></body></html>`;
});
test("sharing retains research context but drops campaign and private parameters",async({page})=>{
  await page.route("**/*",r=>r.fulfill({contentType:"text/html",body:html}));
  await page.addInitScript(()=>Object.defineProperty(navigator,"clipboard",{value:{writeText:async(value:string)=>{document.body.dataset.copied=value;}}}));
  await page.goto("http://research.test/en/research/amd-ai-ecosystem?product=EPYC&relation=integration&company=US%3AAMZN&utm_source=test&token=private");
  await page.getByRole("button",{name:"Share this view"}).click();
  await expect(page.getByRole("status")).toHaveText("Link copied");
  const url = new URL((await page.locator("body").getAttribute("data-copied"))!);
  expect(Object.fromEntries(url.searchParams)).toEqual({product:"EPYC",relation:"integration",company:"US:AMZN"});
});
test("Chinese sharing has a selectable fallback when clipboard access fails",async({page})=>{
  await page.route("**/*",r=>r.fulfill({contentType:"text/html",body:html}));
  await page.addInitScript(()=>Object.defineProperty(navigator,"clipboard",{value:{writeText:async()=>{throw new Error("denied");}}}));
  await page.goto("http://research.test/zh-cn/research/amd-ai-ecosystem?product=Helios");
  await page.getByRole("button",{name:"分享当前视图"}).click();
  await expect(page.getByRole("textbox",{name:"分享链接"})).toHaveValue("http://research.test/zh-cn/research/amd-ai-ecosystem?product=Helios");
  await expect(page.getByRole("status")).toHaveText("请复制此链接");
});
