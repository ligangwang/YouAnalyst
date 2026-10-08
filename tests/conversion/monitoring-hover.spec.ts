import {expect, test} from '@playwright/test';
import {componentFixtureHtml} from './fixtures/component-html';
import {accelerateTours, tourClockPlugin} from './fixtures/tour-clock';
import us from '../../data/ai-supply-chain/ai-us.json';
import {combineGraphs, type KnowledgeGraph} from '../../src/lib/knowledge-graph/model';

const fullGraph=combineGraphs([us as unknown as KnowledgeGraph & {id:string;language:string}]);
const graph={...fullGraph,nodes:fullGraph.nodes.filter(n=>n.kind==='STAGE'||['US:NVDA','US:AMD','US:TSM'].includes(n.id))};
let html:string;
test.beforeAll(async()=>{
  html=await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {LineSegments} from 'three';import Graph from './src/components/company-graph-3d';import {LocaleProvider} from './src/components/providers/locale-provider';LineSegments.prototype.onBeforeRender=function(){if(this.geometry.userData.edgeIds){const colors=this.geometry.getAttribute('color');window.hoverEdges=this.geometry.userData.edgeIds.map((id,i)=>({id,alpha:colors.getW(i*2)}));}};createRoot(document.getElementById('root')).render(<LocaleProvider locale="en"><Graph graph={${JSON.stringify(graph)}} selected="" onSelect={()=>{}} reset={0} onReset={()=>{}} cameraRequest={0} intelligence={{origin:'',edges:[]}}/></LocaleProvider>);`,{jsx:'automatic',plugins:[tourClockPlugin]},'body{margin:0;background:#07111d;color:white}#root{height:100vh}');
});

test('monitoring node hover fades relationship lines in and out',async({page},info)=>{
  test.skip(info.project.name==='mobile','Mouse hover is a desktop interaction');
  await accelerateTours(page);
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:html}));
  await page.goto('http://hover.test/');
  const canvas=page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-camera','idle',{timeout:20000});
  const edges=()=>page.evaluate(()=> (window as unknown as {hoverEdges:{id:string;alpha:number}[]}).hoverEdges??[]);
  await expect.poll(async()=> (await edges()).length).toBeGreaterThan(0);
  expect((await edges()).every(e=>e.alpha===0)).toBe(true);
  const label=page.locator('[data-company-id="US:NVDA"]');
  await expect(label).toBeVisible();
  await page.emulateMedia({reducedMotion:'no-preference'});
  await label.hover();
  await expect(label).toHaveAttribute('data-highlighted','true');
  await expect.poll(async()=> (await edges()).some(e=>e.alpha>.01)).toBe(true);
  await page.screenshot({path:info.outputPath('monitoring-hover-relationships.png')});
  await page.mouse.move(1,1);
  await expect(label).toHaveAttribute('data-highlighted','false');
  await expect.poll(async()=> (await edges()).every(e=>e.alpha===0)).toBe(true);
});

