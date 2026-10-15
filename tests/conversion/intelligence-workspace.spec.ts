import {expect,test} from '@playwright/test';
import {componentFixtureHtml} from './fixtures/component-html';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import type {IntelligenceSnapshot} from '../../src/lib/intelligence/model';
import {companySearchRank} from '../../src/lib/knowledge-graph/model';
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
test('workspace locates AMD across tree hierarchy and paginated list without losing selection',async({page})=>{
 test.setTimeout(90000);await page.emulateMedia({reducedMotion:'reduce'});
 const amd={...snapshot.graph.nodes[1],id:'US:AMD',symbol:'AMD',name:'Advanced Micro Devices'};
 const fixture:IntelligenceSnapshot={...snapshot,graph:{...snapshot.graph,nodes:[...Array.from({length:65},(_,i)=>({...amd,id:`US:AAA${i}`,symbol:`AAA${i}`,name:`AAA company ${i}`})),amd]}};
 const body=await workspaceFixture(true,fixture);
 await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body}):route.request().url().includes('/api/intelligence')?route.fulfill({json:fixture}):route.fulfill({status:404,body:''}));
 await page.goto('http://workspace.test/?view=graph&company=US%3AAMD');
 const visibleCompany=async(selector:string)=>{
  const company=page.locator(selector.includes('data-list-company')?`${selector} button[aria-pressed=true]`:selector).first();await expect(company).toBeVisible({timeout:15000});
  await page.screenshot({path:test.info().outputPath(`before-${selector.includes('list')?'list':'tree'}.png`)});
  await expect.poll(()=>company.evaluate(el=>{const r=el.getBoundingClientRect(),p=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!p&&(p===el||el.contains(p))?'reachable':JSON.stringify({rect:r.toJSON(),hit:p?.outerHTML.slice(0,200),container:el.closest('[role=region]')?.getBoundingClientRect().toJSON()});})).toBe('reachable');
 };
 for(const [tab,selector] of [['Industry tree','[data-tree-company="US:AMD"]'],['Company hierarchy','[data-tree-company="US:AMD"]'],['Company list','[data-list-company="US:AMD"]'],['Industry tree','[data-tree-company="US:AMD"]']] as const){
  await page.getByRole('tab',{name:tab,exact:true}).click();await expect(page).toHaveURL(/company=US%3AAMD/);await visibleCompany(selector);
  await page.screenshot({path:test.info().outputPath(`selected-amd-${tab.replaceAll(' ','-')}.png`)});
  if(tab==='Company list'){await expect(page).toHaveURL(/page=2/);await page.getByRole('button',{name:'Previous',exact:true}).click();await expect(page).toHaveURL(/page=1/);}
 }
 await page.getByRole('tab',{name:'Relationship graph',exact:true}).click();await expect(page).toHaveURL(/company=US%3AAMD/);
});
let html:string;
snapshot.sourceDocuments![199].companyIds=['US:LITE'];
snapshot.events[0]={...snapshot.events[0],calendarEvents:[{id:'scheduled_event_micron_call',companyId:'US:MU',day:'2026-10-28'},{id:'scheduled_event_micron_release',companyId:'US:MU',day:'2026-10-28'}]};
async function workspaceFixture(realCharts=false,fixture=snapshot,initial=true,headerSearch=false){
  return componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {LiveInvestmentIntelligence} from './src/components/live-investment-intelligence';import {CompanySearch} from './src/components/company-search';createRoot(document.getElementById('root')).render(<>${headerSearch?'<CompanySearch/>':''}<LiveInvestmentIntelligence ${initial?`initialSnapshot={${JSON.stringify(fixture)}}`:''}/></>);`,{jsx:'automatic',define:{'process.env':'{}'},alias:{'next/link':path.resolve('tests/conversion/fixtures/mocks.tsx'),'@/components/providers/auth-provider':path.resolve('tests/conversion/fixtures/mocks.tsx')},plugins:[{name:'workspace-services',setup(build){
    build.onResolve({filter:realCharts?/(?:locale-provider|auth-provider|company-follow-button|site-nav|next\/image)$/:/(?:company-graph-3d|industry-tree-scene|locale-provider|auth-provider|company-follow-button|site-nav|next\/image)$/},args=>({path:args.path.split('/').at(-1)!,namespace:'workspace-mock'}));
    build.onLoad({filter:/.*/,namespace:'workspace-mock'},args=>({loader:'tsx',resolveDir:process.cwd(),contents:args.path==='company-graph-3d'?`export default function Graph(){return <div style={{height:'100%',background:'radial-gradient(ellipse at center,#123b45,#07111b 70%)'}}>Local interaction fixture</div>}`:args.path==='industry-tree-scene'?`export default function Scene(){return <div>Tree interaction fixture</div>}`:args.path==='locale-provider'?`export function useLocale(){const chinese=new URLSearchParams(location.search).get('lang')==='zh-CN';return {locale:chinese?'zh-CN':'en',chinese,text:(en,zh)=>chinese?zh:en}};export function LanguageSwitch(){return <button>中文</button>}`:args.path==='auth-provider'?`export function useAuth(){return {user:null,getIdToken:async()=>null}}`:args.path==='company-follow-button'?`export function CompanyFollowButton(){return null}export function useCompanyFollows(){return {user:null,ids:[],change:async()=>{}}}`:args.path==='site-nav'?`export function AvatarButton(){return <span>Profile</span>}`:`export default function Image({priority,...props}){return <img {...props}/>} `}));
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

test('workspace session watchlist appears below indicators and restores company selection during review',async({page})=>{
 await open(page);
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:new URL(route.request().url()).searchParams.get('company'),start:'2026-01-01',end:'2026-10-04',available:true,currency:'USD',prices:[{date:'2026-10-02',open:100,high:115,low:98,close:110,volume:1000}]}}));
 await page.goto('http://workspace.test/?company=US%3AMU&chartMA=none');
 const workspace=page.locator('section[aria-label="Company relationship chart"]');
 await workspace.getByRole('group',{name:'Company view size',exact:true}).getByRole('button',{name:'Full screen',exact:true}).click();
 await workspace.getByRole('button',{name:'MACD (12,26,9)',exact:true}).click();
 const review=workspace.getByRole('region',{name:'Watchlist review',exact:true});
 await review.getByRole('button',{name:'Add current stock',exact:true}).click();
 await expect(review.getByRole('button',{name:'Micron',exact:true})).toBeVisible();
 await workspace.getByRole('button',{name:'Stock tools',exact:true}).click();
 const tools=page.getByRole('dialog',{name:'Stock tools · MU',exact:true});
 await tools.locator('summary').click();await tools.getByRole('button',{name:'Memory & storage →',exact:true}).click();
 await tools.getByRole('button',{name:'Memory Supplier',exact:true}).click();
 await expect(page).toHaveURL(/company=US%3AMEM/);
 await expect(workspace.locator('[data-company-timeline="US:MEM"]')).toBeVisible();
 await review.getByRole('button',{name:'Micron',exact:true}).click();
 await expect(page).toHaveURL(/company=US%3AMU/);
 await expect(workspace).toHaveAttribute('data-chart-size','full');
 await expect(workspace.getByRole('button',{name:'MACD (12,26,9)',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.screenshot({path:test.info().outputPath('workspace-watchlist-review.png')});
});

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

// The inline filter was removed. Existing query/filter regressions exercise bookmarked
// URL state; shared dialog interaction is covered separately below.
function bookmarkedQuery(page:import('@playwright/test').Page) {
 const fill=async(value:string)=>{
  const data=await page.evaluate(async()=>{try{return await fetch('/api/intelligence').then(response=>response.json());}catch{return null;}});
  const q=value.normalize('NFKC').trim().replace(/^\$/,'');
  const matches=(data?.graph?.nodes??snapshot.graph.nodes).filter((node:typeof snapshot.graph.nodes[number])=>q&&companySearchRank(node,q)===0);
  await page.evaluate(({value,id})=>{
    const url=new URL(location.href);
    for(const [key,item] of Object.entries({q:value,company:id,feedCompany:id,event:'',relationship:''})) { if(item)url.searchParams.set(key,item);else url.searchParams.delete(key); }
    url.searchParams.delete('page');history.replaceState(history.state,'',url);dispatchEvent(new Event('industry-browse-changed'));
  },{value,id:matches.length===1?matches[0].id:''});
 };
 return {fill,press:async(key:string)=>{if(key!=='Enter')throw new Error('Bookmark helper supports Enter only');},blur:async()=>{},click:async()=>{},pressSequentially:async(value:string,options?:{delay?:number})=>{if(options?.delay)await page.waitForTimeout(options.delay);await fill(value);}};
}
for(const view of ['graph','tree','hierarchy','table'])test(`shared company dialog selects a company in ${view}`,async({page})=>{
 await open(page);await page.goto(`http://workspace.test/?view=${view}`);
 await page.route('**/api/tickers/search*',route=>route.fulfill({json:{items:[{id:'US:MU',symbol:'MU',name:'Micron',market:'US'}]}}));
 await expect(page.getByPlaceholder('Search company / ticker')).toHaveCount(0);
 await page.getByRole('button',{name:'Search company',exact:true}).click();
 const input=page.getByRole('combobox',{name:'Search company',exact:true});await expect(input).toBeFocused();
 await input.fill('MU');await expect(page.getByRole('option',{name:/Micron/})).toBeVisible();await input.press('Enter');
 await expect(page.getByRole('dialog',{name:'Search company',exact:true})).toHaveCount(0);
 await expect(page).toHaveURL(/company=US%3AMU/);await expect(page.locator('[data-company-timeline="US:MU"]')).toBeVisible();
});
for(const view of ['graph','tree','hierarchy','table'])test(`sector selection replaces bookmarked filters in ${view}`,async({page},info)=>{
 await open(page);await bookmarkedQuery(page).fill('MULT');
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 await page.getByRole('button',{name:/^Memory & storage/}).click();
 await expect(page).not.toHaveURL(/company=|q=/);
 const list=info.project.name==='mobile'?page.getByRole('region',{name:'Company list',exact:true}):page.getByRole('complementary',{name:'Universe navigation'});
 await expect(list.getByRole('button',{name:info.project.name==='mobile'?'Micron':'MU Micron',exact:true})).toBeVisible();
});

