import {expect,test} from '@playwright/test';
import path from 'node:path';
import {componentFixtureHtml} from './fixtures/component-html';
let html:string;
const empty={nodes:[],relationships:[],sources:[],asOf:''};
test.beforeAll(async()=>{html=await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {CompanyResearchPanel} from './src/components/company-research-panel';function App(){const [id,setId]=React.useState('US:A');return <main><h1>Company overview</h1><button onClick={e=>e.currentTarget.textContent='Still interactive'}>Overview action</button><button onClick={()=>setId('US:B')}>Switch company</button><div style={{height:3000}}/><CompanyResearchPanel companyId={id}/></main>}createRoot(document.getElementById('root')).render(<App/>);`,{
 alias:{'next/link':path.resolve('tests/industry/link.tsx')},
 plugins:[{name:'follow-control',setup(plugin){plugin.onLoad({filter:/company-follow-button\.tsx$/},()=>({contents:'export const CompanyFollowButton=()=>null;',loader:'js'}));}}],
 });});

test('offscreen relationships make no requests; slow visible request leaves overview interactive',async({page})=>{
 const requests:string[]=[];let release!:()=>void;const held=new Promise<void>(done=>{release=done;});
 await page.route('**/*',async route=>{
  if(route.request().url().includes('/api/')){requests.push(route.request().url());await held;await route.fulfill({json:empty});}
  else await route.fulfill({contentType:'text/html',body:html});
 });
 await page.goto('http://relationships.test');await page.getByRole('button',{name:'Overview action'}).click();
 await expect(page.getByRole('button',{name:'Still interactive'})).toBeVisible();expect(requests).toEqual([]);
 await page.locator('[data-relationship-demand]').scrollIntoViewIfNeeded();
 await expect(page.getByRole('status')).toHaveText('Loading company research…');
 await expect.poll(()=>requests.length).toBe(1);expect(requests[0]).toContain('/api/company-relationships?company=US%3AA');
 await page.getByRole('button',{name:'Still interactive'}).click();release();
 await expect(page.getByRole('status')).toHaveCount(0);expect(requests).toHaveLength(1);
});

test('deep links demand only the selected company and failures retry the scoped endpoint',async({page})=>{
 const requests:string[]=[];
 await page.route('**/*',route=>{
  if(route.request().url().includes('/api/')){requests.push(route.request().url());return route.fulfill(requests.length===1?{status:503,json:{error:'Unavailable'}}:{json:empty});}
  return route.fulfill({contentType:'text/html',body:html});
 });
 await page.goto('http://relationships.test/#relationship-example');
 await page.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(page.getByRole('status')).toHaveCount(0);expect(requests).toHaveLength(2);
 expect(requests.every(url=>url.includes('/api/company-relationships?company=US%3AA'))).toBe(true);
});

test('company switch discards an old pending response and does not fetch the new offscreen panel',async({page})=>{
 const requests:string[]=[];let release!:()=>void;const held=new Promise<void>(done=>{release=done;});
 await page.route('**/*',async route=>{
  if(route.request().url().includes('/api/')){requests.push(route.request().url());await held;await route.fulfill({json:empty}).catch(()=>{});}
  else await route.fulfill({contentType:'text/html',body:html});
 });
 await page.goto('http://relationships.test');await page.locator('[data-relationship-demand]').scrollIntoViewIfNeeded();
 await expect.poll(()=>requests.length).toBe(1);
 await page.getByRole('button',{name:'Switch company'}).click();release();
 await expect(page.getByRole('button',{name:'Load company relationships'})).toBeAttached();
 expect(requests).toHaveLength(1);
});

test('without IntersectionObserver the explicit load button remains demand-driven',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(window,'IntersectionObserver',{value:undefined});});
 const requests:string[]=[];
 await page.route('**/*',route=>{
  if(route.request().url().includes('/api/')){requests.push(route.request().url());return route.fulfill({json:empty});}
  return route.fulfill({contentType:'text/html',body:html});
 });
 await page.goto('http://relationships.test');await expect(page.getByRole('heading')).toBeVisible();expect(requests).toEqual([]);
 await page.getByRole('button',{name:'Load company relationships'}).click();await expect(page.getByRole('status')).toHaveCount(0);
 await expect.poll(()=>requests.length).toBe(1);
});
