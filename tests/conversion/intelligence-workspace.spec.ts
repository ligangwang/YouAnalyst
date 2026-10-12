import {expect,test} from '@playwright/test';
import {componentFixtureHtml} from './fixtures/component-html';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import type {IntelligenceSnapshot} from '../../src/lib/intelligence/model';
import {sourceDocumentsForEvents} from '../../src/lib/intelligence/model';
import {mergeIntelligenceEvents} from '../../src/lib/intelligence/project';
import {groupCompanyAnnouncements} from '../../src/lib/intelligence/announcement-grouping';
import {accelerateTours,tourClockPlugin} from './fixtures/tour-clock';

const companies=[{id:'US:LITE',symbol:'LITE',name:'Lumentum',summary:'Communication supplier',summaryZh:'通信设备供应商。',kind:'COMPANY',order:1,stageIds:['optics']},{id:'US:MULT',symbol:'MULT',name:'Multiple Systems',kind:'COMPANY',order:2,stageIds:['compute']},{id:'US:MU',symbol:'MU',name:'Micron',kind:'COMPANY',order:3,stageIds:['memory']},{id:'US:MEM',symbol:'MEM',name:'Memory Supplier',summary:'Memory partner',kind:'COMPANY',order:4,stageIds:['memory']}];
const events=Array.from({length:200},(_,i)=>({id:`event-${i}`,origin:'US:MU',companyIds:['US:MU'],edgeIds:[],category:'BUSINESS',title:`Published company update ${i+1}`,titleZh:undefined as string|undefined,titleEn:undefined as string|undefined,summary:`Source summary ${i+1}`,published_at:i===0?'2026-10-02T12:00:00Z':null,publication_date:'2026-10-02',eventDate:null,evidence:[{id:`source-${i}`,url:`https://investors.example.com/${i}`,title:`Original release ${i+1}`,sourceDate:'2026-10-02',channel:'IR'}],planned:false}));
events[1].companyIds=['US:MU','US:MEM','US:MULT','US:LITE','US:UNKNOWN'];
events[198]={...events[198],title:'关于召开股东大会的公告',titleEn:'Announcement of a shareholders meeting'};
events[198].summary='交易所上市公司原始公告。';
events[198].evidence[0].title=events[198].title;
events[199]={...events[199],origin:'US:LITE',companyIds:['US:LITE'],title:'Lumentum communication update',titleZh:'Lumentum 通信业务最新进展'};
const snapshot={graph:{asOf:'2026-10-04',nodes:companies,relationships:[],sources:[]},graphVersion:'fixture',events,generatedAt:'2026-10-04T16:00:00Z',session:{date:'2026-10-04',timeZone:'America/New_York',startAt:'2026-10-04T04:00:00Z',endAt:'2026-10-05T04:00:00Z'},coverage:[{channel:'IR',status:'connected'}],sourceDocuments:Array.from({length:350},(_,i)=>({id:`https://investors.example.com/${i}`,channel:'IR',companyIds:['US:MU'],published_at:null,publication_date:'2026-10-02'})),statisticsComplete:true,warnings:[],truncated:true,limit:200} as IntelligenceSnapshot;
let html:string;
snapshot.sourceDocuments![199].companyIds=['US:LITE'];
snapshot.events[0]={...snapshot.events[0],calendarEvents:[{id:'scheduled_event_micron_call',companyId:'US:MU',day:'2026-10-28'},{id:'scheduled_event_micron_release',companyId:'US:MU',day:'2026-10-28'}]};
async function workspaceFixture(realCharts=false,fixture=snapshot,initial=true){
  return componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {LiveInvestmentIntelligence} from './src/components/live-investment-intelligence';createRoot(document.getElementById('root')).render(<LiveInvestmentIntelligence ${initial?`initialSnapshot={${JSON.stringify(fixture)}}`:''}/>);`,{jsx:'automatic',define:{'process.env':'{}'},alias:{'next/link':path.resolve('tests/conversion/fixtures/mocks.tsx'),'@/components/providers/auth-provider':path.resolve('tests/conversion/fixtures/mocks.tsx')},plugins:[{name:'workspace-services',setup(build){
    build.onResolve({filter:realCharts?/(?:locale-provider|company-follow-button|site-nav|next\/image)$/:/(?:company-graph-3d|industry-tree-scene|locale-provider|company-follow-button|site-nav|next\/image)$/},args=>({path:args.path.split('/').at(-1)!,namespace:'workspace-mock'}));
    build.onLoad({filter:/.*/,namespace:'workspace-mock'},args=>({loader:'tsx',resolveDir:process.cwd(),contents:args.path==='company-graph-3d'?`export default function Graph(){return <div style={{height:'100%',background:'radial-gradient(ellipse at center,#123b45,#07111b 70%)'}}>Local interaction fixture</div>}`:args.path==='industry-tree-scene'?`export default function Scene(){return <div>Tree interaction fixture</div>}`:args.path==='locale-provider'?`export function useLocale(){const chinese=new URLSearchParams(location.search).get('lang')==='zh-CN';return {locale:chinese?'zh-CN':'en',chinese,text:(en,zh)=>chinese?zh:en}};export function LanguageSwitch(){return <button>中文</button>}`:args.path==='company-follow-button'?`export function CompanyFollowButton(){return null}export function useCompanyFollows(){return {user:null,ids:[],change:async()=>{}}}`:args.path==='site-nav'?`export function AvatarButton(){return <span>Profile</span>}`:`export default function Image({priority,...props}){return <img {...props}/>} `}));
  }},...(realCharts?[tourClockPlugin]:[])]},'body{margin:0;font-family:Arial}*{box-sizing:border-box}a{color:inherit;text-decoration:none}');
}
test.beforeAll(async()=>{
  html=await workspaceFixture();
  if(process.env.INTELLIGENCE_PREVIEW_OUT){
    const directory=process.env.INTELLIGENCE_PREVIEW_OUT;
    const previewSnapshot=process.env.INTELLIGENCE_PREVIEW_SNAPSHOT?JSON.parse(readFileSync(process.env.INTELLIGENCE_PREVIEW_SNAPSHOT,'utf8')) as IntelligenceSnapshot:snapshot;
    mkdirSync(path.join(directory,'api'),{recursive:true});
    writeFileSync(path.join(directory,'index.html'),await workspaceFixture(true,previewSnapshot));
    writeFileSync(path.join(directory,'api/intelligence'),JSON.stringify(previewSnapshot));
  }
});
async function open(page:import('@playwright/test').Page,zh=false,fixture=snapshot){
  const body=fixture===snapshot?html:await workspaceFixture(false,fixture);
  await page.route('**/*',route=>route.request().url().includes('/api/intelligence')?route.fulfill({json:fixture}):route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body}):route.fulfill({status:404,body:''}));
  await page.goto(`http://workspace.test/${zh?'?lang=zh-CN':''}`);
}

for(const theme of ['ai','robotics','space'] as const)test(`Explore ${theme} chart share retains the selected event and restores chart controls`,async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{(window as unknown as {copiedLink:string}).copiedLink=value;}}}));
 await open(page,false,{...snapshot,theme});
 await page.goto(`http://workspace.test/?theme=${theme}&company=US%3AMU&event=event-0&chartRange=90&chartStyle=line&chartMA=10&chartMacd=1&q=private-search&tab=watchlist`);
 const copy=page.getByRole('button',{name:'Copy chart link',exact:true});
 await expect(copy).toBeVisible();
 await copy.focus();await copy.press('Enter');
 const link=new URL(await page.evaluate(()=>(window as unknown as {copiedLink:string}).copiedLink));
 expect(link.pathname).toBe('/en');
 expect(link.searchParams.get('company')).toBe('US:MU');
 expect(link.searchParams.get('event')).toBe('event-0');
 expect(link.searchParams.get('theme')).toBe(theme);
 expect(link.searchParams.has('q')).toBe(false);
 expect(link.searchParams.has('tab')).toBe(false);
 await page.goto(`http://workspace.test${link.pathname}${link.search}`);
 await expect(page.getByLabel('Price history range')).toHaveValue('90');
 await expect(page.getByRole('button',{name:'Line',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('dialog',{name:'Event details'})).toContainText(snapshot.events[0].title);
});