for(const view of ['graph','tree','hierarchy','table'])test(`fullscreen ${view} lookup opens and switches visible candles`,async({page})=>{
 await open(page);await page.goto(`http://workspace.test/?view=${view}`);
 await page.route('**/api/tickers/search*',route=>route.fulfill({json:{items:[{id:'US:MU',symbol:'MU',name:'Micron',market:'US'},{id:'US:LITE',symbol:'LITE',name:'Lumentum',market:'US'}]}}));
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:new URL(route.request().url()).searchParams.get('company'),currency:'USD',available:true,prices:[{date:'2026-10-01',open:100,high:110,low:99,close:105,volume:1000},{date:'2026-10-02',open:105,high:115,low:100,close:110,volume:2000}]}}));
 const workspace=page.locator('section[aria-label="Company relationship chart"]');
 await workspace.getByRole('group',{name:'Company view size',exact:true}).getByRole('button',{name:'Full screen',exact:true}).click();
 for(const [id,name] of [['US:MU','Micron'],['US:LITE','Lumentum']]){
  await workspace.getByRole('button',{name:'Search company',exact:true}).click();
  await page.getByRole('combobox',{name:'Search company',exact:true}).fill(name);
  await page.getByRole('option',{name:new RegExp(name)}).click();
  const timeline=workspace.locator(`[data-company-timeline="${id}"]`);
  await expect(workspace).toHaveAttribute('data-chart-size','full');
  await expect(timeline.locator('[data-price-candle]').first()).toBeVisible();
  expect(await timeline.evaluate(el=>!!el.closest('[inert]'))).toBe(false);
  const bounds=(await timeline.locator('[data-price-candle]').first().boundingBox())!,dock=(await workspace.locator('[data-timeline-dock]').boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(dock.y);expect(bounds.y+bounds.height).toBeLessThanOrEqual(Math.min(dock.y+dock.height,page.viewportSize()!.height)+1);
 }
 const timeline=workspace.locator('[data-company-timeline="US:LITE"]');
 await timeline.getByRole('button',{name:'Close timeline',exact:true}).click();
 await workspace.getByRole('button',{name:'Search company',exact:true}).click();
 await page.getByRole('combobox',{name:'Search company',exact:true}).fill('Lumentum');
 await page.getByRole('option',{name:/Lumentum/}).click();
 await expect(timeline.locator('[data-price-candle]').first()).toBeVisible();
 await expect(workspace).toHaveAttribute('data-chart-size','full');
});

test('fullscreen lookup shows candles while company event sources are still loading',async({page})=>{
 const body=await workspaceFixture(false,snapshot,false);
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/*',async route=>{
  if(route.request().url().includes('/api/intelligence')){
   if(new URL(route.request().url()).searchParams.get('section')==='universe')return route.fulfill({json:{...snapshot,events:[],sourceDocuments:[],coverage:[],eventsPending:true}});
   await pending;return route.fulfill({json:snapshot});
  }
  return route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body}):route.fulfill({status:404,body:''});
 });
 await page.route('**/api/tickers/search*',route=>route.fulfill({json:{items:[{id:'US:MU',symbol:'MU',name:'Micron',market:'US'}]}}));
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:'US:MU',currency:'USD',available:true,prices:[{date:'2026-10-02',open:105,high:115,low:100,close:110,volume:2000}]}}));
 await page.goto('http://workspace.test/?view=graph');
 const workspace=page.locator('section[aria-label="Company relationship chart"]');
 await workspace.getByRole('group',{name:'Company view size',exact:true}).getByRole('button',{name:'Full screen',exact:true}).click();
 try{
  await workspace.getByRole('button',{name:'Search company',exact:true}).click();await page.getByRole('combobox',{name:'Search company',exact:true}).fill('MU');await page.getByRole('option',{name:/Micron/}).click();
  await expect(page.locator('aside[aria-label="Events and sources"]').getByText('Loading events and sources…')).toBeAttached();
  await expect(workspace.locator('[data-company-timeline="US:MU"] [data-price-candle]').first()).toBeVisible();
  await expect(workspace).toHaveAttribute('data-chart-size','full');
 }finally{release();}
 await expect(page.locator('aside[aria-label="Events and sources"]').getByText('Loading events and sources…')).toHaveCount(0);
});

for(const view of ['graph','tree','hierarchy','table'])test(`selected company price chart remains usable inside fullscreen ${view}`,async({page})=>{
 await open(page);
 await page.goto(`http://workspace.test/?view=${view}&company=US%3AMU`);
 const workspace=page.locator('section[aria-label="Company relationship chart"]');
 await workspace.getByRole('group',{name:'Company view size',exact:true}).getByRole('button',{name:'Full screen',exact:true}).click();
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
 await workspace.getByRole('group',{name:'Company view size',exact:true}).getByRole('button',{name:'Restore layout',exact:true}).click();
 await expect(workspace).toHaveAttribute('data-chart-size','compact');
 await expect(page.locator('[data-company-timeline="US:MU"]').getByLabel('Price history range')).toHaveValue('90');
});

