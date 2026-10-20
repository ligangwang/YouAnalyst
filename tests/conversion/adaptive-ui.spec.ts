import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import us from '../../data/ai-supply-chain/ai-us.json';
import { componentFixtureHtml } from './fixtures/component-html';

declare global { interface Window { graphSnapshot:()=>{radius:number;light:number;context:boolean}|null; } }

let html:string;
test.beforeAll(async()=>{
  const ids=new Set(['US:NVDA','US:AMD','US:MSFT','US:GOOGL']);
  const graph={...us,nodes:us.nodes.filter(node=>node.kind!=='COMPANY'||ids.has(node.id)),relationships:us.relationships.filter(edge=>ids.has(edge.source)&&ids.has(edge.target))};
  const css=readFileSync('src/app/globals.css','utf8').replace('@import "tailwindcss";','').replace(/@theme inline\s*\{[^}]+\}/,'');
  html=await componentFixtureHtml(`
    import React,{useMemo,useState} from 'react';import {createRoot} from 'react-dom/client';
    import {_roots} from '@react-three/fiber';
    import Graph from './src/components/company-graph-3d';
    import {StockComparisonChart} from './src/components/stock-comparison-chart';
    import {MarketProvider,useMarket} from './src/components/providers/market-provider';
    import {LocaleProvider} from './src/components/providers/locale-provider';
    import {ThemeToggle} from './src/components/theme-toggle';
    const graph=${JSON.stringify(graph)};const expanded=${JSON.stringify(us)};
    const data={dates:['2025-01-02','2025-06-02','2025-12-31'],series:[{symbol:'NVDA',values:[0,10,20]},{symbol:'AMD',values:[0,20,10]}],frequency:'Daily',source:'Isolated UI fixture'};
    function App(){const {theme}=useMarket();const [selected,setSelected]=useState('');const [displayedGraph,setDisplayedGraph]=useState(graph);const colors=useMemo(()=>theme==='light'?['#087e99','#7540b7']:['#22d3ee','#a78bfa'],[theme]);return <><ThemeToggle/><button onClick={()=>setDisplayedGraph(expanded)}>Update graph</button><div id="graph"><Graph graph={displayedGraph} selected={selected} onSelect={setSelected} reset={0} onReset={()=>{}} cameraRequest={0}/></div><div id="chart"><StockComparisonChart data={data} progress={1} style="line" highlighted={null} colors={colors}/></div></>}
    window.graphSnapshot=()=>{const state=[..._roots.values()][0]?.store.getState();if(!state)return null;const points=state.scene.children.find(item=>item.type==='Points'&&item.material?.uniforms?.graphRadius);return {camera:state.camera.position.toArray(),geometry:points?.geometry.uuid,light:points?.material.uniforms.lightMode.value,radius:points?.material.uniforms.graphRadius.value,context:state.gl.getContext().isContextLost(),calls:state.gl.info.render.calls}};
    createRoot(document.getElementById('root')).render(<LocaleProvider locale="en"><MarketProvider><App/></MarketProvider></LocaleProvider>);
  `,{jsx:'automatic',plugins:[{name:'isolated-auth',setup(build){build.onResolve({filter:/auth-provider$/},()=>({path:path.resolve('tests/conversion/fixtures/mocks.tsx')}));}}],alias:{'next/navigation':path.resolve('tests/conversion/fixtures/mocks.tsx'),'next/link':path.resolve('tests/conversion/fixtures/mocks.tsx')}},css+'body{margin:0;padding:16px}#graph{max-width:900px}#chart{background:var(--bg-surface);margin-top:16px}');
});

test('the graph keeps its dark space materials in light theme across a graph-data update that replaces shader uniforms',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce',colorScheme:'light'});
  await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.fulfill({status:404}));
  await page.goto('http://adaptive-ui.test/en?view=graph');
  await expect.poll(()=>page.evaluate(()=>window.graphSnapshot?.()?.light)).toBe(0);
  const before=await page.evaluate(()=>window.graphSnapshot!());
  const canvas=await page.locator('#graph canvas').elementHandle();
  await page.getByRole('button',{name:'Update graph',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.graphSnapshot?.()?.radius)).not.toBe(before!.radius);
  await expect.poll(()=>page.evaluate(()=>window.graphSnapshot?.()?.light)).toBe(0);
  expect(await canvas!.evaluate(el=>el===document.querySelector('#graph canvas'))).toBe(true);
  expect((await page.evaluate(()=>window.graphSnapshot!()))!.context).toBe(false);
});

test('theme switches preserve selected company, camera, graph geometry and chart WebGL canvas',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'});
  await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.fulfill({status:404}));
  await page.goto('http://adaptive-ui.test/en?view=graph');
  const graphCanvas=page.locator('#graph canvas'),chartCanvas=page.locator('#chart canvas');
  const company=page.locator('[data-company-id="US:NVDA"]');
  await expect(graphCanvas).toBeVisible({timeout:20000});
  try { await expect(company).toBeVisible({timeout:15000}); } catch(error) { throw new Error(`${error}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`); }
  await company.click();
  await expect(company).toHaveAttribute('aria-pressed','true');
  await expect(graphCanvas).toHaveAttribute('data-camera','idle',{timeout:15000});
  await expect(chartCanvas).toBeVisible();
  await graphCanvas.evaluate(el=>el.setAttribute('data-original','true'));
  await chartCanvas.evaluate(el=>el.setAttribute('data-original','true'));
  const snapshot=()=>page.evaluate(()=> (window as unknown as {graphSnapshot:()=>{camera:number[];geometry:string;light:number;context:boolean;calls:number}}).graphSnapshot());
  const before=await snapshot();expect(before.light).toBe(0);
  const url=page.url();
  const toggle=page.getByRole('button',{name:'Switch to light theme',exact:true});await toggle.focus();await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  // The graph is a dark space window in both site themes.
  expect((await snapshot()).light).toBe(0);
  await expect(graphCanvas).toHaveAttribute('data-original','true');await expect(chartCanvas).toHaveAttribute('data-original','true');
  await expect(company).toHaveAttribute('aria-pressed','true');
  const after=await snapshot();expect(after.geometry).toBe(before.geometry);expect(after.context).toBe(false);
  after.camera.forEach((value,index)=>expect(value).toBeCloseTo(before.camera[index],3));
  expect(after.calls).toBeLessThanOrEqual(before.calls);expect(page.url()).toBe(url);
  await info.attach('theme-renderer-continuity',{body:JSON.stringify({before,after}),contentType:'application/json'});
  await page.screenshot({path:info.outputPath('light-preserved-selection.png'),fullPage:true});
  await page.getByRole('button',{name:'Switch to dark theme',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');expect((await snapshot()).light).toBe(0);
  await expect(graphCanvas).toHaveAttribute('data-original','true');await expect(chartCanvas).toHaveAttribute('data-original','true');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
