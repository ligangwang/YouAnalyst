import {expect, test, type Page} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';

let html: string;
const origin = 'http://search-startup.test';
test.beforeAll(async () => {
  const mock = path.resolve('tests/conversion/fixtures/mocks.tsx');
  const bundle = await build({stdin: {contents: `
    import React, {useEffect, useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {CompanySearch} from './src/components/company-search';
    import CompanyGraph3D from './src/components/company-graph-3d';
    import {LocaleProvider} from './src/components/providers/locale-provider';
    const graph={nodes:Array.from({length:600},(_,i)=>({id:'US:TEST'+i,kind:'COMPANY',name:'Test Company '+i,symbol:'TEST'+i,market:'US',stageIds:['compute']})),relationships:[]};
    function App(){
      const [loaded,setLoaded]=useState(location.search.includes('eager'));
      const [searchEnabled,setSearchEnabled]=useState(true);
      useEffect(()=>{const load=()=>setLoaded(true),disable=()=>setSearchEnabled(false);window.addEventListener('load-graph',load);window.addEventListener('disable-search',disable);return()=>{window.removeEventListener('load-graph',load);window.removeEventListener('disable-search',disable);};},[]);
      return <LocaleProvider locale="en"><CompanySearch enabled={searchEnabled}/><div style={{height:600}}>{loaded&&<CompanyGraph3D graph={graph} selected="" onSelect={()=>{}} reset={0} cameraRequest={0} onReset={()=>{}}/>}</div></LocaleProvider>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `, resolveDir: process.cwd(), loader:'tsx'}, bundle:true,write:false,outfile:'fixture.js',platform:'browser',define:{'process.env':'{}'},alias:{'next/navigation':mock,'next/link':mock,'@/components/providers/auth-provider':mock}});
  html=`<!doctype html><html><head><style>body{margin:0}${bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text??''}</style></head><body><div id="root"></div><script>${bundle.outputFiles.find(f=>f.path.endsWith('.js'))!.text.replaceAll('</script','<\\/script')}</script></body></html>`;
});

async function open(page: Page, eager=false){
  await page.addInitScript(()=>{
    const counts={contexts:0,draws:0};Object.assign(window,{renderCounts:counts});
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(this: HTMLCanvasElement, ...args: Parameters<typeof get>){
      const context=get.apply(this,args);
      if(String(args[0]).startsWith('webgl')&&context){
        counts.contexts++;
        const gl=context as WebGL2RenderingContext;
        for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'] as const){
          const draw=gl[name].bind(gl) as (...values: number[])=>void;
          Object.assign(gl,{[name]:(...values:number[])=>{counts.draws++;return draw(...values);}});
        }
      }
      return context;
    } as typeof get;
  });
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/tickers/search'){
      await new Promise(resolve=>setTimeout(resolve,80));
      return route.fulfill({json:{total:600,items:url.searchParams.has('q')?[{id:'US:MU',symbol:'MU',name:'Micron Technology',kind:'ticker',supportState:'SUPPORTED'}]:[]}});
    }
    return route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto(origin+(eager?'/?eager=1':'/'));
}
const counts=(page:Page)=>page.evaluate(()=> (window as unknown as {renderCounts:{contexts:number;draws:number}}).renderCounts);
const search=(page:Page)=>page.getByRole('combobox',{name:'Search company',exact:true});

test('fresh search defers a late graph and shows suggestions before WebGL initialization',async({page})=>{
  test.setTimeout(60000);
  await open(page);
  await page.getByRole('button',{name:'Search company',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('load-graph')));
  await expect(page.getByText('Loading graph…',{exact:true})).toBeVisible();
  const start=Date.now();await search(page).fill('mu');
  await expect(page.getByRole('option',{name:/Micron/})).toBeVisible({timeout:1500});
  expect(Date.now()-start).toBeLessThan(1500);
  expect((await counts(page)).contexts).toBe(0);
  await search(page).press('Escape');
  await expect(page.locator('canvas')).toBeVisible({timeout:30000});
  await expect.poll(async()=> (await counts(page)).draws,{timeout:30000}).toBeGreaterThan(0);
});

test('search pauses a mounted graph and resumes the same canvas after dismissal',async({page})=>{
  test.setTimeout(60000);await open(page,true);
  await expect.poll(async()=> (await counts(page)).draws,{timeout:30000}).toBeGreaterThan(0);
  await page.locator('canvas').evaluate(canvas=>canvas.setAttribute('data-original-canvas','true'));
  await page.getByRole('button',{name:'Search company',exact:true}).click();
  await search(page).fill('mu');await expect(page.getByRole('option',{name:/Micron/})).toBeVisible();
  const paused=await counts(page);await page.waitForTimeout(300);
  expect(await counts(page)).toEqual(paused);
  await search(page).press('Escape');
  await expect.poll(async()=> (await counts(page)).draws,{timeout:10000}).toBeGreaterThan(paused.draws);
  await expect(page.locator('canvas')).toHaveAttribute('data-original-canvas','true');
});

test('disabling an open search releases deferred graph initialization',async({page})=>{
  test.setTimeout(60000);await open(page);
  await page.getByRole('button',{name:'Search company',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('load-graph')));
  await expect(page.getByText('Loading graph…',{exact:true})).toBeVisible();
  expect((await counts(page)).contexts).toBe(0);
  await page.evaluate(()=>window.dispatchEvent(new Event('disable-search')));
  await expect(search(page)).toHaveCount(0);
  await expect.poll(async()=> (await counts(page)).draws,{timeout:30000}).toBeGreaterThan(0);
});