test('workspace sizing preserves the timeline instance, closed state and loaded prices',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{}}}));
 await open(page);
 let requests=0;
 await page.route('**/api/company-timeline?*',route=>{requests++;return route.fulfill({json:{companyId:'US:MU',start:'2026-09-04',end:'2026-10-04',currency:'USD',available:true,prices:[{date:'2026-10-01',open:100,high:110,low:99,close:105,volume:1000},{date:'2026-10-02',open:105,high:115,low:100,close:110,volume:2000}]}});});
 await page.goto('http://workspace.test/?view=table&company=US%3AMU');
 const workspace=page.locator('section[aria-label="Company relationship chart"]');
 const timeline=workspace.locator('[data-company-timeline="US:MU"]');
 await expect(timeline.locator('[data-price-candle]')).toHaveCount(2);
 await timeline.evaluate(el=>{(window as unknown as {timelineNode:Element}).timelineNode=el;});
 const loadedRequests=requests;
 await timeline.getByRole('button',{name:'Copy chart link',exact:true}).click();
 await expect(timeline.getByRole('status')).toContainText('Chart link copied');
 await workspace.getByRole('group',{name:'Company view size',exact:true}).getByRole('button',{name:'Full screen',exact:true}).click();
 expect(await timeline.evaluate(el=>el===(window as unknown as {timelineNode:Element}).timelineNode)).toBe(true);
 await expect(timeline.getByRole('status')).toContainText('Chart link copied');
 await timeline.getByRole('button',{name:'Close timeline',exact:true}).click();
 await expect(timeline.getByRole('button',{name:'Show timeline',exact:true})).toBeVisible();
 await workspace.getByRole('group',{name:'Company view size',exact:true}).getByRole('button',{name:'Restore layout',exact:true}).click();
 await workspace.getByRole('group',{name:'Company view size',exact:true}).getByRole('button',{name:'Half screen',exact:true}).click();
 await expect(timeline.getByRole('button',{name:'Show timeline',exact:true})).toBeVisible();
 await workspace.getByRole('group',{name:'Company view size',exact:true}).getByRole('button',{name:'Full screen',exact:true}).click();
 await expect(timeline.getByRole('button',{name:'Show timeline',exact:true})).toBeVisible();
 await timeline.getByRole('button',{name:'Show timeline',exact:true}).click();
 await expect(timeline.locator('[data-price-candle]')).toHaveCount(2);
 expect(requests).toBe(loadedRequests);
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
 await relationship.getByRole('group',{name:'Company view size',exact:true}).getByRole('button',{name:'Half screen',exact:true}).click();await expect(relationship).toHaveAttribute('data-chart-size','half');
 expect((await relationship.boundingBox())!.height).toBeGreaterThanOrEqual(page.viewportSize()!.height*.49);
 await relationship.getByRole('group',{name:'Company view size',exact:true}).getByRole('button',{name:'Full screen',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Company relationship chart'})).toBeVisible();
 const graphBounds=(await relationship.boundingBox())!;expect(graphBounds.width).toBeGreaterThanOrEqual(page.viewportSize()!.width-1);
 await page.screenshot({path:`output/graph-full-${info.project.name}.png`});
 await page.keyboard.press('Escape');await expect(relationship).toHaveAttribute('data-chart-size','compact');
 await expect(relationship.getByRole('group',{name:'Company view size',exact:true}).getByRole('button',{name:'Full screen',exact:true})).toBeFocused();
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=bookmarkedQuery(page);await search.fill('MU');await search.press('Enter');
 const timeline=page.locator('[data-company-timeline="US:MU"]');await expect(timeline.locator('[data-price-candle]')).not.toHaveCount(0);
 for(const period of [5,10,20,60])await expect(timeline.locator(`[data-moving-average="${period}"]`)).toHaveAttribute('d',/^M.+L/);
 await expect(timeline.locator('[data-macd-panel]')).toHaveCount(0);
 await timeline.getByRole('button',{name:'Half screen',exact:true}).click();await expect(timeline).toHaveAttribute('data-chart-size','half');
 await timeline.getByRole('button',{name:'Full screen',exact:true}).click();await expect(timeline).toHaveAttribute('role','dialog');
 await timeline.getByRole('button',{name:'MA settings',exact:true}).click();
 const maDialog=page.getByRole('dialog',{name:'Moving average settings',exact:true});
 await maDialog.getByRole('button',{name:'MA60',exact:true}).click();
 await expect(timeline.locator('[data-moving-average="60"]')).toHaveCount(0);
 await maDialog.getByRole('button',{name:'MA60',exact:true}).click();
 await expect(timeline.locator('[data-moving-average="60"]')).toHaveAttribute('d',/^M.+L/);
 await maDialog.getByRole('button',{name:'Close MA settings'}).click();
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

for(const zh of [false,true])test(`chart indicator switches, custom averages, hover details and zoom ${zh?'Chinese':'English'}`,async({page},info)=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{(window as unknown as {copiedLink:string}).copiedLink=value;}}}));
 await open(page,zh,{...snapshot,events:[]});
 const bars:import('../../src/lib/ui/company-timeline').TimelinePrice[]=[];
 for(let date=Date.parse('2026-01-01'),index=0;date<=Date.parse('2026-10-09');date+=86_400_000){if([0,6].includes(new Date(date).getUTCDay()))continue;const close=100+index*.3+Math.sin(index++);bars.push({date:new Date(date).toISOString().slice(0,10),open:close+(index%2?-.5:.5),high:close+1,low:close-1,close,volume:1000+index});}
 let amounts=false;const requests:string[]=[];
 await page.route('**/api/company-timeline?*',route=>{const url=new URL(route.request().url());requests.push(url.href);const start=new Date(Date.parse('2026-10-11')-Number(url.searchParams.get('days')??30)*86_400_000).toISOString().slice(0,10);return route.fulfill({json:{companyId:'US:MU',start,end:'2026-10-11',currency:'USD',available:true,prices:bars.filter(bar=>bar.date>=start).map(bar=>({...bar,...(amounts?{amount:123456}: {})})),warmupPrices:bars.filter(bar=>bar.date<start)}});});
 await page.goto(`http://workspace.test/?company=US%3AMU${zh?'&lang=zh-CN':''}`);
 const timeline=page.locator('[data-company-timeline="US:MU"]'),svg=timeline.locator('svg[role=img]');
 await expect(timeline.locator('[data-moving-average="60"]')).toHaveAttribute('d',/^M.+L/);
 await timeline.getByRole('button',{name:zh?'成交额':'Turnover',exact:true}).click();await expect(svg).toContainText(zh?'成交额暂无数据':'Turnover unavailable');await expect(svg.locator('[data-volume-bar]')).toHaveCount(0);await expect(svg.locator('[data-turnover-bar]')).toHaveCount(0);
 await timeline.getByRole('button',{name:'MACD (12,26,9)',exact:true}).click();await expect(svg.locator('[data-macd-panel]')).toHaveCount(1);
 await timeline.getByRole('button',{name:'KDJ (9,3,3)',exact:true}).click();await expect(svg.locator('[data-macd-panel]')).toHaveCount(0);await expect(svg.locator('[data-kdj-line]')).toHaveCount(3);await expect(svg.locator('[data-kdj-line="j"]')).toHaveAttribute('d',/^M.+L/);
 const mainCandleY=await svg.locator('[data-price-candle] rect').evaluateAll(elements=>elements.map(element=>element.getAttribute('y')));
 await timeline.getByRole('button',{name:'BOLL (20,2)',exact:true}).click();await expect(svg.locator('[data-kdj-panel]')).toHaveCount(0);await expect(svg.locator('[data-boll-band]')).toHaveCount(3);await expect(svg.locator('[data-boll-band="upper"]')).toHaveAttribute('d',/^M.+L/);
 await expect(svg.locator('[data-boll-panel]')).toHaveCount(1);
 expect(await svg.locator('[data-price-candle] rect').evaluateAll(elements=>elements.map(element=>element.getAttribute('y')))).toEqual(mainCandleY);
 expect(await svg.locator('[data-boll-candle]').count()).toBe(await svg.locator('[data-price-candle]').count());
 const bollLayout=await svg.locator('[data-boll-panel]').evaluate(panel=>{
  const top=Number(panel.getAttribute('data-panel-top')),bottom=Number(panel.getAttribute('data-panel-bottom'));
  return {top,bottom,paths:Array.from(panel.querySelectorAll('[data-boll-band]')).map(path=>{const box=(path as SVGGraphicsElement).getBBox();return {top:box.y,bottom:box.y+box.height};})};
 });
 expect(bollLayout.top).toBeGreaterThan(Number(await svg.getAttribute('data-price-bottom')));
 for(const path of bollLayout.paths){expect(path.top).toBeGreaterThanOrEqual(bollLayout.top);expect(path.bottom).toBeLessThanOrEqual(bollLayout.bottom);}
 await timeline.getByRole('button',{name:zh?'全屏':'Full screen',exact:true}).click();await expect(timeline).toHaveAttribute('data-chart-size','full');
 await timeline.screenshot({path:`output/boll-lower-panel-${info.project.name}-${zh?'zh':'en'}.png`});
 await page.keyboard.press('Escape');await expect(timeline).toHaveAttribute('data-chart-size','compact');
 await timeline.getByRole('button',{name:zh?'均线设置':'MA settings',exact:true}).click();const settings=page.getByRole('dialog',{name:zh?'均线设置':'Moving average settings',exact:true});
 await settings.locator('input').nth(4).fill('120');await settings.getByRole('button',{name:zh?'应用':'Apply',exact:true}).click();await expect(timeline.locator('[data-moving-average="120"]')).toHaveAttribute('d',/^M.+L/);expect(requests.some(url=>url.includes('maPeriod=120'))).toBe(true);
 await timeline.getByRole('button',{name:zh?'复制图表链接':'Copy chart link',exact:true}).click();const share=new URL(await page.evaluate(()=>(window as unknown as {copiedLink:string}).copiedLink));expect(share.searchParams.get('chartIndicator')).toBe('boll');expect(share.searchParams.get('chartActivity')).toBe('turnover');expect(share.searchParams.get('chartMA')).toBe('5,10,20,60,120');
 await page.goto(`http://workspace.test/?${share.searchParams}${zh?'&lang=zh-CN':''}&company=US%3AMU`);await expect(timeline.getByRole('button',{name:'BOLL (20,2)',exact:true})).toHaveAttribute('aria-pressed','true');await expect(timeline.getByRole('button',{name:zh?'成交额':'Turnover',exact:true})).toHaveAttribute('aria-pressed','true');await expect(timeline.locator('[data-moving-average="120"]')).toHaveAttribute('d',/^M.+L/);
 amounts=true;await timeline.getByRole('combobox',{name:zh?'股价时间范围':'Price history range'}).selectOption('90');await expect(svg.locator('[data-turnover-bar]')).not.toHaveCount(0);await expect(svg).not.toContainText(zh?'成交额暂无数据':'Turnover unavailable');
 await timeline.getByRole('button',{name:zh?'成交量':'Volume',exact:true}).click();await expect(svg.locator('[data-volume-bar]')).not.toHaveCount(0);
 const total=await svg.locator('[data-price-candle]').count();await svg.press('ArrowUp');await expect(svg.locator('[data-price-candle]')).not.toHaveCount(total);const first=await svg.locator('[data-price-candle]').first().getAttribute('data-price-candle');await svg.press('ArrowLeft');await expect(svg.locator('[data-price-candle]').first()).not.toHaveAttribute('data-price-candle',first!);await svg.press('ArrowDown');await expect(svg.locator('[data-price-candle]')).toHaveCount(total);
 if(info.project.name==='desktop'){
  const details=timeline.getByRole('group',{name:zh?'股价详情':'Price details'});await svg.locator('[data-price-candle]').first().hover();await expect(details).toHaveAttribute('data-price-mode','hover');const before=(await details.boundingBox())!;await svg.locator('[data-price-candle]').nth(1).hover();const after=(await details.boundingBox())!;expect(after.x+after.width).toBeCloseTo(before.x+before.width,1);expect(after.y).toBeCloseTo(before.y,1);
  await page.evaluate(()=>{const original=window.matchMedia.bind(window);window.matchMedia=(query:string)=>query==='(pointer:coarse)'?{...original(query),matches:true} as MediaQueryList:original(query);});
  await svg.locator('[data-price-candle]').nth(1).click();await svg.hover({position:{x:5,y:5}});await expect(details).toHaveCount(0);
  const scroll=await page.evaluate(()=>scrollY);await page.mouse.wheel(0,-120);await expect(svg.locator('[data-price-candle]')).not.toHaveCount(total);expect(await page.evaluate(()=>scrollY)).toBe(scroll);await timeline.getByRole('button',{name:zh?'重置视图':'Reset view',exact:true}).click();await expect(svg.locator('[data-price-candle]')).toHaveCount(total);
  await page.context().route('**/company/micron',route=>route.fulfill({contentType:'text/html',body:'<h1>Company research fixture</h1>'}));
  const oldUrl=page.url(),popup=page.waitForEvent('popup');await svg.press('F10');const research=await popup;await expect(research).toHaveURL(new RegExp(`/${zh?'zh-cn':'en'}/company/micron`));await research.close();expect(page.url()).toBe(oldUrl);
 }else{await svg.locator('[data-price-candle] rect').first().tap();const details=timeline.getByRole('group',{name:zh?'股价详情':'Price details'});await expect(details).toBeVisible();await details.getByRole('button',{name:zh?'关闭股价详情':'Close price details'}).click();await expect(details).toHaveCount(0);}
 await expect(timeline.getByRole('link',{name:zh?'基本面（F10）':'Fundamentals (F10)',exact:true})).toHaveAttribute('target','_blank');
 await timeline.getByRole('button',{name:zh?'全屏':'Full screen',exact:true}).click();await expect(timeline).toHaveAttribute('data-chart-size','full');
 await timeline.screenshot({path:`output/chart-refinements-${zh?'zh':'en'}-${info.project.name}.png`});
 await page.addStyleTag({content:':root{--ui-surface:#fff;--ui-text:#172d40;--ui-muted:#536e85;--ui-line:#cad7e3;--ui-selected:#dceff3;--price-up:#008763;--price-down:#e52650;--chart-line:#0087a8;}'});await timeline.screenshot({path:`output/chart-refinements-${zh?'zh':'en'}-${info.project.name}-light.png`});
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
 await expect(timeline.locator('[data-moving-average="60"]')).toHaveAttribute('d',/^M.+L/);
 await timeline.getByRole('button',{name:'MACD (12,26,9)',exact:true}).click();await expect(timeline.locator('[data-macd-histogram]')).not.toHaveCount(0);
 await timeline.getByRole('combobox',{name:'Price history range'}).selectOption('90');await expect(timeline).toContainText('90 stored daily bars');
 await expect(timeline.getByRole('status')).toHaveCount(0);expect(requests).toEqual([]);
});

