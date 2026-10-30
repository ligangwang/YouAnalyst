import {expect,test} from '@playwright/test';
import path from 'node:path';
import {componentFixtureHtml} from './fixtures/component-html';
let html:string;
test.beforeAll(async()=>{html=await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {CompanyPeerComparisonLoader} from './src/components/company-peer-comparison-loader';createRoot(document.getElementById('root')).render(<main><h1>Company overview</h1><button onClick={e=>e.currentTarget.textContent='Still interactive'}>Overview action</button><div style={{height:3000}}/><CompanyPeerComparisonLoader companyId='US:A'/></main>);`,{alias:{'next/link':path.resolve('tests/industry/link.tsx')}},'[data-peer-comparison-demand]{min-height:1px}');});
test('hidden comparison performs no work; slow visible comparison does not block overview or fetch prices',async({page})=>{
 const requests:string[]=[];let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/*',async route=>{
  if(route.request().url().includes('/api/')){requests.push(route.request().url());await held;await route.fulfill({json:{data:null}});}
  else await route.fulfill({contentType:'text/html',body:html});
 });
 await page.goto('http://peers.test');await expect(page.getByRole('heading',{name:'Company overview'})).toBeVisible();
 await page.getByRole('button',{name:'Overview action'}).click();await expect(page.getByRole('button',{name:'Still interactive'})).toBeVisible();expect(requests).toEqual([]);
 await page.locator('[data-peer-comparison-demand]').scrollIntoViewIfNeeded();await expect(page.getByRole('status')).toHaveText('Loading peer comparison…');
 await expect.poll(()=>requests.length).toBe(1);expect(requests[0]).toContain('/api/company-peer-comparison?company=US%3AA');
 await page.getByRole('button',{name:'Still interactive'}).click();release();await expect(page.getByRole('status')).toHaveCount(0);expect(requests).toHaveLength(1);
});
test('failed comparison offers retry and empty coverage does not show an empty panel',async({page})=>{
 let calls=0;
 await page.route('**/*',route=>route.request().url().includes('/api/company-peer-comparison')?route.fulfill(++calls===1?{status:503,json:{error:'Unavailable'}}:{json:{data:null}}):route.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://peers.test');await page.locator('[data-peer-comparison-demand]').scrollIntoViewIfNeeded();
 await page.getByRole('button',{name:'Retry peer comparison'}).click();await expect(page.getByRole('status')).toHaveCount(0);await expect(page.getByRole('button',{name:'Retry peer comparison'})).toHaveCount(0);expect(calls).toBe(2);
 await expect(page.getByRole('region',{name:'Peer comparison'})).toHaveCount(0);
});

test('visible comparison renders its lazy panel without requesting price files',async({page})=>{
 const requests:string[]=[];
 await page.route('**/*',route=>{
  if(route.request().url().includes('/api/')){
   requests.push(route.request().url());return route.fulfill({json:{data:{companyId:'US:A',sector:{en:'Compute',zh:'计算'},market:'US',total:1,panels:[],pricePeers:[{id:'US:A',name:'Alpha',symbol:'A'}]}}});
  }
  return route.fulfill({contentType:'text/html',body:html});
 });
 await page.goto('http://peers.test');await page.locator('[data-peer-comparison-demand]').scrollIntoViewIfNeeded();
 await expect(page.getByRole('region',{name:'Peer comparison'})).toBeVisible();
 await expect(page.getByRole('button',{name:'5-session return',exact:true})).toBeVisible();
 expect(requests).toHaveLength(1);expect(requests[0]).toContain('/api/company-peer-comparison?');
});
