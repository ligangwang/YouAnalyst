import {expect,test} from '@playwright/test';
import path from 'node:path';
import {componentFixtureHtml} from './fixtures/component-html';
import {buildPeerComparison} from '../../src/lib/peer-comparison/model';
import type {GraphNode} from '../../src/lib/knowledge-graph/model';
const datasets=Object.fromEntries(['US','CN_A'].map(market=>{
 const ids=market==='US'?['US:A','US:B','US:C','US:D','US:E']:['XSHE:000001','XSHE:000002','XSHE:000003','XSHE:000004','XSHE:000005'];
 const nodes:GraphNode[]=ids.map((id,i)=>({id,kind:'COMPANY',order:i,name:['Alpha','Beta','Gamma','Delta','Empty'][i],names:{en:['Alpha','Beta','Gamma','Delta','Empty'][i],'zh-CN':['甲公司','乙公司','丙公司','丁公司','缺失公司'][i]},stageIds:['compute'],symbol:id.split(':')[1],slug:['alpha','beta','gamma','delta','empty'][i]}));
 const currency=market==='US'?'USD':'CNY';
 const docs=new Map(nodes.map((node,i)=>{
  const metrics=[{label:'Revenue',value:1000+i*100,unit:currency,start:'2025-01-01',end:'2025-12-31',sourceUrl:'https://example.com/annual'},{label:market==='US'?'Net income':'Net income attributable to parent',value:[100,200,0,-50][i],unit:currency,start:'2025-01-01',end:'2025-12-31',sourceUrl:'https://example.com/annual'},...(market==='US'?[{label:'Diluted EPS',value:2,unit:'USD/shares',start:'2025-01-01',end:'2025-12-31'}]:[])];
  return [node.id,i===4?{}:{...(i===3?{}:{marketCap:{status:'estimated',currency,value:1e9*(3-i),priceDate:'2026-10-14',close:10,shares:{aShares:100000000,aTradableShares:50000000}}}),...(market==='US'?{value:{report:{end:'2025-12-31',form:'10-K'},metrics}}:{cnAnnual:{end:'2025-12-31',metrics}})}] as const;
 }));
 return [market,buildPeerComparison(ids[3],nodes,docs,new Map(),'2026-10-14')!];
}));
datasets.LARGE={...datasets.US,total:35,panels:datasets.US.panels.map(panel=>({...panel,rows:[...panel.rows,...Array.from({length:30},(_,i)=>({...panel.rows[0],id:`US:X${i}`,name:`Extra ${i}`,names:undefined,observation:null,rank:null}))]}))};
datasets.PRICES_ONLY={...datasets.US,panels:[],pricePeers:datasets.US.panels[0].rows};
let html:string;
test.beforeAll(async()=>{html=await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {CompanyPeerComparison} from './src/components/company-peer-comparison';import {LocaleProvider} from './src/components/providers/locale-provider';const params=new URLSearchParams(location.search);const datasets=${JSON.stringify(datasets)};createRoot(document.getElementById('root')).render(<LocaleProvider locale={params.get('lang')==='zh-CN'?'zh-CN':'en'}><main><CompanyPeerComparison data={params.has('empty')?{...datasets.US,panels:[]}:datasets[params.get('market')??'US']}/></main></LocaleProvider>);`,{alias:{'next/link':path.resolve('tests/industry/link.tsx')}},'body{margin:0;background:#07131d;color:#e2f1f8;font-family:Arial}main{max-width:900px;margin:auto;padding:16px}*{box-sizing:border-box}button{color:inherit}a{color:inherit}');});
for(const chinese of [false,true])for(const market of ['US','CN_A'])test(`${market} peer comparison shows partial coverage, losses, missing values and full list in ${chinese?'Chinese':'English'}`,async({page},info)=>{
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto(`http://peers.test/?market=${market}&lang=${chinese?'zh-CN':'en'}`);
 const section=page.getByRole('region',{name:chinese?'同业对比':'Peer comparison'});
 await expect(section).toBeVisible();await expect(section).toContainText(chinese?'样本覆盖 3/5':'Sample coverage 3/5');
 await expect(section).toContainText(chinese?'当前公司：暂无数据':'Current company: data unavailable');
 const current=section.locator('li[aria-current="true"]');await expect(current).toContainText(chinese?'丁公司':'Delta');await expect(current).toContainText(chinese?'暂无数据':'No data');
 await expect(section.getByRole('link',{name:chinese?'甲公司':'Alpha'})).toHaveAttribute('href',/company\/alpha/);
 await section.getByRole('button',{name:chinese?'查看全部 5 家公司':'View all 5 companies'}).click();await expect(section.locator('ol > li')).toHaveCount(5);
 await expect(section.locator('ol > li').last()).toContainText(chinese?'缺失公司':'Empty');
 const profit=chinese?(market==='US'?'年度净利润':'年度归母净利润'):(market==='US'?'Annual net income':'Annual profit attributable to parent');
 await section.getByRole('button',{name:profit,exact:true}).focus();await page.keyboard.press('Enter');
 await expect(section).toContainText(chinese?'样本覆盖 4/5':'Sample coverage 4/5');await expect(current).toContainText('-50');
 await expect(section.locator('[data-negative="true"]')).toHaveCount(1);await expect(current.getByRole('link',{name:'-50'})).toHaveAttribute('href','https://example.com/annual');
 await expect(section).toContainText('2025-01-01 → 2025-12-31');
 await expect(section.getByRole('button',{name:/ROE|TTM/})).toHaveCount(0);
 await expect(section.getByRole('button',{name:chinese?'年度摊薄每股收益':'Annual diluted EPS',exact:true})).toHaveCount(market==='US'?1:0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await section.screenshot({path:`output/peer-comparison-${market}-${chinese?'zh':'en'}-${info.project.name}.png`});
});
test('companies without comparable data do not render an empty comparison section',async({page})=>{await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto('http://peers.test/?empty=1');await expect(page.getByRole('heading',{name:'Peer comparison'})).toHaveCount(0);});


test('prices are requested only after selection and slow prices never block financial tabs',async({page})=>{
 const requests:string[][]=[];let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/*',async route=>{
  if(route.request().url().includes('/api/company-peer-prices')){
   requests.push(new URL(route.request().url()).searchParams.getAll('peer'));
   await held;await route.fulfill({json:{panel:null}}).catch(()=>{});return;
  }
  await route.fulfill({contentType:'text/html',body:html});
 });
 await page.goto('http://peers.test/');
 await expect(page.getByRole('heading',{name:'Peer comparison'})).toBeVisible();expect(requests).toHaveLength(0);
 await page.getByRole('button',{name:'Annual net income',exact:true}).click();
 await expect(page.locator('ol > li')).toHaveCount(4);expect(requests).toHaveLength(0);
 await page.getByRole('button',{name:'5-session return',exact:true}).click();
 await expect(page.getByRole('status')).toHaveText('Loading displayed companies…');
 expect(requests).toEqual([['US:D','US:B','US:A','US:C']]);
 await page.getByRole('button',{name:'Market cap',exact:true}).click();
 await expect(page.getByText('Sample coverage 3/5')).toBeVisible();
 release();await expect(page.getByRole('button',{name:'Market cap',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByText('No comparable prices for these companies.')).toHaveCount(0);
});

test('price paging fetches only the visible page, retains the current company, and reuses completed requests',async({page})=>{
 const requests:string[][]=[];
 await page.route('**/*',async route=>{
  if(route.request().url().includes('/api/company-peer-prices')){
   const ids=new URL(route.request().url()).searchParams.getAll('peer');requests.push(ids);
   const rows=ids.map((id,i)=>({...datasets.LARGE.panels[0].rows.find(row=>row.id===id)!,observation:{value:i,date:'2026-10-14',start:'2026-10-07'},rank:i+1}));
   await route.fulfill({json:{panel:{key:'fiveDayReturn',currency:'USD',date:'2026-10-14',start:'2026-10-07',annual:false,rows,count:rows.length,mean:1,median:1}}});return;
  }
  await route.fulfill({contentType:'text/html',body:html});
 });
 await page.goto('http://peers.test/?market=LARGE');
 expect(requests).toHaveLength(0);
 await page.getByRole('button',{name:'5-session return',exact:true}).click();
 await expect(page.locator('ol > li')).toHaveCount(4);
 expect(requests).toEqual([['US:D','US:A','US:B','US:C']]);
 await page.getByRole('button',{name:'View more peers',exact:true}).click();
 await expect(page.locator('ol > li')).toHaveCount(13);
 expect(requests[1]).toHaveLength(13);expect(requests[1]).toContain('US:D');expect(requests[1]).not.toContain('US:X8');
 await page.getByRole('button',{name:'Next peers',exact:true}).click();
 await expect(page.getByRole('link',{name:'Extra 8',exact:true})).toBeVisible();
 expect(requests[2]).toHaveLength(13);expect(requests[2]).toContain('US:D');expect(requests[2]).not.toContain('US:A');
 await page.getByRole('button',{name:'Previous peers',exact:true}).click();
 await expect(page.getByRole('link',{name:'Alpha',exact:true})).toBeVisible();expect(requests).toHaveLength(3);
 await expect(page.getByText(/Returns, ranks and averages cover only/)).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`output/peer-demand-${test.info().project.name}.png`});
});