for(const zh of [false,true])test(`manual candle intervals override automatic range defaults ${zh?'Chinese':'English'}`,async({page},info)=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{(window as unknown as {copiedLink:string}).copiedLink=value;}}}));
 const items=['2026-09-15','2026-09-16','2026-06-15','2026-06-16','2026-02-28'].map((publication_date,index)=>({...snapshot.events[0],id:`period-event-${index}`,title:`Period disclosure ${index}`,published_at:null,publication_date,eventType:'product_business' as const,eventSubtype:'business_update'}));
 await open(page,zh,{...snapshot,events:items});
 const rows:import('../../src/lib/ui/company-timeline').TimelinePrice[]=[];
 for(let date=Date.parse('2020-12-31'),index=0;date<=Date.parse('2026-10-13');date+=86_400_000){if([0,6].includes(new Date(date).getUTCDay()))continue;const close=100+index++*.02;rows.push({date:new Date(date).toISOString().slice(0,10),open:close-.1,high:close+.2,low:close-.2,close,volume:100,amount:1000});}
 const requests:string[]=[];
 await page.route('**/api/company-timeline?*',route=>{
  const url=new URL(route.request().url()),range=url.searchParams.get('days');requests.push(url.searchParams.get('interval')!);
  const start=range==='1826'?'2021-10-13':range==='ytd'?'2026-01-01':new Date(Date.parse('2026-10-13')-Number(range)*86_400_000).toISOString().slice(0,10);
  return route.fulfill({json:{companyId:'US:MU',start,end:'2026-10-13',interval:'daily',currency:'USD',available:true,prices:rows.filter(row=>row.date>=start),warmupPrices:rows.filter(row=>row.date<start)}});
 });
 await page.goto(`http://workspace.test/?company=US%3AMU${zh?'&lang=zh-CN':''}`);
 const timeline=page.locator('[data-company-timeline="US:MU"]'),svg=timeline.locator('svg[role=img]'),range=timeline.getByRole('combobox',{name:zh?'股价时间范围':'Price history range'}),interval=timeline.getByRole('combobox',{name:zh?'K线周期':'Candlestick interval'});
 await expect(interval).toHaveValue('auto');await expect(interval.locator('option')).toHaveText(zh?['自动','日K','周K','月K','季K','年K']:['Auto','Daily','Weekly','Monthly','Quarterly','Yearly']);
 await expect(svg).toHaveAttribute('data-chart-interval','daily');
 await range.selectOption('1826');await expect(svg).toHaveAttribute('data-chart-interval','weekly');await expect.poll(()=>svg.locator('[data-price-candle]').count()).toBeGreaterThan(200);
 await interval.selectOption('daily');await expect(svg).toHaveAttribute('data-chart-interval','daily');await expect.poll(()=>svg.locator('[data-price-candle]').count()).toBeGreaterThan(1200);
 for(const [value,count] of [['monthly',61],['quarterly',21],['yearly',6]] as const){
  await interval.selectOption(value);await expect(svg).toHaveAttribute('data-chart-interval',value);await expect(svg.locator('[data-price-candle]')).toHaveCount(count);
  await expect.poll(()=>requests.at(-1)).toBe(value);
 }
 await interval.selectOption('monthly');await expect(svg.locator('[data-price-candle]')).toHaveCount(61);
 await timeline.getByRole('button',{name:zh?'曲线':'Line',exact:true}).click();await expect(svg.locator('[data-price-line]')).toHaveAttribute('d',/^M.+L/);await expect(svg.locator('[data-price-gap]')).toHaveCount(0);await timeline.getByRole('button',{name:zh?'蜡烛图':'Candles',exact:true}).click();
 await svg.press('End');const details=timeline.getByRole('group',{name:zh?'股价详情':'Price details'});await expect(details).toContainText('2026-10-01 – 2026-10-13');await expect(details).toContainText(zh?'月涨跌幅':'Monthly change');await expect(details).toContainText('900');await page.keyboard.press('Escape');
 await timeline.locator('button[data-event-count="2"]').last().click();const chooser=page.getByRole('group',{name:zh?'选择事件':'Choose an event'});await expect(chooser).toContainText(zh?'9月15日':'Sep 15');await expect(chooser).toContainText(zh?'9月16日':'Sep 16');await chooser.getByRole('button',{name:zh?'关闭事件列表':'Close event list'}).click();
 await timeline.locator('button[data-event-count="2"]').first().click();await chooser.getByRole('button',{name:/Period disclosure 2/}).click();const selected=page.getByRole('dialog',{name:zh?'事件详情':'Event details',exact:true});await expect(selected).toContainText('2026-06-15');
 for(let step=0;step<4;step++)await svg.press('ArrowUp');
 for(let step=0;step<30;step++)await svg.press('ArrowRight');
 await expect(svg.locator('[data-price-candle]')).toHaveCount(5);await expect(svg.locator('[data-price-candle]').first()).toHaveAttribute('data-price-candle','2026-06-30');
 await expect(selected).toBeVisible();await expect(timeline.locator('button[data-event-count="2"]')).toHaveCount(2);await selected.getByRole('button',{name:zh?'关闭事件详情':'Close event details',exact:true}).click();
 for(let step=0;step<8;step++)await svg.press('ArrowLeft');
 await expect(svg.locator('[data-price-candle]').last()).toHaveAttribute('data-price-candle','2026-02-27');await expect(timeline.getByRole('button',{name:/Period disclosure 4/})).toBeVisible();
 await timeline.getByRole('button',{name:zh?'重置视图':'Reset view',exact:true}).click();
 await range.selectOption('30');await expect(interval).toHaveValue('monthly');await expect(svg.locator('[data-price-candle]')).toHaveCount(2);
 await timeline.getByRole('button',{name:zh?'复制图表链接':'Copy chart link',exact:true}).click();const shared=new URL(await page.evaluate(()=>(window as unknown as {copiedLink:string}).copiedLink));expect(shared.searchParams.get('chartInterval')).toBe('monthly');expect(shared.searchParams.get('chartRange')).toBe('30');
 await page.reload();await expect(interval).toHaveValue('monthly');await expect(svg.locator('[data-price-candle]')).toHaveCount(2);
 await range.selectOption('1826');await interval.selectOption('yearly');await expect(svg.locator('[data-price-candle]')).toHaveCount(6);
 await timeline.getByRole('button',{name:zh?'全屏':'Full screen',exact:true}).click();await timeline.screenshot({path:`output/chart-periods-${info.project.name}-${zh?'zh':'en'}.png`});await page.keyboard.press('Escape');
 await interval.selectOption('auto');await expect(svg).toHaveAttribute('data-chart-interval','weekly');await range.selectOption('30');await expect(svg).toHaveAttribute('data-chart-interval','daily');
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
 const search=bookmarkedQuery(page);await search.fill('MU');await search.press('Enter');
 const timeline=page.locator('[data-company-timeline="US:MU"]'),range=timeline.getByRole('combobox',{name:'Price history range'});
 await expect(range).toHaveValue('30');await expect(range.locator('option')).toHaveText(['1M','3M','6M','YTD','1Y','5Y']);
 for(const value of ['90','180','ytd','365','1826']){await range.selectOption(value);await expect.poll(()=>requests.at(-1)).toBe(value);await expect(timeline.locator('[data-price-candle]')).not.toHaveCount(0);}
 await expect(timeline.locator('[data-price-candle]')).toHaveCount(2);await expect(timeline).toContainText('weekly bars');
 const svg=timeline.locator('svg[role=img]');await svg.press('End');
 const prices=timeline.getByRole('group',{name:'Price details'});await expect(prices).toContainText('Weekly change');await expect(prices).toContainText('2026-10-05 – 2026-10-09');
 await prices.getByRole('button',{name:'Close price details'}).click();
 await timeline.locator('button[data-event-count="2"]').click();const chooser=page.getByRole('group',{name:'Choose an event'});
 await expect(chooser).toContainText('Sep 28');await expect(chooser).toContainText('Sep 30');await chooser.getByRole('button',{name:'Close event list'}).click();
 await range.selectOption('30');await expect(timeline.locator('[data-price-candle]')).toHaveCount(3);await expect(timeline).toContainText('stored daily bars');
});

