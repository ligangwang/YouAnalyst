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

async function expectFastSearch(page: Page, query: string) {
  // Measure in the page, not Playwright round trips while software WebGL runs.
  await search(page).evaluate((input, query) => {
    const start = performance.now();
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[data-company-search] [role="option"]')) return;
      Object.assign(window, {suggestionMs:performance.now()-start});observer.disconnect();
    });
    observer.observe(document.body, {childList:true,subtree:true});
    Object.assign(window, {suggestionMs:null});
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, query);input.dispatchEvent(new Event('input', {bubbles:true}));
  }, query);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {suggestionMs:number|null}).suggestionMs),{timeout:10000}).not.toBeNull();
  const elapsed = await page.evaluate(()=>(window as unknown as {suggestionMs:number}).suggestionMs);
  await test.info().attach(`suggestions-${query}`, {body:JSON.stringify({query,elapsedMs:elapsed}),contentType:'application/json'});
  expect(elapsed).toBeLessThan(1500);
  await expect(page.getByRole('option',{name:/Micron/})).toBeVisible();
}

for (const eager of [false,true]) test(`search stays responsive while graph ${eager?'is already orbiting':'initializes'}`,async({page})=>{
  test.setTimeout(60000);
  await open(page,eager);
  if(eager)await expect.poll(async()=>(await counts(page)).draws,{timeout:30000}).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Search company',exact:true}).click();
  if(!eager)await page.evaluate(()=>window.dispatchEvent(new Event('load-graph')));
  await expectFastSearch(page,'mu');
  // Search remains focused while initialization, labels and the orbit continue.
  await expect(search(page)).toBeFocused();
  await expect.poll(async()=>(await counts(page)).draws,{timeout:30000}).toBeGreaterThan(0);
  const canvas=page.locator('canvas');
  const before=await counts(page);
  const position=await canvas.getAttribute('data-camera-position');
  await expect.poll(async()=>(await counts(page)).draws).toBeGreaterThan(before.draws);
  await expect.poll(()=>canvas.getAttribute('data-camera-position')).not.toBe(position);
  await expect(page.locator('[data-company-id][data-visible="true"]')).toHaveCount(0);
  await search(page).fill('');
  await expect(page.getByRole('option')).toHaveCount(0);
  await expectFastSearch(page,'nv');
});

test('graph animation never synchronously measures label dimensions',async({page})=>{
  test.setTimeout(60000);
  await page.addInitScript(()=>{
    Object.assign(window,{labelLayoutReads:0});
    for(const name of ['offsetWidth','offsetHeight'] as const){
      const descriptor=Object.getOwnPropertyDescriptor(HTMLElement.prototype,name)!;
      Object.defineProperty(HTMLElement.prototype,name,{...descriptor,get(){
        if(this.matches('[data-company-id],[data-relationship-id]'))(window as unknown as {labelLayoutReads:number}).labelLayoutReads++;
        return descriptor.get!.call(this);
      }});
    }
  });
  await open(page,true);
  await expect(page.locator('[data-company-id]').first()).toBeAttached({timeout:30000});
  await page.locator('[data-company-id]').first().dispatchEvent('pointerover',{pointerType:'mouse'});
  await expect(page.locator('[data-company-id][data-visible="true"]').first()).toBeVisible();
  const before=await counts(page);
  await expect.poll(async()=>(await counts(page)).draws).toBeGreaterThan(before.draws+20);
  expect(await page.evaluate(()=>(window as unknown as {labelLayoutReads:number}).labelLayoutReads)).toBe(0);
});