test('failed price requests are retryable and do not replace existing financial data',async({page})=>{
 let calls=0;
 await page.route('**/*',async route=>{
  if(route.request().url().includes('/api/company-peer-prices')){
   calls++;await route.fulfill(calls===1?{status:503,json:{error:'unavailable'}}:{json:{panel:null}});return;
  }
  await route.fulfill({contentType:'text/html',body:html});
 });
 await page.goto('http://peers.test/');
 await page.getByRole('button',{name:'5-session return',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('Prices could not be loaded.');
 await page.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(page.getByRole('status')).toHaveText('No comparable prices for these companies.');expect(calls).toBe(2);
 await page.getByRole('button',{name:'Market cap',exact:true}).click();
 await expect(page.getByText('Sample coverage 3/5')).toBeVisible();
});


test('companies with no financial observations can request prices without eager reads',async({page})=>{
 let requests=0;
 await page.route('**/*',route=>{
  if(route.request().url().includes('/api/company-peer-prices')){requests++;return route.fulfill({json:{panel:null}});}
  return route.fulfill({contentType:'text/html',body:html});
 });
 await page.goto('http://peers.test/?market=PRICES_ONLY');
 await expect(page.getByText('Select 5-session return to compare prices.')).toBeVisible();expect(requests).toBe(0);
 await page.getByRole('button',{name:'5-session return',exact:true}).click();
 await expect(page.getByRole('status')).toHaveText('No comparable prices for these companies.');expect(requests).toBe(1);
});