test('a missing weekly candle shows its actual return baseline',async({page})=>{
 await open(page,false,{...snapshot,events:[]});
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:'US:MU',start:'2021-10-11',end:'2026-10-11',currency:'USD',available:true,interval:'weekly',prices:[{date:'2026-09-25',periodStart:'2026-09-21',open:100,high:105,low:95,close:100,volume:100},{date:'2026-10-09',periodStart:'2026-10-05',open:100,high:115,low:99,close:110,volume:100}]}}));
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=bookmarkedQuery(page);await search.fill('MU');await search.press('Enter');
 const timeline=page.locator('[data-company-timeline="US:MU"]');await timeline.getByRole('combobox',{name:'Price history range'}).selectOption('1826');await expect(timeline.locator('[data-price-candle]')).toHaveCount(2);
 await timeline.locator('svg[role=img]').press('Enter');const tooltip=timeline.getByRole('group',{name:'Price details'});
 await expect(tooltip).toContainText('Change since 2026-09-25');await expect(tooltip).toContainText('+10.00%');await expect(tooltip).not.toContainText('Weekly change');
});

test('event windows open beside list items and markers, including fullscreen, without replacing company details',async({page},info)=>{
 const first={...snapshot.events[0],id:'near-first',title:'Nearby earnings announcement',eventType:'earnings' as const,publication_date:'2026-10-02',evidence:[snapshot.events[0].evidence[0],{id:'extra',url:'https://example.com/extra',title:'Second event reference',sourceDate:'2026-10-02',channel:'SEC' as const}]};
 const second={...snapshot.events[0],id:'near-second',title:'Nearby business announcement',eventType:'product_business' as const,publication_date:'2026-10-01'};
 await open(page,false,{...snapshot,events:[first,second],eventReturns:{'near-first':[{companyId:'US:MU',baselineDate:'2026-10-01',latestDate:'2026-10-05',baselineClose:100,latestClose:110,change:.1,dateOnly:true}]}});
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:'US:MU',start:'2026-09-11',end:'2026-10-11',currency:'USD',available:true,prices:[{date:'2026-10-01',close:100,volume:10},{date:'2026-10-02',close:105,volume:20},{date:'2026-10-05',close:110,volume:30}]}}));
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=bookmarkedQuery(page);await search.fill('MU');await search.press('Enter');
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