for(const view of ['graph','tree','hierarchy','table'])test(`exact ticker search selects the company in ${view}`,async({page})=>{
 const fixture:IntelligenceSnapshot={...snapshot,graph:{...snapshot.graph,relationships:[{id:'memory-partner',source:'US:MU',target:'US:MEM',type:'PARTNER_OF',summary:'Memory partnership',commercialStatus:'DOCUMENTED',sourceIds:[]}]}};
 await open(page,false,fixture);
 await page.goto(`http://workspace.test/?view=${view}`);
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=page.getByPlaceholder('Search company / ticker');
 await search.fill('mu');if(view!=='tree')await search.press('Enter');
 await expect(page).toHaveURL(/company=US%3AMU/);
 const card=page.getByRole('region',{name:'Company details',exact:true});
 await expect(card).toBeVisible();await expect(card).toContainText('Micron');
 await expect(card).toContainText('Memory partnership');
 await expect(page.locator('[data-company-timeline="US:MU"]')).toBeVisible();
 await expect(page.getByRole('group',{name:'Timeline range'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Clear company event filter'})).toContainText('MU');
 // Repeated exact submission stays selected rather than toggling it off.
 await search.press('Enter');await expect(card).toBeVisible();
 await search.fill('M');await search.press('Enter');
 await expect(card).toHaveCount(0);
 await expect(page).not.toHaveURL(/company=/);
});

for(const pending of [false,true])test(`sector selection replaces ${pending?'pending':'committed'} company search`,async({page},info)=>{
 await open(page);
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=page.getByPlaceholder('Search company / ticker');
 await search.fill('MULT');
 if(!pending){await search.press('Enter');await expect(page).toHaveURL(/company=US%3AMULT/);}
 await page.getByRole('button',{name:/^Memory & storage/}).click();
 await expect(search).toHaveValue('');
 const companyList=info.project.name==='mobile'?page.getByRole('region',{name:'Company list',exact:true}):page.getByRole('complementary',{name:'Universe navigation'});
 await expect(companyList.getByRole('button',{name:info.project.name==='mobile'?'Micron':'MU Micron',exact:true})).toBeVisible();
 await expect(companyList.getByRole('button',{name:info.project.name==='mobile'?'Memory Supplier':'MEM Memory Supplier',exact:true})).toBeVisible();
 await expect(companyList.getByRole('button',{name:info.project.name==='mobile'?'Multiple Systems':'MULT Multiple Systems',exact:true})).toHaveCount(0);
 await page.waitForTimeout(1200);
 await expect(page).not.toHaveURL(/company=|q=/);
 await expect(page.getByRole('button',{name:/^Memory & storage/})).toHaveAttribute('aria-pressed','true');
});

for(const view of ['graph','tree','hierarchy','table'])test(`selected company price chart remains usable inside fullscreen ${view}`,async({page})=>{
 await open(page);
 await page.goto(`http://workspace.test/?view=${view}&company=US%3AMU`);
 const workspace=page.locator('section[aria-label="Company relationship chart"]');
 await workspace.getByRole('button',{name:'Full screen',exact:true}).click();
 await expect(workspace).toHaveAttribute('data-chart-size','full');
 const timeline=workspace.locator('[data-company-timeline="US:MU"]');
 await expect(timeline).toBeVisible();
 const range=timeline.getByLabel('Price history range');await range.selectOption('90');
 await expect(range).toHaveValue('90');
 expect(await timeline.evaluate(el=>Boolean(el.closest('[inert]')))).toBe(false);
 await timeline.getByRole('button',{name:'Full screen',exact:true}).click();
 await expect(timeline).toHaveAttribute('data-chart-size','full');
 await page.keyboard.press('Escape');
 await expect(timeline).toHaveAttribute('data-chart-size','compact');
 await expect(workspace).toHaveAttribute('data-chart-size','full');
 await workspace.getByRole('button',{name:'Restore layout',exact:true}).click();
 await expect(workspace).toHaveAttribute('data-chart-size','compact');
 await expect(page.locator('[data-company-timeline="US:MU"]').getByLabel('Price history range')).toHaveValue('90');
});

test('chart sizes preserve selection and indicators read preceding history',async({page},info)=>{
 await open(page);
 const bars:import('../../src/lib/ui/company-timeline').TimelinePrice[]=[];
 for(let date=Date.parse('2026-04-01'),index=0;date<=Date.parse('2026-10-09');date+=86_400_000){
  if([0,6].includes(new Date(date).getUTCDay()))continue;
  const close=100+index*.3+Math.sin(index++);
  bars.push({date:new Date(date).toISOString().slice(0,10),open:close-.5,high:close+1,low:close-1,close,volume:1000});
 }
 const requests:string[]=[];
 await page.route('**/api/company-timeline?*',route=>{
  const url=route.request().url();requests.push(url);
  const days=Number(new URL(url).searchParams.get('days')??30),start=new Date(Date.parse('2026-10-11')-days*86_400_000).toISOString().slice(0,10);
  return route.fulfill({json:{companyId:'US:MU',start,end:'2026-10-11',currency:'USD',available:true,prices:bars.filter(bar=>bar.date>=start),...(url.includes('indicators=1')?{warmupPrices:bars.filter(bar=>bar.date<start)}: {})}});
 });
 const relationship=page.locator('section[aria-label="Company relationship chart"]');
 await relationship.getByRole('button',{name:'Half screen',exact:true}).click();await expect(relationship).toHaveAttribute('data-chart-size','half');
 expect((await relationship.boundingBox())!.height).toBeGreaterThanOrEqual(page.viewportSize()!.height*.49);
 await relationship.getByRole('button',{name:'Full screen',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Company relationship chart'})).toBeVisible();
 const graphBounds=(await relationship.boundingBox())!;expect(graphBounds.width).toBeGreaterThanOrEqual(page.viewportSize()!.width-1);
 await page.screenshot({path:`output/graph-full-${info.project.name}.png`});
 await page.keyboard.press('Escape');await expect(relationship).toHaveAttribute('data-chart-size','compact');
 await expect(relationship.getByRole('button',{name:'Full screen',exact:true})).toBeFocused();
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=page.getByPlaceholder('Search company / ticker');await search.fill('MU');await search.press('Enter');
 const timeline=page.locator('[data-company-timeline="US:MU"]');await expect(timeline.locator('[data-price-candle]')).not.toHaveCount(0);
 await expect(timeline.getByRole('button',{name:'MA60',exact:true})).toHaveAttribute('aria-pressed','false');
 await expect(timeline.locator('[data-macd-panel]')).toHaveCount(0);
 await timeline.getByRole('button',{name:'Half screen',exact:true}).click();await expect(timeline).toHaveAttribute('data-chart-size','half');
 await timeline.getByRole('button',{name:'Full screen',exact:true}).click();await expect(timeline).toHaveAttribute('role','dialog');
 await timeline.getByRole('button',{name:'MA60',exact:true}).click();
 await expect(timeline.locator('[data-moving-average="60"]')).toHaveAttribute('d',/^M.+L/);
 expect(requests.some(url=>url.includes('indicators=1'))).toBeTruthy();
 await timeline.getByRole('button',{name:'MACD (12,26,9)',exact:true}).click();await expect(timeline.locator('[data-macd-histogram]')).not.toHaveCount(0);
 const candles=await timeline.locator('[data-price-candle]').count();
 await timeline.getByRole('combobox',{name:'Price history range'}).selectOption('90');
 await expect(timeline.locator('[data-price-candle]')).toHaveCount(bars.filter(bar=>bar.date>='2026-07-13').length);
 expect(await timeline.locator('[data-price-candle]').count()).toBeGreaterThan(candles);
 await timeline.getByRole('combobox',{name:'Price history range'}).selectOption('30');await expect(timeline.locator('[data-price-candle]')).toHaveCount(candles);
 await timeline.getByRole('button',{name:'Events',exact:true}).click();await expect(timeline.locator('button[data-event-type]')).toHaveCount(0);
 await page.screenshot({path:`output/indicators-full-${info.project.name}-dark.png`});
 await page.addStyleTag({content:':root{--ui-surface:#fff;--ui-text:#172d40;--ui-muted:#536e85;--ui-line:#cad7e3;--ui-selected:#dceff3;--price-up:#008763;--price-down:#e52650;--chart-line:#0087a8;}'});
 await page.screenshot({path:`output/indicators-full-${info.project.name}-light.png`});
 await page.keyboard.press('Escape');await expect(timeline).toHaveAttribute('data-chart-size','compact');
 await expect(page).toHaveURL(/company=US%3AMU/);
 await timeline.getByRole('button',{name:'Full screen',exact:true}).click();await timeline.getByRole('button',{name:'Close timeline',exact:true}).click();
 await expect(page.getByRole('button',{name:'Show timeline'})).toBeVisible();expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
});

test('a longer supplied price history remains illustrative and supplies indicator warmup',async({page})=>{
 const prices=Array.from({length:300},(_,index)=>({date:new Date(Date.parse('2025-12-15')+index*86_400_000).toISOString().slice(0,10),close:100+index*.2,volume:100}));
 const fixture=await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {CompanyTimeline} from './src/components/company-timeline';createRoot(document.getElementById('root')).render(<CompanyTimeline companyId="US:AMD" graph={{asOf:'2026-10-11',nodes:[],relationships:[],sources:[]}} initialPrices={${JSON.stringify({companyId:'US:AMD',start:'2021-10-09',end:'2026-10-11',currency:'USD',available:true,prices})}}/>);`,{jsx:'automatic',alias:{'next/link':path.resolve('tests/conversion/fixtures/mocks.tsx'),'@/components/providers/auth-provider':path.resolve('tests/conversion/fixtures/mocks.tsx')},plugins:[{name:'timeline-preview',setup(build){
  build.onResolve({filter:/(?:locale-provider|company-follow-button)$/},args=>({path:args.path,namespace:'preview'}));
  build.onLoad({filter:/.*/,namespace:'preview'},args=>({loader:'js',contents:args.path.endsWith('locale-provider')?`export function useLocale(){return {locale:'en',chinese:false,text:(en,zh)=>en}}`:`export function CompanyFollowButton(){return null}export function useCompanyFollows(){return {user:null,ids:[]}}`}));
 }}]},'body{margin:0;font-family:Arial}');
 const requests:string[]=[];
 await page.route('**/*',route=>{if(route.request().url().includes('/api/company-timeline'))requests.push(route.request().url());return route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:fixture}):route.fulfill({status:503,body:'No live data in illustrative preview'});});
 await page.goto('http://timeline-preview.test/');
 const timeline=page.locator('[data-company-timeline="US:AMD"]');
 await expect(timeline.locator('[data-price-line]')).toBeVisible();
 await timeline.getByRole('button',{name:'MA60',exact:true}).click();await expect(timeline.locator('[data-moving-average="60"]')).toHaveAttribute('d',/^M.+L/);
 await timeline.getByRole('button',{name:'MACD (12,26,9)',exact:true}).click();await expect(timeline.locator('[data-macd-histogram]')).not.toHaveCount(0);
 await timeline.getByRole('combobox',{name:'Price history range'}).selectOption('90');await expect(timeline).toContainText('90 stored daily bars');
 await expect(timeline.getByRole('status')).toHaveCount(0);expect(requests).toEqual([]);
});

test('all six history ranges include YTD and five-year weekly prices with exact event dates',async({page})=>{
 const items=['2026-09-28','2026-09-30'].map((publication_date,index)=>({...snapshot.events[0],id:'week-'+index,title:'Weekly business '+index,published_at:null,publication_date,eventType:'product_business' as const,eventSubtype:'business_update'}));
 await open(page,false,{...snapshot,events:items});
 const requests:string[]=[];
 await page.route('**/api/company-timeline?*',route=>{
  const range=new URL(route.request().url()).searchParams.get('days')!;requests.push(range);
  const weekly=range==='1826';
  return route.fulfill({json:{companyId:'US:MU',start:range==='ytd'?'2026-01-01':weekly?'2021-10-11':'2026-09-01',end:'2026-10-11',currency:'USD',available:true,interval:weekly?'weekly':'daily',prices:weekly?[{date:'2026-10-02',periodStart:'2026-09-28',open:10,high:15,low:8,close:13,volume:1500},{date:'2026-10-09',periodStart:'2026-10-05',open:13,high:17,low:12,close:14,volume:600}]:[{date:'2026-09-28',open:10,high:12,low:9,close:11,volume:100},{date:'2026-09-30',open:11,high:15,low:8,close:13,volume:200},{date:'2026-10-09',open:13,high:17,low:12,close:14,volume:600}]}});
 });
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=page.getByPlaceholder('Search company / ticker');await search.fill('MU');await search.press('Enter');
 const timeline=page.locator('[data-company-timeline="US:MU"]'),range=timeline.getByRole('combobox',{name:'Price history range'});
 await expect(range).toHaveValue('30');await expect(range.locator('option')).toHaveText(['1M','3M','6M','YTD','1Y','5Y']);
 for(const value of ['90','180','ytd','365','1826']){await range.selectOption(value);await expect.poll(()=>requests.at(-1)).toBe(value);await expect(timeline.locator('[data-price-candle]')).not.toHaveCount(0);}
 await expect(timeline.locator('[data-price-candle]')).toHaveCount(2);await expect(timeline).toContainText('Weekly bars');
 const svg=timeline.locator('svg');await svg.scrollIntoViewIfNeeded();const box=(await svg.boundingBox())!;await page.mouse.click(box.x+box.width*.75,box.y+90);
 const prices=timeline.getByRole('group',{name:'Price details'});await expect(prices).toContainText('Weekly change');await expect(prices).toContainText('2026-10-05 – 2026-10-09');
 await prices.getByRole('button',{name:'Close price details'}).click();
 await timeline.locator('button[data-event-count="2"]').click();const chooser=page.getByRole('group',{name:'Choose an event'});
 await expect(chooser).toContainText('Sep 28');await expect(chooser).toContainText('Sep 30');await chooser.getByRole('button',{name:'Close event list'}).click();
 await range.selectOption('30');await expect(timeline.locator('[data-price-candle]')).toHaveCount(3);await expect(timeline).toContainText('Daily bars');
});

test('a missing weekly candle shows its actual return baseline',async({page})=>{
 await open(page,false,{...snapshot,events:[]});
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:'US:MU',start:'2021-10-11',end:'2026-10-11',currency:'USD',available:true,interval:'weekly',prices:[{date:'2026-09-25',periodStart:'2026-09-21',open:100,high:105,low:95,close:100,volume:100},{date:'2026-10-09',periodStart:'2026-10-05',open:100,high:115,low:99,close:110,volume:100}]}}));
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=page.getByPlaceholder('Search company / ticker');await search.fill('MU');await search.press('Enter');
 const timeline=page.locator('[data-company-timeline="US:MU"]');await timeline.getByRole('combobox',{name:'Price history range'}).selectOption('1826');await expect(timeline.locator('[data-price-candle]')).toHaveCount(2);
 await timeline.locator('svg').press('Enter');const tooltip=timeline.getByRole('group',{name:'Price details'});
 await expect(tooltip).toContainText('Change since 2026-09-25');await expect(tooltip).toContainText('+10.00%');await expect(tooltip).not.toContainText('Weekly change');
});

test('event windows open beside list items and markers, including fullscreen, without replacing company details',async({page},info)=>{
 const first={...snapshot.events[0],id:'near-first',title:'Nearby earnings announcement',eventType:'earnings' as const,publication_date:'2026-10-02',evidence:[snapshot.events[0].evidence[0],{id:'extra',url:'https://example.com/extra',title:'Second event reference',sourceDate:'2026-10-02',channel:'SEC' as const}]};
 const second={...snapshot.events[0],id:'near-second',title:'Nearby business announcement',eventType:'product_business' as const,publication_date:'2026-10-01'};
 await open(page,false,{...snapshot,events:[first,second],eventReturns:{'near-first':[{companyId:'US:MU',baselineDate:'2026-10-01',latestDate:'2026-10-05',baselineClose:100,latestClose:110,change:.1,dateOnly:true}]}});
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:'US:MU',start:'2026-09-11',end:'2026-10-11',currency:'USD',available:true,prices:[{date:'2026-10-01',close:100,volume:10},{date:'2026-10-02',close:105,volume:20},{date:'2026-10-05',close:110,volume:30}]}}));
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=page.getByPlaceholder('Search company / ticker');await search.fill('MU');await search.press('Enter');
 const timeline=page.locator('[data-company-timeline="US:MU"]'),card=page.getByRole('region',{name:'Company details',exact:true}),window=page.getByRole('dialog',{name:'Event details',exact:true});
 const row=page.getByRole('complementary',{name:'Events and sources'}).getByRole('button',{name:/Nearby earnings announcement/});
 const near=async(trigger:import('@playwright/test').Locator)=>{
  const point=(await trigger.boundingBox())!,box=(await window.boundingBox())!,cx=point.x+point.width/2,cy=point.y+point.height/2;
  expect(Math.hypot(Math.max(box.x-cx,0,cx-box.x-box.width),Math.max(box.y-cy,0,cy-box.y-box.height))).toBeLessThan(36);
  expect(box.x).toBeGreaterThanOrEqual(11);expect(box.y).toBeGreaterThanOrEqual(11);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize()!.width-11);expect(box.y+box.height).toBeLessThanOrEqual(page.viewportSize()!.height-11);
 };
 await row.click();await expect(window).toBeVisible();await expect(window).toBeFocused();await near(row);
 await expect(window).toContainText('Source summary 1');await expect(window).toContainText('Since pub.');await expect(window).toContainText('+10.00%');await expect(window.getByRole('link',{name:/Second event reference/})).toHaveAttribute('href','https://example.com/extra');
 await expect(card).not.toContainText('Nearby earnings announcement');await expect(card).not.toContainText('Second event reference');
 await page.screenshot({path:`output/event-window-list-${info.project.name}.png`});
 await window.getByRole('button',{name:'Close event details'}).click();await expect(window).toHaveCount(0);await expect(row).toBeFocused();await expect(card).toBeVisible();
 await timeline.getByRole('button',{name:'Full screen',exact:true}).click();
 const marker=timeline.getByRole('button',{name:/Oct 2: Nearby earnings announcement/});await marker.click();await expect(window).toBeVisible();await near(marker);
 await expect(timeline.locator('[data-event-window]')).toHaveCount(1);
 await page.screenshot({path:`output/event-window-chart-${info.project.name}.png`});
 await page.keyboard.press('Escape');await expect(window).toHaveCount(0);await expect(timeline).toHaveAttribute('data-chart-size','full');await expect(marker).toBeFocused();
 await marker.press('Enter');await expect(window).toBeVisible();await window.getByRole('button',{name:'Close event details'}).click();await expect(window).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(timeline).toHaveAttribute('data-chart-size','compact');
 await row.click();await expect(window).toBeVisible();await page.mouse.click(2,2);await expect(window).toHaveCount(0);
});

test('clicked price details show daily changes independently of event markers',async({page})=>{
 const fixture:IntelligenceSnapshot={...snapshot,events:[{...snapshot.events[0],id:'up',eventType:'earnings',publication_date:'2026-10-01'},{...snapshot.events[0],id:'down',eventType:'product_business',eventSubtype:'business_update',publication_date:'2026-10-02'},{...snapshot.events[0],id:'missing',eventType:'product_business',eventSubtype:'business_update',publication_date:'2026-10-02'},{...snapshot.events[0],id:'closed',eventType:'financing',publication_date:'2026-10-04'}],eventReturns:{up:[{companyId:'US:MU',baselineDate:'2026-09-30',latestDate:'2026-10-03',baselineClose:100,latestClose:103.2,change:.032,dateOnly:true}],down:[{companyId:'US:MU',baselineDate:'2026-10-01',latestDate:'2026-10-03',baselineClose:100,latestClose:98.2,change:-.018,dateOnly:true}]}};
 await open(page,false,fixture);
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:'US:MU',start:'2026-09-11',end:'2026-10-11',currency:'USD',available:true,prices:[{date:'2026-09-30',close:100,volume:10},{date:'2026-10-01',close:104,volume:20},{date:'2026-10-02',close:103,volume:30},{date:'2026-10-05',close:106,volume:40},{date:'2026-10-06',close:106,volume:50}]}}));
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=page.getByPlaceholder('Search company / ticker');await search.fill('MU');await search.press('Enter');
 const timeline=page.locator('[data-company-timeline="US:MU"]');
 await expect(timeline).toContainText('5 stored daily bars');await expect(timeline.locator('[data-latest-close-reference]')).toContainText('Latest close 106');await expect(timeline.locator('[data-latest-close-reference] line')).toHaveCSS('stroke','rgb(201, 184, 121)');await expect(timeline.locator('[data-latest-close-reference] line')).toHaveAttribute('stroke-dasharray','2 4');
 const earnings=timeline.locator('[data-event-type="earnings"]');
 await expect(timeline.locator('[data-return-direction]')).toHaveCount(0);
 await earnings.focus();
 await expect(earnings.locator('[data-return-direction]')).toHaveCount(0);
 await expect(earnings).not.toHaveAttribute('title',/Daily/);
 await earnings.press('Enter');
 await expect(earnings.locator('[data-return-direction]')).toHaveCount(0);
 const closed=timeline.locator('[data-event-type="financing"]');await closed.focus();await expect(closed.locator('[data-return-direction]')).toHaveCount(0);
 const business=timeline.getByRole('button',{name:/2 events · Business/});await business.focus();
 await expect(business.locator('[data-return-direction]')).toHaveCount(0);
 await business.click();
 const chooser=page.getByRole('group',{name:'Choose an event'});
 await expect(chooser.locator('[data-return-direction="down"]')).toContainText('Since pub. (2d): ▼ -1.80%');
 await expect(chooser.locator('[data-return-direction]')).toHaveCount(1);
 await chooser.getByRole('button',{name:'Close event list',exact:true}).click();
 const svg=timeline.locator('svg');await svg.scrollIntoViewIfNeeded();
 const bounds=(await svg.boundingBox())!;
 const selectDay=async(index:number)=>{
   await svg.scrollIntoViewIfNeeded();
   const currentBounds=(await svg.boundingBox())!;
   const cx=Number(await svg.locator('circle').nth(index).getAttribute('cx'));
   const viewWidth=await svg.evaluate(el=>(el as SVGSVGElement).viewBox.baseVal.width);
   await page.mouse.click(currentBounds.x+cx/viewWidth*currentBounds.width,currentBounds.y+currentBounds.height-24);
 };
 const tooltip=timeline.getByRole('group',{name:'Price details'});
 await svg.hover({position:{x:bounds.width/2,y:bounds.height-24}});await expect(tooltip).toHaveCount(0);
 await selectDay(0);await expect(tooltip).toBeVisible();
 await page.mouse.move(bounds.x+bounds.width-25,bounds.y+bounds.height-24);await expect(tooltip).toContainText('2026-09-30');
 await tooltip.getByRole('button',{name:'Close price details'}).click();await expect(tooltip).toHaveCount(0);await expect(svg).toBeFocused();
 await svg.press('Enter');await expect(tooltip).toContainText('2026-10-06');await svg.press('ArrowLeft');await expect(tooltip).toContainText('2026-10-05');await svg.press('Escape');await expect(tooltip).toHaveCount(0);
 await selectDay(0);await page.getByRole('button',{name:'Candles',exact:true}).click();await expect(tooltip).toHaveCount(0);
 await selectDay(0);await expect(tooltip).toContainText('2026-09-30');await expect(tooltip).not.toContainText('Daily change');await expect(tooltip.locator('[data-latest-return]')).toContainText('Change to latest close (Oct 6) · ▲ +6.00%');
 await selectDay(1);await expect(tooltip).toContainText('Daily change · ▲ +4.00%');await expect(tooltip.locator('[data-daily-return][data-return-direction="up"]')).toHaveCSS('color','rgb(85, 223, 187)');
 await selectDay(2);await expect(tooltip).toContainText('Daily change · ▼ -0.96%');await expect(tooltip.locator('[data-daily-return][data-return-direction="down"]')).toHaveCSS('color','rgb(255, 142, 161)');
 // This recorded trading day has no event, but still gets a daily change.
 await selectDay(3);await expect(tooltip).toContainText('2026-10-05');await expect(tooltip).toContainText('Daily change · ▲ +2.91%');await expect(tooltip).toContainText('Volume · 40');
 await selectDay(4);await expect(tooltip).toContainText('Daily change · — 0.00%');await expect(tooltip.locator('[data-latest-return]')).toContainText('— 0.00%');
 await earnings.focus();await expect(tooltip).toHaveCount(0);await expect(earnings.locator('[data-return-direction]')).toHaveCount(0);
});

test('long price gaps connect recorded closes without synthetic bars',async({page})=>{
 await open(page);
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:'US:MU',start:'2026-09-11',end:'2026-10-11',currency:'USD',available:true,prices:[{date:'2026-09-28',close:100,volume:10},{date:'2026-10-08',close:102,volume:20}]}}));
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=page.getByPlaceholder('Search company / ticker');await search.fill('MU');await search.press('Enter');
 const timeline=page.locator('[data-company-timeline="US:MU"]');
 await expect(timeline).toContainText('2 stored daily bars');
 await expect(timeline.locator('[data-price-gap]')).toHaveAttribute('d',/^M[\d.,]+ L[\d.,]+$/);
 await expect(timeline.locator('[data-price-gap]')).toHaveAttribute('stroke-dasharray','4 4');
 await expect(timeline.locator('svg rect')).toHaveCount(2);
 await timeline.locator('svg').scrollIntoViewIfNeeded();
 const bounds=(await timeline.locator('svg').boundingBox())!;
 await page.mouse.click(bounds.x+bounds.width*.82,bounds.y+bounds.height-24);
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('2026-10-08');
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('Close · $102.00');
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('Change since 2026-09-28 · ▲ +2.00%');
 await expect(timeline.getByRole('group',{name:'Price details'})).not.toContainText('Daily change');
 const tooltipBounds=(await timeline.getByRole('group',{name:'Price details'}).boundingBox())!;
 expect(tooltipBounds.x).toBeGreaterThanOrEqual(bounds.x);
 expect(tooltipBounds.x+tooltipBounds.width).toBeLessThanOrEqual(bounds.x+bounds.width);
});

test('exact ticker search emphasizes connected graph nodes like a node click',async({page},info)=>{
 test.skip(info.project.name!=='desktop','Actual WebGL selection regression');
 test.setTimeout(60000);
 await page.setViewportSize({width:1500,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 const fixture:IntelligenceSnapshot={...snapshot,graph:{...snapshot.graph,relationships:[{id:'memory-partner',source:'US:MU',target:'US:MEM',type:'PARTNER_OF',summary:'Memory partnership',commercialStatus:'DOCUMENTED',sourceIds:[]}]}};
 const body=await workspaceFixture(true,fixture);
 await page.route('**/*',route=>route.request().url().includes('/api/intelligence')?route.fulfill({json:fixture}):route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body}):route.fulfill({status:404,body:''}));
 await page.goto('http://workspace.test/?view=graph');
 await expect(page.locator('canvas')).toHaveAttribute('data-camera-position',/.+/);
 const search=page.getByPlaceholder('Search company / ticker');
 await search.fill('mu');await search.press('Enter');await search.blur();
 await expect(page.locator('[data-company-id="US:MU"]')).toHaveAttribute('data-company-focus','selected');
 const partner=page.locator('[data-company-id="US:MEM"]');
 await expect(partner).toHaveAttribute('data-company-focus','connected');
 await expect.poll(()=>partner.evaluate(el=>el.style.getPropertyValue('--label-emphasis'))).toBe('');
 await expect(page.getByRole('region',{name:'Company details',exact:true})).toContainText('Memory partnership');
});

test('graph automatic orbit pauses for focused search and resumes on blur',async({page})=>{
 const body=await workspaceFixture(true);
 await page.route('**/*',route=>route.request().url().includes('/api/intelligence')?route.fulfill({json:snapshot}):route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body}):route.fulfill({status:404,body:''}));
 await page.goto('http://workspace.test/?view=graph');
 const canvas=page.locator('[data-graph-interaction] canvas');
 await expect(canvas).toHaveAttribute('data-rotation','intro');
 const expand=page.getByRole('button',{name:'Expand left panel',exact:true});
 if(await expand.isVisible())await expand.click();
 const search=page.getByRole('textbox',{name:'Search companies'});
 await search.focus();
 await expect(canvas).toHaveAttribute('data-rotation','input');
 await expect(page.locator('[data-company-id]').first()).toHaveCSS('transition-duration','0s');
 await search.fill('M');
 await expect(page).toHaveURL(/q=M/);
 await expect(page.getByRole('complementary',{name:'Events and sources'}).locator('[data-loading-spinner]')).toHaveCount(0);
 await expect(canvas).toHaveAttribute('data-camera','idle');
 await page.waitForTimeout(100);
 const paused=await canvas.getAttribute('data-camera-position');
 await page.waitForTimeout(300);
 await expect(canvas).toHaveAttribute('data-camera-position',paused!);
 await search.blur();
 await expect(canvas).toHaveAttribute('data-rotation','intro');
 await expect.poll(()=>canvas.getAttribute('data-camera-position')).not.toBe(paused);
});

test('universe is usable before events arrive and pending totals are not zero counts',async({page})=>{
 const body=await workspaceFixture(false,snapshot,false);
 const bootstrap={...snapshot,events:[],sourceDocuments:[],coverage:[],eventsPending:true,statisticsComplete:false};
 let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/*',async route=>{
  if(route.request().url().includes('/api/intelligence')){
   if(new URL(route.request().url()).searchParams.get('section')==='universe')return route.fulfill({json:bootstrap});
   await ready;return route.fulfill({json:snapshot});
  }
  return route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body}):route.fulfill({status:404,body:''});
 });
 await page.goto('http://workspace.test/?view=table');
 const panel=page.getByRole('complementary',{name:'Events and sources'});
 await expect(panel.getByText('Loading events and sources…')).toBeVisible();
 const companyList=page.getByRole('region',{name:'Company list',exact:true});
 await expect(companyList.getByRole('button',{name:'Micron',exact:true})).toBeVisible();
 await expect(panel.getByText('0 loaded source documents',{exact:true})).toHaveCount(0);
 await expect(panel.getByText('No new events in the available records today.')).toHaveCount(0);
 await companyList.getByRole('button',{name:'Micron',exact:true}).click();
 await expect(page.getByRole('region',{name:'Company details',exact:true})).toContainText('Micron');
 release();
 await expect(panel.getByRole('button',{name:/Published company update 1 /})).toBeVisible();
 await expect(panel.getByText('Loading events and sources…')).toHaveCount(0);
 await expect(page.getByRole('region',{name:'Company details',exact:true})).toContainText('Micron');
});

test('late universe response cannot replace a completed event feed',async({page})=>{
 const body=await workspaceFixture(false,snapshot,false);
 let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/*',async route=>{
  if(route.request().url().includes('/api/intelligence')){
   if(new URL(route.request().url()).searchParams.get('section')==='universe'){await ready;return route.fulfill({json:{...snapshot,events:[],sourceDocuments:[],eventsPending:true}});}
   return route.fulfill({json:snapshot});
  }
  return route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body}):route.fulfill({status:404,body:''});
 });
 await page.goto('http://workspace.test/?view=table');
 const panel=page.getByRole('complementary',{name:'Events and sources'});
 await expect(panel.getByText('200 loaded source documents',{exact:true})).toBeVisible();
 release();await page.waitForTimeout(100);
 await expect(panel.getByText('200 loaded source documents',{exact:true})).toBeVisible();
 await expect(panel.getByText('Loading events and sources…')).toHaveCount(0);
});

test('company changes retain the pending unscoped universe instead of the previous company feed',async({page})=>{
 const body=await workspaceFixture(false,snapshot,false);
 let releaseFirst!:()=>void,releaseNext!:()=>void;
 const first=new Promise<void>(resolve=>{releaseFirst=resolve;}),next=new Promise<void>(resolve=>{releaseNext=resolve;});
 await page.route('**/*',async route=>{
  if(route.request().url().includes('/api/intelligence')){
   const params=new URL(route.request().url()).searchParams,company=params.get('company');
   if(params.get('section')==='universe')return route.fulfill({json:{...snapshot,events:[],sourceDocuments:[],coverage:[],eventsPending:true}});
   await (company==='US:MU'?first:next);
   return route.fulfill({json:{...snapshot,events:company?snapshot.events.filter(event=>event.companyIds.includes(company)):snapshot.events}});
  }
  return route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body}):route.fulfill({status:404,body:''});
 });
 await page.goto('http://workspace.test/?view=table&company=US%3AMU');
 const panel=page.getByRole('complementary',{name:'Events and sources'}),card=page.getByRole('region',{name:'Company details',exact:true});
 await expect(panel.getByText('Loading events and sources…')).toBeVisible();
 releaseFirst();await panel.getByRole('button',{name:'30d',exact:true}).click();
 await expect(panel.getByRole('button',{name:/Published company update 1 /})).toBeVisible();
 // Selection clears immediately, while the next unscoped feed is held back.
 await card.getByRole('button',{name:'Close company details',exact:true}).click();
 await expect(panel.getByText('Loading events and sources…')).toBeVisible();
 await expect(panel.getByRole('button',{name:/Published company update 1 /})).toHaveCount(0);
 await page.getByRole('region',{name:'Company list',exact:true}).getByRole('button',{name:'Lumentum',exact:true}).click();
 await expect(card).toContainText('Lumentum');await expect(panel.getByText('Loading events and sources…')).toBeVisible();
 releaseNext();await expect(panel.getByRole('button',{name:/Lumentum communication update/})).toBeVisible();
 await expect(panel.getByText('Loading events and sources…')).toHaveCount(0);
});

for(const zh of [false,true])test('grouped announcement shows one event, two source documents and both reference links in '+(zh?'Chinese':'English'),async({page})=>{
 const title='AMD to Report Fiscal Third Quarter 2026 Financial Results';
 const a={...events[0],id:'news-company_news_ir',origin:'US:AMD',companyIds:['US:AMD'],title,titleZh:'AMD将公布2026财年第三季度财务业绩',summary:'Official company news. Open the source for details.',publication_date:'2026-10-02',published_at:'2026-10-02T20:15:00.000Z',eventDate:'2026-10-02',evidence:[{id:'company_news_ir',title,url:'https://ir.amd.com/release',sourceDate:'2026-10-02',channel:'IR'}],calendarEvents:[{id:'scheduled_event_amd_call',companyId:'US:AMD',day:'2026-11-03'}]} as IntelligenceSnapshot['events'][number];
 const b={...a,id:'news-company_news_newsroom',published_at:'2026-10-02T00:00:00.000Z',publication_date:'2026-10-01',evidence:[{...a.evidence[0],id:'company_news_newsroom',url:'https://newsroom.amd.com/release'}]};
 const grouped=groupCompanyAnnouncements(mergeIntelligenceEvents([a,b],[]));
 const fixture={...snapshot,events:grouped,sourceDocuments:sourceDocumentsForEvents(grouped),graph:{...snapshot.graph,nodes:[...companies,{id:'US:AMD',symbol:'AMD',name:'AMD',kind:'COMPANY',stageIds:['compute']}]}} as IntelligenceSnapshot;
 await open(page,zh,fixture);
 const panel=page.getByRole('complementary',{name:'Events and sources'}),label=zh?a.titleZh!:title;
 const row=panel.getByRole('button',{name:new RegExp(label)});
 await expect(row).toHaveCount(1);await expect(row).toContainText(zh?'2 份来源文档':'2 source documents');
 await expect(panel.getByText(zh?'2 份已加载来源文档':'2 loaded source documents',{exact:true})).toBeVisible();
 await expect(panel.getByText(zh?'来源文档':'Source documents',{exact:true}).locator('..').locator('strong')).toHaveText('2');
 await expect(panel.locator('a[href*="event=scheduled_event_amd_call"]')).toHaveCount(1);
 await row.click();
 const card=page.getByRole('dialog',{name:zh?'事件详情':'Event details',exact:true});
 await expect(card.locator('a[href="https://ir.amd.com/release"]').first()).toBeVisible();
 await expect(card.locator('a[href="https://newsroom.amd.com/release"]')).toHaveCount(1);
 // A bookmark to the former duplicate still opens the grouped announcement.
 await page.goto(`http://workspace.test/?${zh?'lang=zh-CN&':''}event=${b.id}&company=US%3AAMD`);
 await expect(card).toContainText(label);await expect(row).toHaveAttribute('aria-pressed','true');
});

test('company feed fetches older matching documents before the global cap and restores the full feed',async({page})=>{
 const arm={id:'US:ARM',symbol:'ARM',name:'Arm',kind:'COMPANY',order:5,stageIds:['compute']};
 const older=Array.from({length:12},(_,i)=>({...events[0],id:`arm-${i}`,origin:arm.id,companyIds:[arm.id],calendarEvents:undefined,title:`Older ARM document ${i+1}`,evidence:[{...events[0].evidence[0],url:`https://investors.example.com/arm-${i}`}]}));
 const fixture={...snapshot,graph:{...snapshot.graph,nodes:[...companies,arm]},sourceDocuments:[...snapshot.sourceDocuments!,...older.map(event=>({id:event.evidence[0].url,channel:'IR',companyIds:event.companyIds,published_at:null,publication_date:event.publication_date}))]} as IntelligenceSnapshot;
 const body=await workspaceFixture(false,fixture);
 const requested:string[]=[];
 await page.route('**/*',route=>{
   if(route.request().url().includes('/api/intelligence')){
     const params=new URL(route.request().url()).searchParams;
     const company=params.get('company')||(params.get('q')==='ARM'?'US:ARM':'');requested.push(company);
     return route.fulfill({json:company==='US:ARM'?{...fixture,events:older,truncated:false}:company==='US:MU'?{...fixture,events:events.filter(event=>event.companyIds.includes(company))}:fixture});
   }
   return route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body}):route.fulfill({status:404,body:''});
 });
 await page.goto('http://workspace.test/');
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const panel=page.getByRole('complementary',{name:'Events and sources'});
 const left=page.getByRole('complementary',{name:'Universe navigation'});
 await left.getByRole('combobox',{name:'Region',exact:true}).selectOption('US');
 await left.getByRole('button',{name:/ARM.*Arm/}).click();
 await expect(panel.getByRole('button',{name:/Older ARM document/})).toHaveCount(12);
 expect(requested).toContain('US:ARM');
 await expect(panel.getByText('12 loaded source documents',{exact:true})).toBeVisible();
 await expect(panel.getByText('Source documents',{exact:true}).locator('..')).toContainText('12');
 await page.reload();
 await expect(panel.getByRole('button',{name:/Older ARM document/})).toHaveCount(12);
 await panel.getByRole('button',{name:'Clear company event filter'}).click();
 await expect(panel.getByRole('button',{name:/Published company update/})).toHaveCount(198);
 await expect(panel.getByRole('button',{name:/Older ARM document/})).toHaveCount(0);
 const search=page.getByPlaceholder('Search company / ticker');
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 await search.click();
 const beforeSearch=requested.length;
 await search.pressSequentially('ARM',{delay:60});
 expect(requested.length).toBe(beforeSearch);
 await expect(search).toHaveValue('ARM');
 await expect(panel.getByRole('button',{name:/Older ARM document/})).toHaveCount(12);
 await expect(page).toHaveURL(/q=ARM/);
 await expect(panel.getByText('12 loaded source documents',{exact:true})).toBeVisible();
 await page.reload();await expect(panel.getByRole('button',{name:/Older ARM document/})).toHaveCount(12);
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 await search.fill('');await search.press('Enter');
 await expect(panel.getByRole('button',{name:/Published company update/})).toHaveCount(198);
 await expect(panel.getByRole('button',{name:/Older ARM document/})).toHaveCount(0);
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 await left.getByRole('button',{name:/MU.*Micron/}).click();
 await expect.poll(()=>requested.at(-1)).toBe('US:MU');
 await expect(panel.getByRole('button',{name:/Older ARM document/})).toHaveCount(0);
});

for(const zh of [false,true])test('region filter keeps companies, feed and complete source counts aligned in '+(zh?'Chinese':'English'),async({page})=>{
 const marketNodes=[...companies,{id:'XSHG:688072',symbol:'688072',name:'Piotech',kind:'COMPANY',stageIds:['memory']},{id:'XSHE:300308',symbol:'300308',name:'Innolight',kind:'COMPANY',stageIds:['optics']},{id:'PRIVATE:OPENAI',name:'OpenAI',kind:'COMPANY',stageIds:['compute']}];
 const marketEvents=[['us','US:MU'],['shanghai','XSHG:688072'],['shenzhen','XSHE:300308'],['private','PRIVATE:OPENAI'],['mixed','US:MU']].map(([id,origin],i)=>({...events[0],id,origin,companyIds:id==='mixed'?['US:MU','XSHG:688072']:[origin],title:`Market event ${id}`,titleZh:undefined,titleEn:undefined,calendarEvents:undefined,publication_date:snapshot.session.date,evidence:[{...events[0].evidence[0],id:`market-${i}`,url:`https://investors.example.com/market-${i}`}]}));
 const prior={...marketEvents[0],id:'prior',title:'Prior US event',publication_date:'2026-10-02',evidence:[{...marketEvents[0].evidence[0],id:'prior',url:'https://investors.example.com/prior'}]};
 const fixture={...snapshot,graph:{...snapshot.graph,nodes:marketNodes},events:[...marketEvents,prior],sourceDocuments:[...marketEvents.map(e=>({id:e.evidence[0].url,channel:'IR',companyIds:e.companyIds,published_at:null,publication_date:e.publication_date})),{id:'extra-cn',channel:'IR',companyIds:['XSHG:688072'],published_at:null,publication_date:snapshot.session.date},{id:prior.evidence[0].url,channel:'IR',companyIds:prior.companyIds,published_at:null,publication_date:prior.publication_date}]} as IntelligenceSnapshot;
 fixture.newsCoverage={total:4,configured:3,healthy:2,companyIds:['US:MU','XSHG:688072','XSHE:300308','PRIVATE:OPENAI'],configuredCompanyIds:['US:MU','XSHG:688072','XSHE:300308'],healthyCompanyIds:['US:MU','XSHG:688072']};
 fixture.warnings=['Verified IR/news feeds cover 3 of 4 US-listed AI Map companies.','Company news collector freshness is unverified: US-only adapter.'];
 fixture.eventReturns={mixed:[{companyId:'US:MU',baselineDate:'2026-10-01',latestDate:'2026-10-02',baselineClose:100,latestClose:110,change:.1,dateOnly:true},{companyId:'XSHG:688072',baselineDate:'2026-10-01',latestDate:'2026-10-02',baselineClose:100,latestClose:120,change:.2,dateOnly:true}]};
 fixture.events[4].calendarEvents=[{id:'us-calendar',companyId:'US:MU',day:'2026-10-28'},{id:'cn-calendar',companyId:'XSHG:688072',day:'2026-10-28'}];
 await open(page,zh,fixture);
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const panel=page.getByRole('complementary',{name:'Events and sources'}),filter=page.getByRole('complementary',{name:'Universe navigation'}).getByRole('combobox',{name:zh?'地区':'Region'});
 const documents=panel.getByText(zh?'来源文档':'Source documents',{exact:true}).locator('..');
 await expect(filter).toHaveValue('');await expect(documents).toContainText('6');
 await expect(panel.getByText(fixture.warnings[1],{exact:true})).toHaveCount(1);
 const news=page.getByLabel(zh?'公司新闻采集覆盖':'Company news collector coverage');await expect(news).toContainText('3/4');
 await expect(panel.getByRole('button',{name:/Market event /})).toHaveCount(5);
 await filter.selectOption('US');await expect(page).toHaveURL(/region=US/);
 await expect(documents).toContainText('2');await expect(panel.getByRole('button',{name:/Market event /})).toHaveCount(2);
 await expect(news).toContainText('1/1');await expect(panel.locator('a[href*="event=cn-calendar"]')).toHaveCount(0);
 await expect(panel.getByText(fixture.warnings[1],{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Theme activity summary').locator('span[role=img]')).toHaveCount(0);
 await expect(panel.getByRole('button',{name:/Market event private|Market event shanghai|Market event shenzhen/})).toHaveCount(0);
 await panel.getByRole('button',{name:/Market event mixed/}).click();
 await expect(page.getByRole('region',{name:'Company details',exact:true})).toBeVisible();
 await expect(page.getByRole('dialog',{name:zh?'事件详情':'Event details',exact:true})).toContainText('+10.00%');
 await filter.selectOption('CN_A');
 await expect(page.getByRole('region',{name:'Company details',exact:true})).toHaveCount(0);
 await expect(documents).toContainText('4');await expect(panel.getByRole('button',{name:/Market event /})).toHaveCount(3);
 await expect(news).toContainText('2/2');await expect(panel.locator('a[href*="event=us-calendar"]')).toHaveCount(0);
 await expect(panel.getByText(fixture.warnings[0],{exact:true})).toHaveCount(0);
 await expect(panel.getByText(fixture.warnings[1],{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Theme activity summary').locator('span[role=img]')).toHaveCount(1);
 await expect(panel.getByRole('button',{name:/Market event mixed/})).toBeVisible();
 await panel.getByRole('button',{name:/Market event mixed/}).click();
 const mixedCard=page.getByRole('dialog',{name:zh?'事件详情':'Event details',exact:true});await expect(page.getByRole('region',{name:'Company details',exact:true}).locator('[data-card-drag]')).toContainText('Piotech');await expect(mixedCard).toContainText('+20.00%');await expect(mixedCard).not.toContainText('+10.00%');await mixedCard.press('Escape');
 await page.getByRole('tab',{name:zh?'公司列表':'Company list',exact:true}).click();
 await expect(page.locator('[data-list-company]')).toHaveCount(2);
 await panel.getByRole('button',{name:zh?'近 30 天':'30d',exact:true}).click();await expect(filter).toHaveValue('CN_A');await expect(documents).toContainText('4');
 await page.reload();if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();await expect(filter).toHaveValue('CN_A');await expect(page.locator('[data-list-company]')).toHaveCount(2);
 await filter.selectOption('US');await expect(documents).toContainText('2');
 await panel.getByRole('button',{name:zh?'近 30 天':'30d',exact:true}).click();await expect(documents).toContainText('3');await expect(panel.getByRole('button',{name:/Prior US event/})).toBeVisible();
 await filter.selectOption('');await expect(page).not.toHaveURL(/region=/);await expect(documents).toContainText('7');await expect(panel.getByRole('button',{name:/Market event private/})).toBeVisible();await expect(page.locator('[data-list-company]')).toHaveCount(marketNodes.length);
 await expect(panel.getByText(fixture.warnings[1],{exact:true})).toHaveCount(1);
});

test('source status distinguishes missing regional metadata from an empty regional coverage set',async({page})=>{
 const fixture={...snapshot,graph:{...snapshot.graph,nodes:[...companies,{id:'XSHG:688072',name:'Piotech',kind:'COMPANY',stageIds:['memory']}]},newsCoverage:{total:4,configured:3,healthy:2},warnings:['Verified IR/news feeds cover 3 of 4 US-listed AI Map companies.','Company news collector freshness is unverified: US-only adapter.']} as IntelligenceSnapshot;
 const region=page.getByRole('combobox',{name:'Region',exact:true}),panel=page.getByRole('complementary',{name:'Events and sources'}),indicator=page.getByLabel('Theme activity summary').locator('span[role=img]');
 await open(page,false,fixture);if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();await region.selectOption('US');
 await expect(panel.getByText(fixture.warnings[0],{exact:true})).toHaveCount(1);await expect(panel.getByText(fixture.warnings[1],{exact:true})).toHaveCount(1);await expect(indicator).toHaveCount(1);
 fixture.newsCoverage={...fixture.newsCoverage!,companyIds:companies.map(c=>c.id),configuredCompanyIds:companies.slice(0,3).map(c=>c.id),healthyCompanyIds:companies.slice(0,2).map(c=>c.id)};
 await open(page,false,fixture);if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();await region.selectOption('CN_A');
 await expect(panel.getByText(fixture.warnings[0],{exact:true})).toHaveCount(0);await expect(panel.getByText(fixture.warnings[1],{exact:true})).toHaveCount(0);await expect(indicator).toHaveCount(0);await expect(page.getByLabel('Company news collector coverage')).toHaveCount(0);
});

for(const zh of [false,true])test('company selection scopes events and activity through periods and event clicks in '+(zh?'Chinese':'English'),async({page})=>{
 const nodes=[...companies,{id:'US:AAPL',name:'Apple',symbol:'AAPL',kind:'COMPANY',stageIds:['compute']},{id:'XSHG:688072',name:'Piotech',symbol:'688072',kind:'COMPANY',stageIds:['memory']}];
 const updates=[['apple','US:AAPL'],['micron','US:MU'],['mixed','US:MU'],['china','XSHG:688072'],['prior','US:AAPL']].map(([id,origin])=>({...events[0],id,origin,companyIds:id==='mixed'?['US:MU','US:AAPL']:[origin],title:`Company event ${id}`,publication_date:id==='prior'?'2026-10-02':snapshot.session.date,calendarEvents:undefined,evidence:[{...events[0].evidence[0],url:`https://investors.example.com/company-${id}`}]}));
 const fixture={...snapshot,graph:{...snapshot.graph,nodes},events:updates,sourceDocuments:[...updates.map(e=>({id:e.evidence[0].url,channel:'IR',companyIds:e.companyIds,published_at:null,publication_date:e.publication_date})),{id:'outside-loaded-feed',channel:'IR',companyIds:['US:AAPL'],published_at:null,publication_date:snapshot.session.date}],eventReturns:{mixed:[{companyId:'US:AAPL',baselineDate:'2026-10-01',latestDate:'2026-10-02',baselineClose:100,latestClose:120,change:.2,dateOnly:true},{companyId:'US:MU',baselineDate:'2026-10-01',latestDate:'2026-10-02',baselineClose:100,latestClose:110,change:.1,dateOnly:true}]}} as IntelligenceSnapshot;
 fixture.events[2].calendarEvents=[{id:'apple-calendar',companyId:'US:AAPL',day:'2026-10-28'},{id:'micron-calendar',companyId:'US:MU',day:'2026-10-28'}];
 await open(page,zh,fixture);
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const left=page.getByRole('complementary',{name:'Universe navigation'}),panel=page.getByRole('complementary',{name:'Events and sources'}),region=left.getByRole('combobox',{name:zh?'地区':'Region'});
 const count=panel.getByText(zh?'来源文档':'Source documents',{exact:true}).locator('..').locator('strong');
 await region.selectOption('US');
 const apple=left.getByRole('button',{name:/AAPL.*Apple/});await apple.click();await expect(apple).toHaveAttribute('aria-pressed','true');
 await expect(count).toHaveText('3');await expect(panel.getByText(zh?'活跃公司':'Active companies',{exact:true}).locator('..').locator('strong')).toHaveText('1');
 await expect(panel.getByRole('button',{name:/Company event /})).toHaveCount(2);await expect(panel.getByRole('button',{name:/Company event micron|Company event china/})).toHaveCount(0);
 await expect(panel.locator('a[href*="event=micron-calendar"]')).toHaveCount(0);await expect(panel.locator('a[href*="event=apple-calendar"]')).toHaveCount(1);
 await panel.getByRole('button',{name:zh?'近 30 天':'30d',exact:true}).click();await expect(apple).toHaveAttribute('aria-pressed','true');await expect(count).toHaveText('4');await expect(panel.getByRole('button',{name:/Company event prior/})).toBeVisible();
 await panel.getByRole('button',{name:/Company event mixed/}).click();const card=page.getByRole('region',{name:'Company details',exact:true});await expect(card.locator('[data-card-drag]')).toContainText('Apple');await expect(page.getByRole('dialog',{name:zh?'事件详情':'Event details',exact:true})).toContainText('+20.00%');await expect(page.getByRole('dialog',{name:zh?'事件详情':'Event details',exact:true})).not.toContainText('+10.00%');await expect(count).toHaveText('4');await expect(panel.getByRole('button',{name:/Company event micron/})).toHaveCount(0);
 await card.getByRole('button',{name:'Close company details',exact:true}).click();await expect(count).toHaveText('5');await expect(panel.getByRole('button',{name:/Company event micron/})).toBeVisible();await expect(apple).toHaveAttribute('aria-pressed','false');
 await apple.click();await page.reload();if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();await expect(apple).toHaveAttribute('aria-pressed','true');await expect(panel.getByRole('button',{name:/Company event micron/})).toHaveCount(0);
 await panel.getByRole('button',{name:zh?'清除公司事件筛选':'Clear company event filter'}).click();await expect(panel.getByRole('button',{name:/Company event micron/})).toBeVisible();
 await apple.click();await region.selectOption('CN_A');await expect(panel.getByRole('button',{name:zh?'清除公司事件筛选':'Clear company event filter'})).toHaveCount(0);await expect(panel.getByRole('button',{name:/Company event china/})).toBeVisible();await expect(panel.getByRole('button',{name:/Company event apple/})).toHaveCount(0);
 await region.selectOption('US');await left.getByRole('button',{name:/LITE.*Lumentum/}).click();await expect(page.getByLabel('Theme activity summary').getByRole('button',{name:/Source documents|来源文档/}).locator('strong')).toHaveText('0');await expect(panel.getByRole('button',{name:/Company event /})).toHaveCount(0);
});

test('region selection rebuilds the real graph with only matching companies',async({page},info)=>{
 test.skip(info.project.name!=='desktop','One shared WebGL regression');
 await page.setViewportSize({width:1500,height:900});
 const fixture={...snapshot,graph:{...snapshot.graph,nodes:[...companies,{id:'XSHG:688072',name:'Piotech',symbol:'688072',kind:'COMPANY',stageIds:['memory']},{id:'XSHE:300308',name:'Innolight',symbol:'300308',kind:'COMPANY',stageIds:['optics']} ]}} as IntelligenceSnapshot;
 const body=await workspaceFixture(true,fixture);
 await page.route('**/*',route=>route.request().url().includes('/api/intelligence')?route.fulfill({json:fixture}):route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body}):route.fulfill({status:404,body:''}));
 await page.goto('http://workspace.test/?view=graph');
 await expect(page.locator('[data-company-id]')).toHaveCount(6);
 const filter=page.getByRole('combobox',{name:'Region',exact:true});
 await filter.selectOption('CN_A');await expect(page.locator('[data-company-id]')).toHaveCount(2);await expect(page.locator('[data-company-id^="US:"]')).toHaveCount(0);
 await filter.selectOption('US');await expect(page.locator('[data-company-id]')).toHaveCount(4);await expect(page.locator('[data-company-id^="XSHG:"]')).toHaveCount(0);
 await filter.selectOption('');await expect(page.locator('[data-company-id]')).toHaveCount(6);
 await expect(page.locator('canvas')).toBeVisible();
 const theme=page.getByRole('combobox',{name:'Investment theme',exact:true}),themeBox=(await theme.locator('..').boundingBox())!,regionBox=(await filter.boundingBox())!;
 expect(Math.abs(themeBox.y-regionBox.y)).toBeLessThan(4);expect(themeBox.x+themeBox.width).toBeLessThan(regionBox.x);
});

test('first phone visit starts in List and explicit chart choices remain available',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await open(page);
  await expect(page.getByRole('tab',{name:'Company list',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('[data-view="graph"]')).toHaveCount(0);
  await page.goto('http://workspace.test/?view=graph');
  await expect(page.getByRole('tab',{name:'Relationship graph',exact:true})).toHaveAttribute('aria-selected','true');
});

test('news calendar icon links only confirmed schedules and does not select the news',async({page},info)=>{
  await open(page,info.project.name==='mobile');
  const link=page.getByRole('link',{name:info.project.name==='mobile'?'查看日历活动 · 2026-10-28':'View calendar event · 2026-10-28',exact:true});
  await expect(link).toHaveCount(1);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href',/\/calendar\?date=2026-10-28&company=US%3AMU&event=scheduled_event_micron_release$/);
  expect(await link.evaluate(element=>element.closest('button')===null)).toBe(true);
  await link.locator('..').locator('..').screenshot({path:info.outputPath('news-calendar-link.png')});
  await link.click();
  await expect(page).toHaveURL(/calendar\?date=2026-10-28&company=US%3AMU&event=scheduled_event_micron_release$/);
  // The fixture keeps Explore mounted on navigation; its calendar company
  // query can select MU, but clicking the icon must not activate the news.
  await expect(page.getByRole('button',{name:/Published company update 1 /})).toHaveAttribute('aria-pressed','false');
});

test('committed theme changes restart real chart tours and tree growth without replacing the workspace',async({page},info)=>{
  test.skip(info.project.name!=='desktop','One shared chart lifecycle regression');test.setTimeout(60000);
  await page.setViewportSize({width:1500,height:800});await accelerateTours(page);
  const realHtml=await workspaceFixture(true);
  const robotics:IntelligenceSnapshot={...snapshot,theme:'robotics',graphVersion:'robotics-lifecycle',graph:{...snapshot.graph,nodes:[
    {id:'US:NVDA',symbol:'NVDA',name:'NVIDIA',kind:'COMPANY',order:0,stageIds:['robotics:compute-control']},
    {id:'US:ROK',symbol:'ROK',name:'Rockwell',kind:'COMPANY',order:1,stageIds:['robotics:systems-integration']}]},events:[],sourceDocuments:[]};
  let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/*',async route=>{
    if(route.request().url().includes('/api/intelligence')){
      const theme=new URL(route.request().url()).searchParams.get('theme');
      if(theme==='robotics')await ready;
      return route.fulfill({json:theme==='robotics'?robotics:snapshot});
    }
    return route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:realHtml}):route.fulfill({status:404,body:''});
  });
  await page.goto('http://workspace.test/?view=graph');
  const workspace=await page.locator('main').elementHandle();
  const theme=page.getByRole('combobox',{name:'Investment theme',exact:true}),speed=page.getByRole('combobox',{name:'Tour speed'});
  await speed.selectOption('2');
  const canvas=page.locator('canvas');await expect(canvas).toHaveAttribute('data-camera-position',/.+/);
  const oldGraph=await canvas.elementHandle();
  await theme.selectOption('robotics');
  await expect(page.getByRole('status').filter({hasText:'Loading Robotics…'})).toBeVisible();
  expect(await oldGraph!.evaluate(element=>element.isConnected)).toBe(true);
  release();await expect(page.getByRole('status').filter({hasText:'Loading Robotics…'})).toHaveCount(0);
  await expect.poll(()=>oldGraph!.evaluate(element=>element.isConnected)).toBe(false);
  await expect(canvas).toHaveAttribute('data-camera-position',/.+/);
  const position=await canvas.getAttribute('data-camera-position');
  await expect.poll(()=>canvas.getAttribute('data-camera-position')).not.toBe(position);
  await expect(speed).toHaveValue('2');expect(await workspace!.evaluate(element=>element.isConnected)).toBe(true);
  await page.getByRole('tab',{name:'Industry tree',exact:true}).click();
  const tree=page.locator('[data-industry-section="vertical"]');
  await expect(tree.locator('canvas')).toHaveAttribute('data-tour','playing');
  await expect(tree.locator('[data-tree-node="root"]')).toContainText('Robotics industry');
  const oldTree=await tree.locator('canvas').elementHandle();
  await theme.selectOption('ai');
  await expect.poll(()=>oldTree!.evaluate(element=>element.isConnected)).toBe(false);
  await expect(tree.locator('canvas')).toHaveAttribute('data-tour','playing');
  await tree.getByRole('button',{name:'Expand all',exact:true}).click();
  await expect(tree.locator('[data-tree-company="US:MU"]')).toBeAttached();
  await expect(tree.locator('[data-tree-node^="robotics:"]')).toHaveCount(0);
  await theme.selectOption('robotics');
  await expect(tree.locator('[data-tree-node="root"]')).toContainText('Robotics industry');
  await expect(tree.locator('canvas')).toHaveAttribute('data-tour','playing');
  await tree.getByRole('button',{name:'Expand all',exact:true}).click();
  await expect(tree.locator('[data-tree-company="US:ROK"]')).toBeAttached();
  await expect(tree.locator('[data-tree-company="US:MU"]')).toHaveCount(0);
  const treePosition=await tree.locator('canvas').getAttribute('data-camera-position');
  await expect.poll(()=>tree.locator('canvas').getAttribute('data-camera-position')).not.toBe(treePosition);
  await expect(page.getByRole('tab',{name:'Industry tree',exact:true})).toHaveAttribute('aria-selected','true');
  expect(await workspace!.evaluate(element=>element.isConnected)).toBe(true);
});
test('shared periods, exact ticker search and selected sources remain visible above a capped feed',async({page},info)=>{
  test.skip(info.project.name!=='desktop','Desktop workspace checks');await page.clock.install({time:new Date('2026-10-04T16:00:00Z')});await page.setViewportSize({width:1500,height:800});await open(page);
  const panel=page.getByRole('complementary',{name:'Events and sources'});
  const theme=page.getByRole('combobox',{name:'Investment theme',exact:true});
  await expect(theme).toBeVisible();
  await expect(theme).toHaveValue('ai');
  await expect(theme.getByRole('button')).toHaveCount(0);
  const tabs=page.getByRole('tablist');
  await expect(tabs.getByRole('tab')).toHaveCount(4);
  await expect(theme).toHaveCount(1); // No duplicate theme indicator while the left panel is open.
  await page.setViewportSize({width:875,height:800});
  await page.getByRole('button',{name:'Expand left panel',exact:true}).click();
  const graphTab=page.getByRole('tab',{name:'Relationship graph',exact:true});
  const toolbar=graphTab.locator('xpath=../../..');
  const controls=page.getByRole('combobox',{name:'Tour speed'}).locator('xpath=../../..');
  const tabsBounds=(await tabs.boundingBox())!,controlsBounds=(await controls.boundingBox())!,toolbarBounds=(await toolbar.boundingBox())!;
  expect(controlsBounds.x>=tabsBounds.x+tabsBounds.width||controlsBounds.y>=tabsBounds.y+tabsBounds.height).toBe(true);
  expect(controlsBounds.x+controlsBounds.width).toBeLessThanOrEqual(toolbarBounds.x+toolbarBounds.width);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:1500,height:800});
  await expect(panel.getByRole('button',{name:'30d',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(panel.getByText('Source documents',{exact:true}).locator('..')).toContainText('350');
  await expect(panel.getByText('200 loaded source documents')).toBeVisible();
  const firstEvent=panel.getByRole('button',{name:/Published company update 1 /});
  await expect(firstEvent.getByText('Memory & storage',{exact:true})).toBeVisible();
  await expect(firstEvent.locator('time')).toHaveText('2d');
  await expect(firstEvent.locator('time')).toHaveAttribute('title','Oct 2, 2026, 12:00:00 PM UTC');
  await expect(firstEvent.getByRole('button')).toHaveCount(0);
  await expect(panel.getByRole('button',{name:/Published company update 2 /}).locator('time')).toContainText('date only');
  const multiEvent=panel.getByRole('button',{name:/Published company update 2 /});
  const sectors=multiEvent.getByRole('group',{name:'Company sectors: Memory & storage / AI compute / Connectivity',exact:true});
  await expect(sectors).toHaveAttribute('title','Memory & storage / AI compute / Connectivity');
  await expect(sectors.getByText('Memory & storage',{exact:true})).toHaveCount(1);
  await expect(sectors.getByText('+1',{exact:true})).toBeVisible();
  await expect(sectors.getByLabel('Additional sectors: Connectivity')).toBeVisible();
  await expect(panel.getByText('Sector breakdown',{exact:true}).locator('..')).not.toHaveAttribute('open','');
  await expect(panel.getByText('Source status',{exact:true}).locator('..')).not.toHaveAttribute('open','');
  const input=page.getByPlaceholder('Search company / ticker');await input.fill('$ＭＵ');
  await expect(page.getByRole('button',{name:/MU Micron/}).first()).toBeVisible();
  const companyButtons=page.locator('[class*="companyList"]>div>button:first-child');await expect(companyButtons).toHaveCount(1);await expect(companyButtons.first()).toContainText('MU');
  await expect(panel.getByRole('button',{name:/Lumentum communication update/})).toHaveCount(0);
  await expect(panel.getByText('199 loaded source documents')).toBeVisible();
  await expect(panel.getByText('Source documents',{exact:true}).locator('..')).toContainText('349');
  await input.fill('communication');
  await expect(companyButtons).toHaveCount(1);await expect(companyButtons.first()).toContainText('LITE');
  await expect(panel.getByRole('button',{name:/Lumentum communication update/})).toBeVisible();
  await expect(panel.getByText('Source documents',{exact:true}).locator('..')).toContainText('1');
  await input.fill('');
  await panel.getByRole('button',{name:/Published company update 1 /}).click();
  const selection=page.getByRole('dialog',{name:'Event details',exact:true});await expect(selection).toBeVisible();await expect(selection).toBeFocused();
  await expect(panel.getByRole('region',{name:'Company details'})).toHaveCount(0);
  const bounds=(await selection.boundingBox())!,rowBounds=(await panel.getByRole('button',{name:/Published company update 1 /}).boundingBox())!;expect(bounds.y).toBeGreaterThanOrEqual(12);expect(bounds.y+bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height-11);expect(Math.hypot(Math.max(bounds.x-rowBounds.x-rowBounds.width/2,0,rowBounds.x+rowBounds.width/2-bounds.x-bounds.width),Math.max(bounds.y-rowBounds.y-rowBounds.height/2,0,rowBounds.y+rowBounds.height/2-bounds.y-bounds.height))).toBeLessThan(36);
  await expect(selection.getByRole('link',{name:/Original release 1/})).toBeVisible();
  const graphSource=selection.getByRole('link',{name:/Original release 1/});
  await expect(graphSource).toHaveAttribute('href','https://investors.example.com/0');
  await expect(graphSource).toHaveAttribute('target','_blank');
  expect(await graphSource.evaluate(element=>getComputedStyle(element).pointerEvents)).toBe('auto');
  await page.context().route('https://investors.example.com/0',route=>route.fulfill({contentType:'text/html',body:'<h1>Original source document</h1>'}));
  const opened=page.waitForEvent('popup');await graphSource.click();const sourceTab=await opened;
  await expect(sourceTab).toHaveURL('https://investors.example.com/0');await sourceTab.close();
  await expect(selection).toBeVisible();
  await page.getByRole('tab',{name:'Company list',exact:true}).click();
  await expect(page.locator('[data-list-company="US:MU"]')).toHaveAttribute('data-selected','true');
  await expect(page.getByRole('navigation',{name:'Company list pagination'})).toContainText('of 4 companies');
  await expect(selection).toHaveCount(0);
  await page.getByRole('tab',{name:'Company hierarchy',exact:true}).click();
  await expect(page.locator('[data-industry-tree="hierarchy"] svg')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab',{name:'Industry tree',exact:true}).click();
  await expect(page.locator('[data-industry-tree="vertical"]')).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Tour speed'})).toBeVisible();
  await page.getByRole('tab',{name:'Relationship graph',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Relationship graph',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(selection).toHaveCount(0);
  await page.getByRole('tab',{name:'Company list',exact:true}).click();
  await input.fill('Micron');
  await expect(page.locator('[data-list-company]')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('tab',{name:'Company list',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('[data-list-company]')).toHaveCount(1);
  await page.locator('[data-list-company="US:MU"] button').click();
  const companyCard=page.getByRole('region',{name:'Company details',exact:true});
  await expect(companyCard.getByRole('link',{name:'Relationship sources ↗'})).toHaveAttribute('href','/en/ticker/MU');
  await expect(companyCard.getByRole('link',{name:'Bullish',exact:true})).toHaveAttribute('href',/ticker%3DMU/);
  await page.reload();await expect(companyCard.getByRole('link',{name:'Relationship sources ↗'})).toBeVisible();
  await input.fill('');
  await page.getByRole('button',{name:'Filter IR signals',exact:true}).click();
  await expect(page.locator('[data-list-company]')).toHaveCount(2);
  await expect(selection).toHaveCount(0);
  await page.getByRole('button',{name:'Clear activity filters',exact:true}).click();
  await expect(page.locator('[data-list-company]')).toHaveCount(4);
  await page.getByRole('tab',{name:'Relationship graph',exact:true}).click();
  await page.getByRole('tab',{name:'Relationship graph',exact:true}).press('End');
  await expect(page.getByRole('tab',{name:'Company list',exact:true})).toBeFocused();
  await expect(page.getByRole('tab',{name:'Company list',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:'Relationship graph',exact:true}).click();
  await panel.getByRole('button',{name:'Today',exact:true}).click();await expect(panel.getByText('350',{exact:true})).toHaveCount(0);await expect(panel.getByText('No new events in the available records today.')).toBeVisible();
});
test('mobile workspace exposes saved companies and event details retain their Chinese labels',async({page},info)=>{
  test.skip(info.project.name!=='mobile','Mobile workspace checks');await page.clock.install({time:new Date('2026-10-04T16:00:00Z')});await open(page,true);
  const center=page.getByRole('region',{name:'Graph universe'});
  await expect(center.getByRole('combobox',{name:'投资主题',exact:true})).toBeVisible();
  await center.getByRole('tab',{name:'公司列表',exact:true}).click();
  await expect(center.getByRole('region',{name:'公司列表',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await center.getByRole('tab',{name:'关系图谱',exact:true}).click();
  const panel=page.getByRole('complementary',{name:'Events and sources'});
  const eventRow=panel.getByRole('button',{name:/Published company update 1 /});
  await expect(eventRow.getByText('内存与存储',{exact:true})).toBeVisible();
  await expect(eventRow.locator('time')).toHaveText('2天前');
  await expect(eventRow.locator('time')).toHaveAttribute('title',/2026.*UTC/);
  const companyLine=eventRow.locator('p');
  expect(await companyLine.evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(20);
  expect(await companyLine.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await eventRow.click();
  const selection=page.getByRole('dialog',{name:'事件详情',exact:true});await expect(selection).toBeVisible();await expect(selection.getByRole('heading',{name:'Published company update 1'})).toBeVisible();await selection.press('Escape');await expect(selection).toHaveCount(0);
});

test('one theme selector switches companies and sources, clears stale filters, retains the list view and session watchlist',async({page},info)=>{
  test.skip(info.project.name!=='desktop','Shared theme interaction, no duplicate renderer tests');
  await page.setViewportSize({width:1500,height:800});await open(page);
  const robotics: IntelligenceSnapshot={...snapshot,theme:'robotics',graphVersion:'robotics-fixture',graph:{asOf:'2026-10-04',relationships:[],sources:[],nodes:[
    {id:'US:NVDA',symbol:'NVDA',name:'NVIDIA',kind:'COMPANY',order:0,stageIds:['robotics:compute-control','robotics:software-simulation']},
    {id:'US:ROK',symbol:'ROK',name:'Rockwell',kind:'COMPANY',order:1,stageIds:['robotics:systems-integration']}]},
    events:[{...snapshot.events[0],id:'robot-event',origin:'US:ROK',companyIds:['US:ROK'],title:'Robotics release'}],
    sourceDocuments:[{id:'robot-source',channel:'IR',companyIds:['US:ROK'],published_at:null,publication_date:'2026-10-02'}],truncated:false};
  const space: IntelligenceSnapshot={...robotics,theme:'space',graphVersion:'space-fixture',graph:{...robotics.graph,nodes:[{id:'US:RKLB',symbol:'RKLB',name:'Rocket Lab',kind:'COMPANY',order:0,stageIds:['space:launch','space:components']}]},events:[],sourceDocuments:[]};
  const currentAi:IntelligenceSnapshot={...snapshot,events:[...snapshot.events,{...snapshot.events[0],id:'today-event',title:'Today release',publication_date:snapshot.session.date,published_at:'2026-10-04T12:00:00Z',evidence:[{id:'today-source',url:'https://investors.example.com/today',title:'Today release',sourceDate:snapshot.session.date,channel:'IR'}]}],sourceDocuments:[...snapshot.sourceDocuments!,{id:'https://investors.example.com/today',channel:'IR',companyIds:['US:MU'],published_at:'2026-10-04T12:00:00Z',publication_date:snapshot.session.date}]};
  let releaseRobotics!:()=>void,releaseSpace!:()=>void,releaseAi!:()=>void;
  const roboticsReady=new Promise<void>(resolve=>{releaseRobotics=resolve;});
  const spaceReady=new Promise<void>(resolve=>{releaseSpace=resolve;});
  const aiReady=new Promise<void>(resolve=>{releaseAi=resolve;});
  let spaceRequests=0,holdAi=false;
  await page.route('**/api/intelligence?*',async route=>{
    const theme=new URL(route.request().url()).searchParams.get('theme');
    if(theme==='robotics')await roboticsReady;
    if(theme==='space'){if(++spaceRequests===1)return route.fulfill({status:503,json:{error:'Unavailable'}});await spaceReady;}
    if(theme==='ai'&&holdAi)await aiReady;
    await route.fulfill({json:theme==='space'?space:theme==='robotics'?robotics:currentAi});
  });
  // Start with the replacement route installed; a focus event can race the initial in-flight refresh.
  await page.reload();
  await expect(page.getByRole('button',{name:'Replay',exact:true})).toHaveCount(0);
  await expect(page.getByRole('slider')).toHaveCount(0);
  const workspace=await page.locator('main').elementHandle();
  await page.getByRole('button',{name:'Follow MU',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'MU followed'})).toBeVisible();
  await page.getByRole('tab',{name:'Company list',exact:true}).click();
  await page.getByPlaceholder('Search company / ticker').fill('MU');
  await page.getByRole('complementary',{name:'Universe navigation'}).getByRole('button',{name:/MU.*Micron/}).click();
  await expect(page).toHaveURL(/feedCompany=US%3AMU/);
  await page.getByRole('combobox',{name:'Investment theme',exact:true}).selectOption('robotics');
  await expect(page.getByRole('status').filter({hasText:'Loading Robotics…'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Reset universe view',exact:true})).toBeDisabled();
  await expect(page.locator('[data-list-company="US:MU"]')).toBeVisible();
  await expect(page.getByPlaceholder('Search company / ticker')).toHaveValue('MU');
  await expect(page.getByText('Loading companies and recorded events…',{exact:true})).toHaveCount(0);
  releaseRobotics();
  await expect(page).toHaveURL(/theme=robotics/);await expect(page.getByRole('combobox',{name:'Investment theme',exact:true})).toHaveCount(1);
  await expect(page).not.toHaveURL(/feedCompany=/);
  await expect(page.getByRole('tab',{name:'Company list',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('[data-list-company]')).toHaveCount(2);await expect(page.locator('[data-list-company="US:MU"]')).toHaveCount(0);
  expect(await workspace!.evaluate(element=>element.isConnected)).toBe(true);
  await expect(page.getByPlaceholder('Search company / ticker')).toHaveValue('');
  await expect(page.getByRole('button',{name:/Robotics release/}).getByText('Systems integration',{exact:true})).toBeVisible();
  await expect(page.getByRole('complementary',{name:'Events and sources'}).getByText('Source documents',{exact:true}).locator('..')).toContainText('1');
  await page.getByRole('button',{name:'Software & simulation 1',exact:true}).click();
  await expect(page.locator('[data-list-company]')).toHaveCount(1);await expect(page.locator('[data-list-company="US:NVDA"]')).toBeVisible();
  await page.getByRole('button',{name:'Clear sector focus',exact:true}).click();
  await page.getByRole('combobox',{name:'Investment theme',exact:true}).selectOption('space');
  await expect(page.getByRole('alert')).toContainText('Could not load Space. Still showing Robotics.');
  await expect(page.locator('[data-list-company]')).toHaveCount(2);
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Loading Space…'})).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Investment theme',exact:true})).toHaveValue('robotics');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('combobox',{name:'Investment theme',exact:true}).selectOption('space');
  await expect(page.getByRole('status').filter({hasText:'Loading Space…'})).toBeVisible();
  // Cached AI is usable immediately even with its refresh blocked. A cancelled Space response cannot win.
  holdAi=true;
  await page.getByRole('combobox',{name:'Investment theme',exact:true}).selectOption('ai');
  await expect(page.locator('[data-list-company]')).toHaveCount(4);
  await expect(page.getByRole('status').filter({hasText:/Loading (Space|AI)/})).toHaveCount(0);
  releaseSpace();releaseAi();
  await expect(page.getByRole('combobox',{name:'Investment theme',exact:true})).toHaveValue('ai');
  await page.getByRole('combobox',{name:'Investment theme',exact:true}).selectOption('space');
  await expect(page).toHaveURL(/theme=space/);
  await expect(page.locator('[data-list-company="US:RKLB"]')).toBeVisible();
  await expect(page.locator('[data-list-company]')).toHaveCount(1);
  await page.getByRole('button',{name:'Components & subsystems 1',exact:true}).click();
  await expect(page.locator('[data-list-company="US:RKLB"]')).toBeVisible();
  await page.getByRole('combobox',{name:'Investment theme',exact:true}).selectOption('ai');
  await expect(page.locator('[data-list-company]')).toHaveCount(4);await expect(page.getByRole('button',{name:'Unfollow MU',exact:true})).toBeVisible();
});

test('detail follow confirms beside the click and shows Followed',async({page},info)=>{
  test.skip(info.project.name!=='desktop','Desktop detail panel placement');
  await page.setViewportSize({width:1500,height:800});
  await open(page);
  await page.getByRole('textbox',{name:'Search companies'}).fill('Lument');
  await expect(page).toHaveURL(/q=Lument/);
  await page.getByRole('button',{name:'LITE Lumentum',exact:true}).click();
  const save=page.getByRole('button',{name:/☆ Follow/});
  const bounds=(await save.boundingBox())!;
  const x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
  await save.click();
  await expect(page.getByRole('button',{name:'★ Followed',exact:true})).toHaveAttribute('aria-pressed','true');
  const notice=page.getByRole('status').filter({hasText:'LITE followed'});
  await expect(notice).toBeVisible();
  const confirmation=(await notice.boundingBox())!;
  expect(Math.abs(confirmation.y-y-14)).toBeLessThanOrEqual(1);
  expect(Math.min(Math.abs(confirmation.x-x-14),Math.abs(confirmation.x+confirmation.width-x+14))).toBeLessThanOrEqual(1);
  await page.getByRole('button',{name:'★ Followed',exact:true}).click();
  await expect(page.getByRole('button',{name:'☆ Follow',exact:true})).toHaveAttribute('aria-pressed','false');
});


test('graph company details float inside the graph and move independently of the event panel',async({page},info)=>{
  const mobile=info.project.name==='mobile';
  if(!mobile)await page.setViewportSize({width:1500,height:800});
  await open(page);
  await page.getByRole('tab',{name:'Relationship graph',exact:true}).click();
  const expand=page.getByRole('button',{name:'Expand left panel',exact:true});
  if(await expand.isVisible())await expand.click();
  await page.getByRole('textbox',{name:'Search companies'}).fill('Lument');
  await expect(page).toHaveURL(/q=Lument/);
  await page.getByRole('button',{name:'Collapse right panel',exact:true}).click();
  await page.getByRole('button',{name:'LITE Lumentum',exact:true}).click();
  const card=page.getByRole('region',{name:'Company details',exact:true});
  const graph=page.locator('[data-view="graph"]');
  const right=page.getByRole('complementary',{name:'Events and sources'});
  await expect(card).toBeVisible();await expect(card).toBeFocused();
  await expect(right.getByRole('region',{name:'Company details'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Collapse right panel',exact:true})).not.toBeVisible();
  const fits=async()=>{
    const c=(await card.boundingBox())!,g=(await graph.boundingBox())!;
    expect(c.x).toBeGreaterThanOrEqual(g.x);expect(c.y).toBeGreaterThanOrEqual(g.y);
    expect(c.x+c.width).toBeLessThanOrEqual(g.x+g.width+1);
    expect(c.y+c.height).toBeLessThanOrEqual(g.y+g.height+1);
  };
  await fits();
  const atTopRight=async()=>{
    const c=(await card.boundingBox())!,g=(await graph.boundingBox())!;
    expect(Math.abs(c.x+c.width-(g.x+g.width-12))).toBeLessThanOrEqual(2);
    expect(Math.abs(c.y-Math.max(g.y+12,12))).toBeLessThanOrEqual(2);
  };
  await atTopRight();
  const before=(await card.boundingBox())!,handle=card.locator('[data-card-drag]');
  await handle.press(mobile?'ArrowDown':'ArrowLeft');
  await expect.poll(async()=>{const c=(await card.boundingBox())!;return mobile?c.y-before.y:before.x-c.x;}).toBeGreaterThan(10);
  const start=(await handle.boundingBox())!;
  await page.mouse.move(start.x+20,start.y+10);await page.mouse.down();
  await page.mouse.move(start.x-40,start.y+40,{steps:6});await page.mouse.up();
  await fits();
  const moved=(await card.boundingBox())!;
  expect(Math.abs(moved.x-before.x)+Math.abs(moved.y-before.y)).toBeGreaterThan(20);
  await page.screenshot({path:info.outputPath('floating-company-card.png')});
  await page.getByRole('textbox',{name:'Search companies'}).fill('Micr');
  await expect(page).toHaveURL(/q=Micr/);
  await page.getByRole('button',{name:'MU Micron',exact:true}).click();
  await expect(card).toContainText('Micron');
  await atTopRight();
  await page.getByRole('tab',{name:'Company list',exact:true}).click();
  const details=page.getByRole('region',{name:'Company details',exact:true});
  await expect(details).toBeVisible();await expect(details).toContainText('Micron');
  await expect(page.getByRole('button',{name:'Collapse right panel',exact:true})).not.toBeVisible();
  await details.press('Escape');await expect(details).toHaveCount(0);
});

for(const chinese of [false,true])test('active workspace company summary follows '+(chinese?'Chinese':'English')+' language',async({page})=>{
  await open(page,chinese);
  await page.goto('http://workspace.test/?company=US%3ALITE'+(chinese?'&lang=zh-CN':''));
  await expect(page.getByText(chinese?'通信设备供应商。':'Communication supplier',{exact:false})).toBeVisible();
  await expect(page.getByText(chinese?'Communication supplier':'通信设备供应商。',{exact:false})).toHaveCount(0);
});

test('Chinese event feed uses saved headlines and retains the original title',async({page})=>{
  await open(page,true);
  const headline=page.getByText('Lumentum 通信业务最新进展',{exact:true});
  await expect(headline).toBeVisible();
  await expect(headline).toHaveAttribute('title','Lumentum communication update');
});

test('English event feed displays saved English translations of Chinese headlines',async({page})=>{
 await open(page);
 const headline=page.getByText('Announcement of a shareholders meeting',{exact:true});
 await expect(headline).toBeVisible();await expect(headline).toHaveAttribute('title','关于召开股东大会的公告');
 await expect(page.getByText('关于召开股东大会的公告',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:/Announcement of a shareholders meeting/}).click();
 const card=page.getByRole('dialog',{name:'Event details',exact:true});
 const source=card.getByRole('link',{name:/IR · Announcement of a shareholders meeting/});
 await expect(source).toHaveAttribute('title','关于召开股东大会的公告');
 await expect(card).toContainText('Original announcement from an exchange-listed company.');
 await expect(card.getByText('关于召开股东大会的公告',{exact:true})).toHaveCount(0);
});

for(const chinese of [false,true])test('research connection descriptions follow '+(chinese?'Chinese':'English')+' language',async({page})=>{
 const summary='Jointly tested Ethernet networking for AI workloads.',summaryZh='双方联合测试了面向 AI 工作负载的以太网网络。';
 const title='Joint AI networking source',titleZh='联合 AI 网络来源';
 const fixture: IntelligenceSnapshot={...snapshot,graph:{...snapshot.graph,sources:[{id:'localized-source',title,titleZh,url:'https://example.com/relationship',sourceDate:null},{id:'missing-source',title:'Untranslated English source',url:'https://example.com/missing',sourceDate:null}],relationships:[{id:'localized-connection',source:'US:LITE',target:'US:MU',type:'PARTNER_OF',summary,summaryZh,commercialStatus:'DOCUMENTED',sourceIds:['localized-source','missing-source']}]}};
 await open(page,chinese,fixture);
 await page.goto('http://workspace.test/?company=US%3ALITE'+(chinese?'&lang=zh-CN':''));
 await expect(page.getByText(chinese?summaryZh:summary,{exact:true})).toBeVisible();
 await expect(page.getByText(chinese?summary:summaryZh,{exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:chinese?'公司关系':'Relationships',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:(chinese?titleZh:title)+' ↗',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:(chinese?'关系来源':'Untranslated English source')+' ↗',exact:true}).and(page.locator('a[href="https://example.com/missing"]'))).toBeVisible();
 if(chinese)await expect(page.getByRole('link',{name:/Joint AI networking source|Untranslated English source/})).toHaveCount(0);
});

for(const view of ['graph','tree','hierarchy','table'])test(view+' event selection opens a separate window by the event row',async({page},info)=>{
 await open(page);await page.goto('http://workspace.test/?view='+view);
 const panel=page.getByRole('complementary',{name:'Events and sources'}),row=panel.getByRole('button',{name:/Published company update 1 /}),details=page.getByRole('dialog',{name:'Event details',exact:true});
 await row.click();await expect(details).toBeVisible();await expect(details).toBeFocused();
 await expect(details).toContainText('Source summary 1');await expect(details.getByRole('link',{name:/Original release 1/})).toHaveAttribute('href','https://investors.example.com/0');
 const card=page.getByRole('region',{name:'Company details',exact:true});await expect(card.locator('[data-card-drag]')).toContainText('Micron');await expect(card).not.toContainText('Source summary 1');
 await panel.getByRole('button',{name:/Published company update 2 /}).click();await expect(details).toContainText('Source summary 2');await expect(page.locator('[data-event-window]')).toHaveCount(1);
 await page.screenshot({path:info.outputPath('anchored-event-window.png')});
 await details.press('Escape');await expect(details).toHaveCount(0);
 await row.click();await expect(details).toBeVisible();await details.getByRole('button',{name:'Close event details',exact:true}).click();await expect(details).toHaveCount(0);
});

for(const view of ['tree','hierarchy','table'])test(view+' company selection opens a movable card at the chart top right',async({page})=>{
 await open(page);
 await page.goto('http://workspace.test/?view='+view);
 const expand=page.getByRole('button',{name:'Expand left panel',exact:true});
 if(await expand.isVisible())await expand.click();
 await page.getByRole('button',{name:'Collapse right panel',exact:true}).click();
 if(view!=='table'){
  await page.getByRole('textbox',{name:'Search companies'}).fill('Lument');
  await expect(page).toHaveURL(/q=Lument/);
 }
 const companyButton=view==='table'?page.locator('[data-list-company="US:LITE"] button'):page.getByRole('button',{name:'LITE Lumentum',exact:true});
 await companyButton.click();
 const card=page.getByRole('region',{name:'Company details',exact:true});
 await expect(card).toBeVisible();await expect(card).toBeFocused();
 await expect(page.getByRole('complementary',{name:'Events and sources'}).getByRole('region',{name:'Company details'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Collapse right panel',exact:true})).not.toBeVisible();
 const host=(await page.locator('[data-company-workspace]').boundingBox())!;
 const box=(await card.boundingBox())!;
 expect(box.x).toBeGreaterThanOrEqual(host.x);
 expect(box.y).toBeGreaterThanOrEqual(host.y);
 expect(box.x+box.width).toBeLessThanOrEqual(host.x+host.width+1);
 expect(box.y+box.height).toBeLessThanOrEqual(host.y+host.height+1);
 expect(Math.abs(box.x+box.width-(host.x+host.width-12))).toBeLessThanOrEqual(2);
 expect(Math.abs(box.y-Math.max(host.y+12,12))).toBeLessThanOrEqual(2);
 const handle=card.locator('[data-card-drag]');
 const down=box.y-host.y<32;
 await handle.press(down?'ArrowDown':'ArrowUp');
 await expect.poll(async()=>Math.abs((await card.boundingBox())!.y-box.y)).toBeGreaterThan(5);
 await card.press('Escape');await expect(card).toHaveCount(0);
});


for(const reduced of [true,false])test('clicking star halos switches company cards with '+(reduced?'reduced':'normal')+' motion',async({page},info)=>{
 test.skip(info.project.name!=='desktop','Actual WebGL company click regression');test.setTimeout(60000);
 await page.setViewportSize({width:1500,height:900});await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
 const fixture:IntelligenceSnapshot={...snapshot,graph:{...snapshot.graph,relationships:[
  {id:'optics-memory',source:'US:LITE',target:'US:MU',type:'PARTNER_OF',summary:'Optics memory partnership',commercialStatus:'DOCUMENTED',sourceIds:[]},
  {id:'compute-memory',source:'US:MULT',target:'US:MEM',type:'PARTNER_OF',summary:'Compute memory partnership',commercialStatus:'DOCUMENTED',sourceIds:[]}
 ]}};
 const realHtml=await workspaceFixture(true,fixture);
 await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:realHtml}):route.request().url().includes('/api/intelligence')?route.fulfill({json:fixture}):route.fulfill({status:404,body:''}));
 await page.goto('http://workspace.test/?view=graph');
 await expect(page.locator('canvas')).toHaveAttribute('data-camera-position',/.+/);
 const collapseLeft=page.getByRole('button',{name:'Collapse left panel',exact:true});if(await collapseLeft.isVisible())await collapseLeft.click();
 await page.getByRole('button',{name:'Collapse right panel',exact:true}).click();
 const card=page.getByRole('region',{name:'Company details',exact:true});
 let previous='',clicks=0;
 // HTML labels share the star's projected center; click exposed canvas pixels
 // near the halo with slight pointer drift to exercise GPU hit testing.
 for(let attempt=0;attempt<4&&clicks<2;attempt++){
  // ResizeObserver updates the WebGL viewport after collapsing the panels.
  await expect.poll(()=>page.locator('canvas').evaluate(el=>Math.abs(el.getBoundingClientRect().width-el.parentElement!.getBoundingClientRect().width))).toBeLessThan(1);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const candidates=await page.locator('[data-company-id]').evaluateAll(els=>els.flatMap(el=>{
   const r=el.parentElement!.getBoundingClientRect();
   return [-14,14].flatMap(dx=>[0].map(dy=>({id:el.getAttribute('data-company-id')!,x:r.x+r.width/2+dx,y:r.y+r.height/2+dy}))).filter(p=>document.elementFromPoint(p.x,p.y) instanceof HTMLCanvasElement);
  }));
  const next=candidates.find(p=>p.id!==previous);expect(next,'A second exposed star must be clickable').toBeTruthy();
  await page.mouse.move(next!.x,next!.y);await page.mouse.down();
  await page.mouse.move(next!.x+2,next!.y+2);await page.mouse.up();
  await expect(page).toHaveURL(new RegExp('company='+encodeURIComponent(next!.id)));
  await expect(card).toHaveCount(1);await expect(card).toContainText(companies.find(c=>c.id===next!.id)!.name);
  await page.mouse.move(1,1);
  await expect(page.locator('[data-company-focus="selected"]')).toHaveCount(1);
  await expect(page.locator('[data-company-id="'+next!.id+'"]')).toHaveAttribute('data-company-focus','selected');
  if(previous)await expect(page.locator('[data-company-id="'+previous+'"]')).not.toHaveAttribute('data-company-focus','selected');
  previous=next!.id;clicks++;
 }
 expect(clicks).toBe(2);
 const originalUrl=page.url();
 const drag=await page.locator('[data-company-id]').evaluateAll(els=>els.map(el=>{const r=el.parentElement!.getBoundingClientRect();return {x:r.x+r.width/2-14,y:r.y+r.height/2};}).find(p=>document.elementFromPoint(p.x,p.y) instanceof HTMLCanvasElement));
 expect(drag).toBeTruthy();
 await page.mouse.move(drag!.x,drag!.y);await page.mouse.down();
 await page.mouse.move(drag!.x+35,drag!.y+20,{steps:5});
 // Even returning to the press point is still an orbit gesture, not a click.
 await page.mouse.move(drag!.x,drag!.y,{steps:5});await page.mouse.up();
 await expect(page).toHaveURL(originalUrl);
 await expect(card).toContainText(companies.find(c=>c.id===previous)!.name);
});

 test('Explore compact timeline uses 1M, overlaid dated events and can close and reopen',async({page})=>{
 await open(page);
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:'US:MU',start:'2026-09-11',end:'2026-10-11',currency:'USD',available:true,prices:[{date:'2026-10-01',close:100,volume:0},{date:'2026-10-02',close:102,volume:null}]}}));
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=page.getByPlaceholder('Search company / ticker');await search.fill('MU');await search.press('Enter');
 const timeline=page.locator('[data-company-timeline="US:MU"]');
 await expect(timeline).toBeVisible();await expect(timeline).toContainText('2 stored daily bars');
 await expect(timeline.getByRole('group',{name:'Timeline range'})).toContainText('1M');
 await expect(timeline.getByRole('button',{name:/^(3M|6M|1Y|5Y)$/})).toHaveCount(0);
 await expect(timeline.locator('svg')).not.toContainText('Sources');
 expect((await timeline.locator('svg').boundingBox())?.height).toBeGreaterThanOrEqual(190);
 const marker=timeline.getByRole('button',{name:/events · .* · Oct 2/}).first();
 await timeline.locator('svg').scrollIntoViewIfNeeded();
 const markerBounds=await marker.boundingBox(),chartBounds=await timeline.locator('svg').boundingBox();
 expect(markerBounds!.y+markerBounds!.height/2-chartBounds!.y).toBeGreaterThan(0);
 const priceTop=Number(await timeline.locator('svg').getAttribute('data-price-top')),priceBottom=Number(await timeline.locator('svg').getAttribute('data-price-bottom'));
 expect(markerBounds!.y-chartBounds!.y).toBeGreaterThanOrEqual(priceTop);
 expect(markerBounds!.y+markerBounds!.height-chartBounds!.y).toBeLessThanOrEqual(priceBottom);
 await page.mouse.click(chartBounds!.x+Number(await timeline.locator("svg circle").first().getAttribute("cx"))/Number(await timeline.locator("svg").evaluate(el=>(el as SVGSVGElement).viewBox.baseVal.width))*chartBounds!.width,chartBounds!.y+priceBottom+26);
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('2026-10-01');
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('Close · $100.00');
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('Volume · 0');
 await page.mouse.click(chartBounds!.x+chartBounds!.width-25,chartBounds!.y+priceBottom+26);
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('2026-10-02');
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('Close · $102.00');
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('Volume · Not recorded');
 await marker.click();
 await expect(timeline.getByRole('group',{name:'Price details'})).toHaveCount(0);
 if(await page.getByRole('group',{name:'Choose an event'}).count())await page.getByRole('button',{name:'Close event list',exact:true}).click();
 await timeline.getByRole('button',{name:'Close timeline',exact:true}).click();
 await expect(timeline.getByRole('button',{name:'Show timeline',exact:true})).toBeFocused();
 await expect(timeline.locator('svg')).toHaveCount(0);
 await expect(page.getByRole('region',{name:'Company details',exact:true})).toBeVisible();
 await timeline.getByRole('button',{name:'Show timeline',exact:true}).press('Enter');
 await expect(timeline.getByRole('button',{name:'Close timeline',exact:true})).toBeFocused();
 await expect(timeline.locator('svg')).toBeVisible();
 await timeline.getByRole('button',{name:/events · .* · Oct 2/}).first().click();
 await page.getByRole('group',{name:'Choose an event'}).getByRole('button',{name:/Published company update 1$/}).click();
 await expect(page).toHaveURL(/event=event-0/);
 await expect(page.getByRole('dialog',{name:'Event details',exact:true})).toContainText('Published company update 1');
 await page.getByRole('button',{name:'Close company details'}).click();await expect(timeline).toHaveCount(0);
 await search.fill('');await search.fill('MU');await search.press('Enter');
 await expect(timeline.getByRole('group',{name:'Timeline range'})).toContainText('1M');
 const bounds=await timeline.boundingBox();expect(bounds?.width).toBeLessThanOrEqual(await page.evaluate(()=>innerWidth));
 });


test('timeline category symbols, count chooser and docked card retain all event references',async({page},info)=>{
 const classified=snapshot.events.map((e,i)=>({...e,eventType:i===0?'earnings':'insider_trade',eventSubtype:i===0?'earnings_results':'insider_sell',eventClassification:{version:1,method:'parser',rule:'fixture',evidence:['fixture']}})) as IntelligenceSnapshot['events'];
 classified[0]={...classified[0],evidence:[...classified[0].evidence,{id:'second-reference',url:'https://example.com/second',title:'Second filing reference',sourceDate:'2026-10-02',channel:'SEC'}]};
 await open(page,false,{...snapshot,events:classified});
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:'US:MU',start:'2026-09-11',end:'2026-10-11',currency:'USD',available:true,prices:[]}}));
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=page.getByPlaceholder('Search company / ticker');await search.fill('MU');await search.press('Enter');
 const timeline=page.locator('[data-company-timeline="US:MU"]'),card=page.getByRole('region',{name:'Company details',exact:true});
 await expect(timeline.locator('[data-event-type="earnings"]')).toContainText('◆');
 const initialTimelineHeight=(await timeline.boundingBox())!.height;
 const insiderMarker=timeline.getByRole('button',{name:/events · Insider sell · Oct 2/});
 await expect(insiderMarker).toContainText('▼');
 await insiderMarker.focus();await insiderMarker.press('Enter');
 await expect(page.getByRole('group',{name:'Choose an event'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Close event list',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('group',{name:'Choose an event'})).toHaveCount(0);
 await expect(insiderMarker).toBeFocused();
 await insiderMarker.press('Enter');
 expect((await timeline.boundingBox())!.height).toBe(initialTimelineHeight);
 await expect(page).not.toHaveURL(/event=/);
 await page.getByRole('group',{name:'Choose an event'}).getByRole('button',{name:/Insider sell.*Published company update 2$/}).click();
 await expect(page.getByRole('dialog',{name:'Event details',exact:true})).toContainText('Insider sell');
 // Reopening the same grouped marker replaces details rather than stacking windows.
 await insiderMarker.focus();await insiderMarker.press('Enter');await expect(page.getByRole('dialog',{name:'Event details',exact:true})).toHaveCount(0);
 await expect(page.getByRole('group',{name:'Choose an event'})).toBeVisible();await expect(page.locator('[data-event-window]')).toHaveCount(1);
 await page.keyboard.press('Escape');await expect(page.locator('[data-event-window]')).toHaveCount(0);await expect(insiderMarker).toBeFocused();
 await timeline.locator('[data-event-type="earnings"]').click();
 await expect(page.getByRole('dialog',{name:'Event details',exact:true})).toContainText('Earnings results');await expect(page.getByRole('dialog',{name:'Event details',exact:true})).toContainText('Second filing reference');
 await page.getByRole('dialog',{name:'Event details',exact:true}).getByRole('button',{name:'Close event details',exact:true}).click();
 await expect(page).not.toHaveURL(/event=/);await expect(card).toBeVisible();
 if(info.project.name==='desktop'){
  const cardBounds=await card.boundingBox(),timelineBounds=await timeline.boundingBox();
  expect(Math.abs(cardBounds!.y+cardBounds!.height-timelineBounds!.y)).toBeLessThanOrEqual(14);
  await card.getByRole('button',{name:'Reset card position'}).click();
 }
 await page.screenshot({path:`output/event-types-${info.project.name}.png`});
});

test('dense overlay keeps exact dates and every category accessible without growing',async({page},info)=>{
 const types=['earnings','insider_trade','relationship','product_business','corporate_action','financing','regulatory_governance','other'] as const;
 const classified=types.map((eventType,i)=>({...snapshot.events[0],id:`dense-${i}`,title:`Distinct event ${i}`,eventType,eventSubtype:undefined,publication_date:'2026-10-02',evidence:[{id:`dense-source-${i}`,url:`https://example.com/dense/${i}`,title:`Reference ${i}`,sourceDate:'2026-10-02',channel:'IR' as const}]}));
 const fixture:IntelligenceSnapshot={...snapshot,events:[...classified,{...classified[3],id:'next-day',title:'Next day event',publication_date:'2026-10-03',evidence:[{id:'next-source',url:'https://example.com/next',title:'Next reference',sourceDate:'2026-10-03',channel:'IR'}]}]};
 await open(page,false,fixture);
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:'US:MU',start:'2026-09-11',end:'2026-10-11',currency:'USD',available:true,prices:Array.from({length:20},(_,i)=>({date:`2026-09-${String(i+11).padStart(2,'0')}`,close:100+Math.sin(i/4)*10+i,volume:100+i*15}))}}));
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=page.getByPlaceholder('Search company / ticker');await search.fill('MU');await search.press('Enter');
 await page.addStyleTag({content:"button{min-height:32px}"});const timeline=page.locator('[data-company-timeline="US:MU"]');await expect(timeline).toContainText('20 stored daily bars');
 const svg=timeline.locator('svg');await expect(svg).toHaveAttribute('data-event-layout','overlay');
 const bounds=(await svg.boundingBox())!;expect(bounds.height).toBe(info.project.name==='mobile'?220:196);
 const markers=timeline.locator('button[data-event-type]');for(const marker of await markers.all()){const box=(await marker.boundingBox())!;expect(Math.abs(box.width-box.height)).toBeLessThan(1);}
 expect(await markers.evaluateAll(elements=>elements.reduce((sum,el)=>sum+Number(el.getAttribute('data-event-count')),0))).toBe(9);
 const mixed=timeline.locator('[data-event-type="multiple"]');await expect(mixed).toHaveCount(1);await expect(mixed).toHaveAttribute('data-event-count','8');
 const next=timeline.getByRole('button',{name:/Oct 3: Next day event/});
 expect((await next.boundingBox())!.x).toBeGreaterThan((await mixed.boundingBox())!.x);
 if(info.project.name==='mobile'){const hit=await mixed.evaluate(el=>({width:getComputedStyle(el,'::before').width,height:getComputedStyle(el,'::before').height}));expect(hit).toEqual({width:'44px',height:'44px'});await mixed.scrollIntoViewIfNeeded();const box=(await mixed.boundingBox())!;await page.touchscreen.tap(box.x+box.width/2-20,box.y+box.height/2);}else await mixed.click();const chooser=page.getByRole('group',{name:'Choose an event'});await expect(chooser.getByRole('button')).toHaveCount(9);
 expect((await svg.boundingBox())!.height).toBe(bounds.height);await page.keyboard.press('Escape');await expect(mixed).toBeFocused();
 await page.mouse.move(0,0);await page.screenshot({path:`output/overlay-dense-${info.project.name}.png`});
});

test('candles are default, line is optional and missing OHLC never creates candles',async({page},info)=>{
 const candleFixture={...snapshot,events:[...snapshot.events,{...snapshot.events[0],id:'wick-clearance',title:'Full wick clearance event',publication_date:'2026-09-29',eventType:'earnings' as const}]};
 await open(page,false,candleFixture);
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:'US:MU',start:'2026-09-11',end:'2026-10-11',currency:'USD',available:true,prices:[{date:'2026-09-28',open:100,high:110,low:95,close:110,volume:10},{date:'2026-09-29',open:108,high:112,low:99,close:100,volume:20},{date:'2026-09-30',open:101,high:107,low:98,close:101,volume:30},{date:'2026-10-08',close:103,volume:0}]}}));
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=page.getByPlaceholder('Search company / ticker');await search.fill('MU');await search.press('Enter');
 const timeline=page.locator('[data-company-timeline="US:MU"]');await expect(timeline).toContainText('4 stored daily bars');
 const svg=timeline.locator('svg');await expect(svg).toHaveAttribute('data-chart-type','candles');await expect(timeline.getByRole('button',{name:'Candles',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(svg.locator('[data-price-candle]')).toHaveCount(3);await expect(svg.locator('[data-candle-direction="up"] rect')).toHaveCSS('fill','rgb(85, 223, 187)');await expect(svg.locator('[data-candle-direction="down"] rect')).toHaveCSS('fill','rgb(255, 142, 161)');await expect(svg.locator('[data-candle-direction="flat"] rect')).toHaveAttribute('height','1');await expect(svg.locator('[data-price-candle="2026-10-08"]')).toHaveCount(0);await expect(svg.locator('[data-price-gap]')).toHaveCount(0);
 await expect(svg).toHaveAttribute('data-time-axis','trading-sessions');
 const positions=await svg.locator('circle').evaluateAll(elements=>elements.map(el=>Number(el.getAttribute('cx'))));
 expect(positions).toHaveLength(4);for(let i=2;i<positions.length;i++)expect(positions[i]-positions[i-1]).toBeCloseTo(positions[1]-positions[0],5);
 expect(await svg.locator('[data-session-tick]').evaluateAll(elements=>elements.map(el=>el.getAttribute('data-session-tick')))).toEqual(['2026-09-28','2026-09-29','2026-09-30','2026-10-08'].filter((_,i)=>info.project.name==='desktop'||i!==1));
 const publication=timeline.getByRole('button',{name:/events .* Oct 2/}).first();await expect(publication).toHaveAttribute('title',/Oct 2/);
 const publicationX=await publication.evaluate(el=>parseFloat((el as HTMLElement).style.left));expect(publicationX).toBeCloseTo(positions[2]+(positions[3]-positions[2])*2/8,4);
 const wickEvent=timeline.getByRole('button',{name:/Sep 29: Full wick clearance event/});
 const eventBox=(await wickEvent.boundingBox())!,svgBox=(await svg.boundingBox())!;
 const viewScale=svgBox.width/await svg.evaluate(el=>(el as SVGSVGElement).viewBox.baseVal.width);
 for(const candle of await svg.locator('[data-price-candle]').all()){
  const wick=candle.locator('line'),body=candle.locator('rect');
  const top=svgBox.y+Number(await wick.getAttribute('y1'))*viewScale,bottom=svgBox.y+Number(await wick.getAttribute('y2'))*viewScale,left=svgBox.x+Number(await body.getAttribute('x'))*viewScale,right=left+Number(await body.getAttribute('width'))*viewScale;
  const centerX=eventBox.x+eventBox.width/2,centerY=eventBox.y+eventBox.height/2;
  expect(Math.hypot(Math.max(left-centerX,0,centerX-right),Math.max(top-centerY,0,centerY-bottom))-eventBox.width/2).toBeGreaterThanOrEqual(8*viewScale-.1);
 }
 await expect(svg.locator('[data-event-connector="2026-09-29"]')).toHaveCount(1);
 const bounds=(await svg.boundingBox())!,viewWidth=await svg.evaluate(el=>(el as SVGSVGElement).viewBox.baseVal.width),cx=Number(await svg.locator('[data-price-candle="2026-09-29"] line').getAttribute('x1'));
 await svg.click({position:{x:cx/viewWidth*bounds.width,y:bounds.height-24}});
 const tooltip=timeline.getByRole('group',{name:'Price details'});await expect(tooltip.locator('[data-hover-ohlc]')).toContainText('O 108.00 · H 112.00 · L 99.00');await expect(tooltip).toContainText('Daily change · ▼ -9.09%');await expect(tooltip.locator('[data-latest-return]')).toContainText('▲ +3.00%');
 const highX=Number(await svg.locator('[data-price-candle="2026-09-28"] line').getAttribute('x1'));await svg.click({position:{x:highX/viewWidth*bounds.width,y:bounds.height-24}});const cardBounds=(await tooltip.boundingBox())!,chartBounds=(await svg.boundingBox())!;expect(cardBounds.y).toBeGreaterThanOrEqual(chartBounds.y);expect(cardBounds.y+cardBounds.height).toBeLessThanOrEqual(chartBounds.y+chartBounds.height);await page.screenshot({path:`output/candlestick-${info.project.name}.png`});
 await timeline.getByRole('button',{name:'Line',exact:true}).click();await expect(svg).toHaveAttribute('data-chart-type','line');await expect(svg.locator('[data-price-candle]')).toHaveCount(0);await expect(svg.locator('[data-price-line]')).toHaveCount(1);await expect(svg.locator('[data-price-gap]')).toHaveCount(1);
 await timeline.getByRole('button',{name:'Candles',exact:true}).click();await expect(svg.locator('[data-price-candle]')).toHaveCount(3);
});

test('selected graph keeps its relationships while hovering partners and clicking lines',async({page},info)=>{
 test.skip(info.project.name!=='desktop','Actual WebGL relationship hit regression');test.setTimeout(60000);
 await page.setViewportSize({width:1500,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 const fixture:IntelligenceSnapshot={...snapshot,graph:{...snapshot.graph,relationships:[{id:'selected-partner',source:'US:LITE',target:'US:MU',type:'PARTNER_OF',summary:'Selected memory optics relationship',commercialStatus:'ANNOUNCED',sourceIds:[]},{id:'secondary-partner',source:'US:LITE',target:'US:MEM',type:'PARTNER_OF',summary:'Partner secondary network',commercialStatus:'DOCUMENTED',sourceIds:[]}]}};
 const body=await workspaceFixture(true,fixture);await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body}):route.request().url().includes('/api/intelligence')?route.fulfill({json:fixture}):route.fulfill({status:404,body:''}));
 await page.goto('http://workspace.test/?view=graph');const canvas=page.locator('canvas');await expect(canvas).toHaveAttribute('data-camera-position',/.+/);
 const search=page.getByPlaceholder('Search company / ticker');await search.fill('MU');await search.press('Enter');await search.blur();
 await page.getByRole('button',{name:'Collapse left panel',exact:true}).click();await page.getByRole('button',{name:'Collapse right panel',exact:true}).click();
 await expect(canvas).toHaveAttribute('data-visible-relationships','selected-partner');
 const partner=page.locator('[data-company-id="US:LITE"]');await partner.hover();await expect(canvas).toHaveAttribute('data-visible-relationships','selected-partner');
 await expect.poll(()=>canvas.evaluate(el=>Math.abs(el.getBoundingClientRect().width-el.parentElement!.getBoundingClientRect().width))).toBeLessThan(1);
 await page.mouse.move(1,1);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const candidates=await page.evaluate(()=>{const center=(id:string)=>{const r=document.querySelector(`[data-company-id="${id}"]`)!.parentElement!.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};};const a=center('US:MU'),b=center('US:LITE');return [.3,.4,.5,.6,.7].map(t=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t})).filter(p=>document.elementFromPoint(p.x,p.y) instanceof HTMLCanvasElement);});
 expect(candidates.length).toBeGreaterThan(0);let point:typeof candidates[number]|undefined;
 for(const candidate of candidates){await page.mouse.move(candidate.x,candidate.y);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));if(await canvas.getAttribute('data-hovered-relationship')==='selected-partner'){point=candidate;break;}}
 expect(point,'Visible dashed relationship should be hoverable in screen space').toBeTruthy();
 await expect(page.locator('[data-relationship-id="selected-partner"][data-displayed="true"]')).toContainText('Selected memory optics relationship');
 await page.mouse.click(point!.x,point!.y);await expect(page).toHaveURL(/company=US%3AMU/);await expect(page).toHaveURL(/relationship=selected-partner/);
 await expect(canvas).toHaveAttribute('data-rotation','focused');await expect(canvas).toHaveAttribute('data-visible-relationships','selected-partner');await expect(page.getByRole('region',{name:'Company details',exact:true})).toContainText('Micron');
 await page.getByRole('region',{name:'Company details',exact:true}).getByRole('button',{name:/LITE.*MU/}).click();await expect(page).toHaveURL(/company=US%3AMU/);await expect(canvas).toHaveAttribute('data-rotation','focused');await page.screenshot({path:'output/selected-relationship-hit.png'});
});