for(const zh of [false,true])test(`publication returns hide zero days and update at 24 hours ${zh?'Chinese':'English'}`,async({page})=>{
 await page.clock.install({time:new Date('2026-10-12T22:00:00Z')});
 const announcement={...snapshot.events[0],publication_date:'2026-10-12',published_at:'2026-10-12T13:00:00Z'};
 const fixture:IntelligenceSnapshot={...snapshot,events:[announcement],generatedAt:'2026-10-12T22:00:00Z',session:{...snapshot.session,date:'2026-10-12',startAt:'2026-10-12T04:00:00Z',endAt:'2026-10-13T04:00:00Z'},eventReturns:{[announcement.id]:[{companyId:'US:MU',baselineDate:'2026-10-09',latestDate:'2026-10-12',baselineClose:100,latestClose:97.72,change:-.0228,dateOnly:false}]}};
 await open(page,zh,fixture);
 await page.goto(`http://workspace.test/?company=US%3AMU&event=${announcement.id}${zh?'&lang=zh-CN':''}`);
 const range=page.getByRole('combobox',{name:zh?'股价时间范围':'Price history range'});
 await expect(range.locator('option')).toHaveText(zh?['近1个月','近3个月','近6个月','今年以来','近1年','近5年']:['1M','3M','6M','YTD','1Y','5Y']);
 await expect(page.getByRole('group',{name:zh?'时间范围':'Timeline range',exact:true})).toHaveCount(0);
 const details=page.getByRole('dialog',{name:zh?'事件详情':'Event details'});
 await expect(details).toContainText(zh?'发布以来:':'Since pub.:');
 await expect(details).toContainText('-2.28%');
 await expect(details).not.toContainText(zh?'发布以来 (3天)':'Since pub. (3d)');
 await expect(details).not.toContainText(zh?'发布以来 (0天)':'Since pub. (0d)');
 const returnLabel=details.locator('span[title*="2026-10-09"]');
 await expect(returnLabel).toHaveAttribute('title',/2026-10-12T13:00:00Z/);
 await expect(returnLabel).toHaveAttribute('title',/2026-10-09 → 2026-10-12/);
 await page.clock.setSystemTime(new Date('2026-10-13T12:58:00Z'));await page.clock.fastForward(60_000);
 await expect(details).toContainText(zh?'发布以来:':'Since pub.:');
 await page.clock.fastForward(60_000);
 await expect(details).toContainText(zh?'发布以来 (1天):':'Since pub. (1d):');
 await page.clock.setSystemTime(new Date('2026-10-14T13:00:00Z'));await page.clock.fastForward(60_000);
 await expect(details).toContainText(zh?'发布以来 (2天):':'Since pub. (2d):');
});

test('clicked price details show daily changes independently of event markers',async({page})=>{
 await page.clock.install({time:new Date('2026-10-03T22:00:00Z')});
 const fixture:IntelligenceSnapshot={...snapshot,events:[{...snapshot.events[0],id:'up',published_at:null,eventType:'earnings',publication_date:'2026-10-01'},{...snapshot.events[0],id:'down',published_at:null,eventType:'product_business',eventSubtype:'business_update',publication_date:'2026-10-02'},{...snapshot.events[0],id:'missing',published_at:null,eventType:'product_business',eventSubtype:'business_update',publication_date:'2026-10-02'},{...snapshot.events[0],id:'closed',published_at:null,eventType:'financing',publication_date:'2026-10-04'}],eventReturns:{up:[{companyId:'US:MU',baselineDate:'2026-09-30',latestDate:'2026-10-03',baselineClose:100,latestClose:103.2,change:.032,dateOnly:true}],down:[{companyId:'US:MU',baselineDate:'2026-10-01',latestDate:'2026-10-03',baselineClose:100,latestClose:98.2,change:-.018,dateOnly:true}]}};
 await open(page,false,fixture);
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:'US:MU',start:'2026-09-11',end:'2026-10-11',currency:'USD',available:true,prices:[{date:'2026-09-30',close:100,volume:10},{date:'2026-10-01',close:104,volume:20},{date:'2026-10-02',close:103,volume:30},{date:'2026-10-05',close:106,volume:40},{date:'2026-10-06',close:106,volume:50}]}}));
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=bookmarkedQuery(page);await search.fill('MU');await search.press('Enter');
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
 await expect(chooser.locator('[data-return-direction="down"]')).toContainText('Since pub. (1d): ▼ -1.80%');
 await expect(chooser.locator('[data-return-direction]')).toHaveCount(1);
 await chooser.getByRole('button',{name:'Close event list',exact:true}).click();
 const svg=timeline.locator('svg[role=img]');await svg.scrollIntoViewIfNeeded();
 const bounds=(await svg.boundingBox())!;
 const selectDay=async(index:number)=>{
   await svg.scrollIntoViewIfNeeded();
   await svg.press('Home');for(let day=0;day<index;day++)await svg.press('ArrowRight');
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
 const search=bookmarkedQuery(page);await search.fill('MU');await search.press('Enter');
 const timeline=page.locator('[data-company-timeline="US:MU"]');
 await expect(timeline).toContainText('2 stored daily bars');
 await expect(timeline.locator('[data-price-gap]')).toHaveAttribute('d',/^M[\d.,]+ L[\d.,]+$/);
 await expect(timeline.locator('[data-price-gap]')).toHaveAttribute('stroke-dasharray','4 4');
 await expect(timeline.locator('svg[role=img] rect')).toHaveCount(2);
 await timeline.locator('svg[role=img]').scrollIntoViewIfNeeded();
 const bounds=(await timeline.locator('svg[role=img]').boundingBox())!;
 await timeline.locator('svg[role=img]').press('End');
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('2026-10-08');
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('Close · $102.00');
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('Change since 2026-09-28 · ▲ +2.00%');
 await expect(timeline.getByRole('group',{name:'Price details'})).not.toContainText('Daily change');
 const tooltipBounds=(await timeline.getByRole('group',{name:'Price details'}).boundingBox())!;
 expect(tooltipBounds.x).toBeGreaterThanOrEqual(bounds.x);
 expect(tooltipBounds.x+tooltipBounds.width).toBeLessThanOrEqual(bounds.x+bounds.width);
});

test('bookmarked company selection emphasizes connected graph nodes like a node click',async({page},info)=>{
 test.skip(info.project.name!=='desktop','Actual WebGL selection regression');
 test.setTimeout(60000);
 await page.setViewportSize({width:1500,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 const fixture:IntelligenceSnapshot={...snapshot,graph:{...snapshot.graph,relationships:[{id:'memory-partner',source:'US:MU',target:'US:MEM',type:'PARTNER_OF',summary:'Memory partnership',commercialStatus:'DOCUMENTED',sourceIds:[]}]}};
 const body=await workspaceFixture(true,fixture);
 await page.route('**/*',route=>route.request().url().includes('/api/intelligence')?route.fulfill({json:fixture}):route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body}):route.fulfill({status:404,body:''}));
 await page.goto('http://workspace.test/?view=graph');
 await expect(page.locator('canvas')).toHaveAttribute('data-camera-position',/.+/);
 const search=bookmarkedQuery(page);
 await search.fill('mu');await search.press('Enter');await search.blur();
 await expect(page.locator('[data-company-id="US:MU"]')).toHaveAttribute('data-company-focus','selected');
 const partner=page.locator('[data-company-id="US:MEM"]');
 await expect(partner).toHaveAttribute('data-company-focus','connected');
 await expect.poll(()=>partner.evaluate(el=>el.style.getPropertyValue('--label-emphasis'))).toBe('');
 await expect(page.getByRole('region',{name:'Company details',exact:true})).toContainText('Memory partnership');
});

test('graph automatic orbit pauses while the shared search input is focused',async({page})=>{
 const body=await workspaceFixture(true);
 await page.route('**/*',route=>route.request().url().includes('/api/intelligence')?route.fulfill({json:snapshot}):route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body}):route.fulfill({json:{items:[]}}));
 await page.goto('http://workspace.test/?view=graph');
 const canvas=page.locator('[data-graph-interaction] canvas');await expect(canvas).toHaveAttribute('data-rotation','intro');
 await page.getByRole('button',{name:'Search company',exact:true}).click();
 const input=page.getByRole('combobox',{name:'Search company',exact:true});await expect(input).toBeFocused();
 await expect(canvas).toHaveAttribute('data-rotation','input');await input.fill('M');await expect(input).toHaveValue('M');
 await input.press('Escape');await expect(canvas).toHaveAttribute('data-rotation','intro');
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
 const search=bookmarkedQuery(page);
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 await search.click();
 const beforeSearch=requested.length;
 await search.pressSequentially('ARM',{delay:60});
 expect(requested.length).toBeGreaterThanOrEqual(beforeSearch);
 await expect(page).toHaveURL(/q=ARM/);
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
  const input=bookmarkedQuery(page);await input.fill('$ＭＵ');
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
  await expect(companyCard.getByRole('link',{name:'Relationship sources ↗'})).toHaveAttribute('href','/en/company/micron');
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
  await bookmarkedQuery(page).fill('MU');
  await expect(page).toHaveURL(/feedCompany=US%3AMU/);
  await page.getByRole('combobox',{name:'Investment theme',exact:true}).selectOption('robotics');
  await expect(page.getByRole('status').filter({hasText:'Loading Robotics…'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Reset universe view',exact:true})).toBeDisabled();
  await expect(page.locator('[data-list-company="US:MU"]')).toBeVisible();
  await expect(page).toHaveURL(/q=MU/);
  await expect(page.getByText('Loading companies and recorded events…',{exact:true})).toHaveCount(0);
  releaseRobotics();
  await expect(page).toHaveURL(/theme=robotics/);await expect(page.getByRole('combobox',{name:'Investment theme',exact:true})).toHaveCount(1);
  await expect(page).not.toHaveURL(/feedCompany=/);
  await expect(page.getByRole('tab',{name:'Company list',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('[data-list-company]')).toHaveCount(2);await expect(page.locator('[data-list-company="US:MU"]')).toHaveCount(0);
  expect(await workspace!.evaluate(element=>element.isConnected)).toBe(true);
  await expect(page).not.toHaveURL(/q=/);
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
  await bookmarkedQuery(page).fill('Lument');
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
  await bookmarkedQuery(page).fill('Lument');
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
  await bookmarkedQuery(page).fill('Micr');
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
  await bookmarkedQuery(page).fill('Lument');
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
 const search=bookmarkedQuery(page);await search.fill('MU');await search.press('Enter');
 const timeline=page.locator('[data-company-timeline="US:MU"]');
 await expect(timeline).toBeVisible();await expect(timeline).toContainText('2 stored daily bars');
 await expect(timeline.getByRole('group',{name:'Timeline range'})).toHaveCount(0);
 await expect(timeline.getByRole('button',{name:/^(3M|6M|1Y|5Y)$/})).toHaveCount(0);
 await expect(timeline.locator('svg[role=img]')).not.toContainText('Sources');
 expect((await timeline.locator('svg[role=img]').boundingBox())?.height).toBeGreaterThanOrEqual(190);
 const marker=timeline.getByRole('button',{name:/events · .* · Oct 2/}).first();
 await timeline.locator('svg[role=img]').scrollIntoViewIfNeeded();
 const markerBounds=await marker.boundingBox(),chartBounds=await timeline.locator('svg[role=img]').boundingBox();
 expect(markerBounds!.y+markerBounds!.height/2-chartBounds!.y).toBeGreaterThan(0);
 const priceTop=Number(await timeline.locator('svg[role=img]').getAttribute('data-price-top')),priceBottom=Number(await timeline.locator('svg[role=img]').getAttribute('data-price-bottom'));
 expect(markerBounds!.y-chartBounds!.y).toBeGreaterThanOrEqual(priceTop);
 expect(markerBounds!.y+markerBounds!.height-chartBounds!.y).toBeLessThanOrEqual(priceBottom);
 await timeline.locator('svg[role=img]').press('Home');
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('2026-10-01');
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('Close · $100.00');
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('Volume · 0');
 await timeline.locator('svg[role=img]').press('End');
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('2026-10-02');
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('Close · $102.00');
 await expect(timeline.getByRole('group',{name:'Price details'})).toContainText('Volume · Not recorded');
 await timeline.locator('svg[role=img]').press('Escape');await marker.click();
 await expect(timeline.getByRole('group',{name:'Price details'})).toHaveCount(0);
 if(await page.getByRole('group',{name:'Choose an event'}).count())await page.getByRole('button',{name:'Close event list',exact:true}).click();
 await timeline.getByRole('button',{name:'Close timeline',exact:true}).click();
 await expect(timeline.getByRole('button',{name:'Show timeline',exact:true})).toBeFocused();
 await expect(timeline.locator('svg[role=img]')).toHaveCount(0);
 await expect(page.getByRole('region',{name:'Company details',exact:true})).toBeVisible();
 await timeline.getByRole('button',{name:'Show timeline',exact:true}).press('Enter');
 await expect(timeline.getByRole('button',{name:'Close timeline',exact:true})).toBeFocused();
 await expect(timeline.locator('svg[role=img]')).toBeVisible();
 await timeline.getByRole('button',{name:/events · .* · Oct 2/}).first().click();
 await page.getByRole('group',{name:'Choose an event'}).getByRole('button',{name:/Published company update 1$/}).click();
 await expect(page).toHaveURL(/event=event-0/);
 await expect(page.getByRole('dialog',{name:'Event details',exact:true})).toContainText('Published company update 1');
 await page.getByRole('button',{name:'Close company details'}).click();await expect(timeline).toHaveCount(0);
 await search.fill('');await search.fill('MU');await search.press('Enter');
 await expect(timeline.getByRole('group',{name:'Timeline range'})).toHaveCount(0);
 const bounds=await timeline.boundingBox();expect(bounds?.width).toBeLessThanOrEqual(await page.evaluate(()=>innerWidth));
 });


test('timeline category symbols, count chooser and docked card retain all event references',async({page},info)=>{
 const classified=snapshot.events.map((e,i)=>({...e,eventType:i===0?'earnings':'insider_trade',eventSubtype:i===0?'earnings_results':'insider_sell',eventClassification:{version:1,method:'parser',rule:'fixture',evidence:['fixture']}})) as IntelligenceSnapshot['events'];
 classified[0]={...classified[0],evidence:[...classified[0].evidence,{id:'second-reference',url:'https://example.com/second',title:'Second filing reference',sourceDate:'2026-10-02',channel:'SEC'}]};
 await open(page,false,{...snapshot,events:classified});
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:'US:MU',start:'2026-09-11',end:'2026-10-11',currency:'USD',available:true,prices:[]}}));
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const search=bookmarkedQuery(page);await search.fill('MU');await search.press('Enter');
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
  const cardBounds=await card.boundingBox(),timelineBounds=await timeline.evaluate(el=>el.closest('[data-timeline-dock]')!.getBoundingClientRect().toJSON());
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
 const search=bookmarkedQuery(page);await search.fill('MU');await search.press('Enter');
 await page.addStyleTag({content:"button{min-height:32px}"});const timeline=page.locator('[data-company-timeline="US:MU"]');await expect(timeline).toContainText('20 stored daily bars');
 const svg=timeline.locator('svg[role=img]');await expect(svg).toHaveAttribute('data-event-layout','overlay');
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
 const search=bookmarkedQuery(page);await search.fill('MU');await search.press('Enter');
 const timeline=page.locator('[data-company-timeline="US:MU"]');await expect(timeline).toContainText('4 stored daily bars');
 const svg=timeline.locator('svg[role=img]');await expect(svg).toHaveAttribute('data-chart-type','candles');await expect(timeline.getByRole('button',{name:'Candles',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(svg.locator('[data-price-candle]')).toHaveCount(3);await expect(svg.locator('[data-candle-direction="up"] rect')).toHaveCSS('fill','rgb(85, 223, 187)');await expect(svg.locator('[data-candle-direction="down"] rect')).toHaveCSS('fill','rgb(255, 142, 161)');await expect(svg.locator('[data-candle-direction="flat"] rect')).toHaveAttribute('height','1');await expect(svg.locator('[data-price-candle="2026-10-08"]')).toHaveCount(0);await expect(svg.locator('[data-price-gap]')).toHaveCount(0);
 await expect(svg).toHaveAttribute('data-time-axis','trading-sessions');
 for(const direction of ['up','down','flat']){
  const candle=svg.locator(`[data-candle-direction="${direction}"] rect`),volume=svg.locator(`[data-volume-direction="${direction}"]`).first();
  expect(await volume.evaluate(el=>getComputedStyle(el).fill)).toBe(await candle.evaluate(el=>getComputedStyle(el).fill));
 }
 await page.addStyleTag({content:':root{--price-up:#ff8ea1;--price-down:#55dfbb;}'});
 await expect(svg.locator('[data-volume-direction="up"]')).toHaveCSS('fill','rgb(255, 142, 161)');
 await expect(svg.locator('[data-volume-direction="down"]')).toHaveCSS('fill','rgb(85, 223, 187)');
 await page.addStyleTag({content:':root{--price-up:#55dfbb;--price-down:#ff8ea1;}'});
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
 await svg.press('Home');await svg.press('ArrowRight');
 const tooltip=timeline.getByRole('group',{name:'Price details'});await expect(tooltip.locator('[data-hover-ohlc]')).toContainText('O 108.00 · H 112.00 · L 99.00');await expect(tooltip).toContainText('Daily change · ▼ -9.09%');await expect(tooltip.locator('[data-latest-return]')).toContainText('▲ +3.00%');
 await svg.press('Home');const cardBounds=(await tooltip.boundingBox())!,chartBounds=(await svg.boundingBox())!;expect(cardBounds.y).toBeGreaterThanOrEqual(chartBounds.y);expect(cardBounds.y+cardBounds.height).toBeLessThanOrEqual(chartBounds.y+chartBounds.height);await page.screenshot({path:`output/candlestick-${info.project.name}.png`});
 await timeline.getByRole('button',{name:'Line',exact:true}).click();await expect(svg).toHaveAttribute('data-chart-type','line');await expect(svg.locator('[data-price-candle]')).toHaveCount(0);await expect(svg.locator('[data-price-line]')).toHaveCount(1);await expect(svg.locator('[data-price-gap]')).toHaveCount(1);
 await timeline.getByRole('button',{name:'Candles',exact:true}).click();await expect(svg.locator('[data-price-candle]')).toHaveCount(3);
});

test('selected graph keeps its relationships while hovering partners and clicking lines',async({page},info)=>{
 test.skip(info.project.name!=='desktop','Actual WebGL relationship hit regression');test.setTimeout(60000);
 await page.setViewportSize({width:1500,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 const fixture:IntelligenceSnapshot={...snapshot,graph:{...snapshot.graph,relationships:[{id:'selected-partner',source:'US:LITE',target:'US:MU',type:'PARTNER_OF',summary:'Selected memory optics relationship',commercialStatus:'ANNOUNCED',sourceIds:[]},{id:'secondary-partner',source:'US:LITE',target:'US:MEM',type:'PARTNER_OF',summary:'Partner secondary network',commercialStatus:'DOCUMENTED',sourceIds:[]}]}};
 const body=await workspaceFixture(true,fixture);await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body}):route.request().url().includes('/api/intelligence')?route.fulfill({json:fixture}):route.fulfill({status:404,body:''}));
 await page.goto('http://workspace.test/?view=graph');const canvas=page.locator('canvas');await expect(canvas).toHaveAttribute('data-camera-position',/.+/);
 const search=bookmarkedQuery(page);await search.fill('MU');await search.press('Enter');await search.blur();
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


test('fullscreen lookup switches a stock inside the live workspace without remounting the chart', async ({ page }) => {
 await open(page);
 await page.route('**/api/company-timeline?*', route => { const companyId=new URL(route.request().url()).searchParams.get('company');return route.fulfill({json:{companyId,start:'2026-01-01',end:'2026-10-13',currency:'USD',interval:'daily',prices:[{date:'2026-10-12',open:100,high:110,low:99,close:105,volume:1000}],available:true}}); });
 await page.route('**/api/tickers/search?*', route => route.fulfill({json:{items:[{id:'US:LITE',symbol:'LITE',name:'Lumentum',market:'US',exchange:'NASDAQ'}]}}));
 await page.goto('http://workspace.test/?company=US%3AMU&chartMA=none');
 const chart=page.locator('[data-company-timeline="US:MU"]');
 await chart.getByRole('button',{name:'Full screen',exact:true}).click();
 await chart.focus();await page.keyboard.type('lite');
 await expect(page.getByRole('option',{name:/Lumentum/})).toBeVisible();await page.keyboard.press('Enter');
 await expect(page.locator('[data-company-timeline="US:LITE"]')).toHaveAttribute('data-chart-size','full');
 await expect(page.getByRole('dialog',{name:'Company event and price timeline · Lumentum · LITE',exact:true})).toContainText('Lumentum');
});

for(const chinese of [false,true])test(`Explore text-to-search is quiet, ignores control keys and works on mobile ${chinese?'Chinese':'English'}`,async({page},info)=>{
 await open(page,chinese);
 await page.route('**/api/tickers/search*',route=>route.fulfill({json:{items:[{id:'US:MU',symbol:'MU',name:'Micron',market:'US'}]}}));
 const name=chinese?'搜索公司':'Search company';
 await page.locator('main').click({position:{x:2,y:2}});
 for(const key of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape','Enter','Tab','F2','Control+k','Alt+a','Meta+a']){
  await page.keyboard.press(key);await expect(page.getByRole('dialog',{name,exact:true})).toHaveCount(0);
 }
 await page.keyboard.type('m');const dialog=page.getByRole('dialog',{name,exact:true});
 await expect(dialog.getByRole('combobox')).toHaveValue('m');await expect(dialog.getByRole('combobox')).toBeFocused();
 await expect(dialog).not.toContainText('↑');await expect(dialog).not.toContainText('Chinese / pinyin');
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 const button=page.getByRole('button',{name,exact:true});await expect(button).toHaveAttribute('title',name);
 await button.click();await expect(dialog.getByRole('combobox')).toBeFocused();
 if(info.project.name==='mobile')expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await dialog.getByRole('combobox').fill('meiguang');await expect(dialog.getByRole('option')).toBeVisible();
 // Inline popups retain readable result metadata rather than inheriting toolbar typography.
 const popupType=await dialog.evaluate(el=>{const option=el.querySelector('[role="option"]')!,metadata=option.querySelector('span')!;return {panelColor:getComputedStyle(el).color,optionColor:getComputedStyle(option).color,metadataColor:getComputedStyle(metadata).color,metadataSize:parseFloat(getComputedStyle(metadata).fontSize),metadataWrap:getComputedStyle(metadata).whiteSpace};});
 expect(popupType.optionColor).toBe(popupType.panelColor);expect(popupType.metadataColor).not.toBe(popupType.optionColor);expect(popupType.metadataSize).toBeGreaterThanOrEqual(12);expect(popupType.metadataWrap).not.toBe('nowrap');
 await page.screenshot({path:`output/unified-search-${chinese?'zh':'en'}-${info.project.name}.png`});
 await page.keyboard.press('Enter');await expect(dialog).toHaveCount(0);await expect(page).toHaveURL(/company=US%3AMU/);
});

test('header and Explore entry points share one dialog and fullscreen gives the nested chart priority',async({page})=>{
 const body=await workspaceFixture(false,snapshot,true,true);
 await page.route('**/*',route=>route.request().url().includes('/api/intelligence')?route.fulfill({json:snapshot}):route.request().url().includes('/api/tickers/search')?route.fulfill({json:{items:[{id:'US:LITE',symbol:'LITE',name:'Lumentum',market:'US'}]}}):route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body}):route.fulfill({status:404,body:''}));
 await page.goto('http://workspace.test/?company=US%3AMU');
 const header=page.locator('[data-company-search-owner="global"] button[data-company-search-trigger]');
 await header.click();await expect(page.getByRole('dialog',{name:'Search company',exact:true})).toHaveCount(1);
 await expect(page.locator('[data-company-search-owner="workspace"] [data-company-search]')).toBeVisible();
 await page.keyboard.press('Escape');
 const chart=page.locator('[data-company-timeline="US:MU"]');await chart.getByRole('button',{name:'Full screen',exact:true}).click();
 await chart.focus();await page.keyboard.type('lite');await expect(page.getByRole('dialog',{name:'Search company',exact:true})).toHaveCount(1);
 await expect(chart.locator('[data-company-search]')).toBeVisible();await expect(page.getByRole('option',{name:/Lumentum/})).toBeVisible();
 await page.keyboard.press('Enter');await expect(page.locator('[data-company-timeline="US:LITE"]')).toHaveAttribute('data-chart-size','full');
});
