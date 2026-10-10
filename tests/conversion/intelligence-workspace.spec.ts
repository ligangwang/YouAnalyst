import {expect,test} from '@playwright/test';
import {componentFixtureHtml} from './fixtures/component-html';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import type {IntelligenceSnapshot} from '../../src/lib/intelligence/model';
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
async function workspaceFixture(realCharts=false,fixture=snapshot){
  return componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {LiveInvestmentIntelligence} from './src/components/live-investment-intelligence';createRoot(document.getElementById('root')).render(<LiveInvestmentIntelligence initialSnapshot={${JSON.stringify(fixture)}}/>);`,{jsx:'automatic',define:{'process.env':'{}'},alias:{'next/link':path.resolve('tests/conversion/fixtures/mocks.tsx'),'@/components/providers/auth-provider':path.resolve('tests/conversion/fixtures/mocks.tsx')},plugins:[{name:'workspace-services',setup(build){
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

for(const zh of [false,true])test('region filter keeps companies, feed and complete source counts aligned in '+(zh?'Chinese':'English'),async({page})=>{
 const marketNodes=[...companies,{id:'XSHG:688072',symbol:'688072',name:'Piotech',kind:'COMPANY',stageIds:['memory']},{id:'XSHE:300308',symbol:'300308',name:'Innolight',kind:'COMPANY',stageIds:['optics']},{id:'PRIVATE:OPENAI',name:'OpenAI',kind:'COMPANY',stageIds:['compute']}];
 const marketEvents=[['us','US:MU'],['shanghai','XSHG:688072'],['shenzhen','XSHE:300308'],['private','PRIVATE:OPENAI'],['mixed','US:MU']].map(([id,origin],i)=>({...events[0],id,origin,companyIds:id==='mixed'?['US:MU','XSHG:688072']:[origin],title:`Market event ${id}`,titleZh:undefined,titleEn:undefined,calendarEvents:undefined,publication_date:snapshot.session.date,evidence:[{...events[0].evidence[0],id:`market-${i}`,url:`https://investors.example.com/market-${i}`}]}));
 const prior={...marketEvents[0],id:'prior',title:'Prior US event',publication_date:'2026-10-02',evidence:[{...marketEvents[0].evidence[0],id:'prior',url:'https://investors.example.com/prior'}]};
 const fixture={...snapshot,graph:{...snapshot.graph,nodes:marketNodes},events:[...marketEvents,prior],sourceDocuments:[...marketEvents.map(e=>({id:e.evidence[0].url,channel:'IR',companyIds:e.companyIds,published_at:null,publication_date:e.publication_date})),{id:'extra-cn',channel:'IR',companyIds:['XSHG:688072'],published_at:null,publication_date:snapshot.session.date},{id:prior.evidence[0].url,channel:'IR',companyIds:prior.companyIds,published_at:null,publication_date:prior.publication_date}]} as IntelligenceSnapshot;
 fixture.newsCoverage={total:4,configured:3,healthy:2,companyIds:['US:MU','XSHG:688072','XSHE:300308','PRIVATE:OPENAI'],configuredCompanyIds:['US:MU','XSHG:688072','XSHE:300308'],healthyCompanyIds:['US:MU','XSHG:688072']};
 fixture.eventReturns={mixed:[{companyId:'US:MU',baselineDate:'2026-10-01',latestDate:'2026-10-02',baselineClose:100,latestClose:110,change:.1,dateOnly:true},{companyId:'XSHG:688072',baselineDate:'2026-10-01',latestDate:'2026-10-02',baselineClose:100,latestClose:120,change:.2,dateOnly:true}]};
 fixture.events[4].calendarEvents=[{id:'us-calendar',companyId:'US:MU',day:'2026-10-28'},{id:'cn-calendar',companyId:'XSHG:688072',day:'2026-10-28'}];
 await open(page,zh,fixture);
 if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();
 const panel=page.getByRole('complementary',{name:'Events and sources'}),filter=page.getByRole('complementary',{name:'Universe navigation'}).getByRole('combobox',{name:zh?'地区':'Region'});
 const documents=panel.getByText(zh?'来源文档':'Source documents',{exact:true}).locator('..');
 await expect(filter).toHaveValue('');await expect(documents).toContainText('6');
 const news=page.getByLabel(zh?'公司新闻采集覆盖':'Company news collector coverage');await expect(news).toContainText('3/4');
 await expect(panel.getByRole('button',{name:/Market event /})).toHaveCount(5);
 await filter.selectOption('US');await expect(page).toHaveURL(/region=US/);
 await expect(documents).toContainText('2');await expect(panel.getByRole('button',{name:/Market event /})).toHaveCount(2);
 await expect(news).toContainText('1/1');await expect(panel.locator('a[href*="event=cn-calendar"]')).toHaveCount(0);
 await expect(panel.getByRole('button',{name:/Market event private|Market event shanghai|Market event shenzhen/})).toHaveCount(0);
 await panel.getByRole('button',{name:/Market event mixed/}).click();
 await expect(page.getByRole('region',{name:'Company details',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Company details',exact:true})).toContainText('+10.00%');
 await filter.selectOption('CN_A');
 await expect(page.getByRole('region',{name:'Company details',exact:true})).toHaveCount(0);
 await expect(documents).toContainText('4');await expect(panel.getByRole('button',{name:/Market event /})).toHaveCount(3);
 await expect(news).toContainText('2/2');await expect(panel.locator('a[href*="event=us-calendar"]')).toHaveCount(0);
 await expect(panel.getByRole('button',{name:/Market event mixed/})).toBeVisible();
 await panel.getByRole('button',{name:/Market event mixed/}).click();
 const mixedCard=page.getByRole('region',{name:'Company details',exact:true});await expect(mixedCard.locator('[data-card-drag]')).toContainText('Piotech');await expect(mixedCard).toContainText('+20.00%');await expect(mixedCard).not.toContainText('+10.00%');await mixedCard.press('Escape');
 await page.getByRole('tab',{name:zh?'公司列表':'Company list',exact:true}).click();
 await expect(page.locator('[data-list-company]')).toHaveCount(2);
 await panel.getByRole('button',{name:zh?'近 30 天':'30d',exact:true}).click();await expect(filter).toHaveValue('CN_A');await expect(documents).toContainText('4');
 await page.reload();if(await page.getByRole('button',{name:'Expand left panel'}).count())await page.getByRole('button',{name:'Expand left panel'}).click();await expect(filter).toHaveValue('CN_A');await expect(page.locator('[data-list-company]')).toHaveCount(2);
 await filter.selectOption('US');await expect(documents).toContainText('2');
 await panel.getByRole('button',{name:zh?'近 30 天':'30d',exact:true}).click();await expect(documents).toContainText('3');await expect(panel.getByRole('button',{name:/Prior US event/})).toBeVisible();
 await filter.selectOption('');await expect(page).not.toHaveURL(/region=/);await expect(documents).toContainText('7');await expect(panel.getByRole('button',{name:/Market event private/})).toBeVisible();await expect(page.locator('[data-list-company]')).toHaveCount(marketNodes.length);
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
  const selection=page.getByRole('region',{name:'Company details',exact:true});await expect(selection).toBeVisible();await expect(selection).toBeFocused();
  await expect(panel.getByRole('region',{name:'Company details'})).toHaveCount(0);
  const bounds=await selection.boundingBox();expect(bounds!.y).toBeLessThan(180);
  await expect(selection.getByRole('link',{name:/Original release 1/})).toBeVisible();
  const graphSource=page.getByRole('region',{name:'Graph universe'}).getByRole('link',{name:'Published company update 1 ↗',exact:true});
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
  await expect(selection.getByRole('link',{name:/Original release 1/})).toBeVisible();
  await page.getByRole('tab',{name:'Company hierarchy',exact:true}).click();
  await expect(page.locator('[data-industry-tree="hierarchy"] svg')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('tab',{name:'Industry tree',exact:true}).click();
  await expect(page.locator('[data-industry-tree="vertical"]')).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Tour speed'})).toBeVisible();
  await page.getByRole('tab',{name:'Relationship graph',exact:true}).click();
  await expect(page.getByRole('tab',{name:'Relationship graph',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(selection).toBeVisible();await selection.press('Escape');await expect(selection).toHaveCount(0);
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
  const selection=page.getByRole('region',{name:'Company details',exact:true});await expect(selection).toBeVisible();await expect(selection.getByText('选中事件',{exact:true})).toBeVisible();await selection.press('Escape');await expect(selection).toHaveCount(0);
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
  await page.getByRole('combobox',{name:'Investment theme',exact:true}).selectOption('robotics');
  await expect(page.getByRole('status').filter({hasText:'Loading Robotics…'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Reset universe view',exact:true})).toBeDisabled();
  await expect(page.locator('[data-list-company="US:MU"]')).toBeVisible();
  await expect(page.getByPlaceholder('Search company / ticker')).toHaveValue('MU');
  await expect(page.getByText('Loading companies and recorded events…',{exact:true})).toHaveCount(0);
  releaseRobotics();
  await expect(page).toHaveURL(/theme=robotics/);await expect(page.getByRole('combobox',{name:'Investment theme',exact:true})).toHaveCount(1);
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

test('detail save confirms beside the click',async({page},info)=>{
  test.skip(info.project.name!=='desktop','Desktop detail panel placement');
  await page.setViewportSize({width:1500,height:800});
  await open(page);
  await page.getByRole('textbox',{name:'Search companies'}).fill('LITE');
  await page.getByRole('button',{name:'LITE Lumentum',exact:true}).click();
  const save=page.getByRole('button',{name:/Save company/});
  const bounds=(await save.boundingBox())!;
  const x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
  await save.click();
  const notice=page.getByRole('status').filter({hasText:'LITE followed'});
  await expect(notice).toBeVisible();
  const confirmation=(await notice.boundingBox())!;
  expect(Math.abs(confirmation.y-y-14)).toBeLessThanOrEqual(1);
  expect(Math.min(Math.abs(confirmation.x-x-14),Math.abs(confirmation.x+confirmation.width-x+14))).toBeLessThanOrEqual(1);
});


test('graph company details float inside the graph and move independently of the event panel',async({page},info)=>{
  const mobile=info.project.name==='mobile';
  if(!mobile)await page.setViewportSize({width:1500,height:800});
  await open(page);
  await page.getByRole('tab',{name:'Relationship graph',exact:true}).click();
  const expand=page.getByRole('button',{name:'Expand left panel',exact:true});
  if(await expand.isVisible())await expand.click();
  await page.getByRole('textbox',{name:'Search companies'}).fill('LITE');
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
  await page.getByRole('textbox',{name:'Search companies'}).fill('MU');
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
 const card=page.getByRole('region',{name:'Company details',exact:true});
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

for(const view of ['graph','tree','hierarchy','table'])test(view+' event selection opens the company card at the chart top right',async({page},info)=>{
 await open(page);
 await page.goto('http://workspace.test/?view='+view);
 const panel=page.getByRole('complementary',{name:'Events and sources'});
 await panel.getByRole('button',{name:/Published company update 1 /}).click();
 const card=page.getByRole('region',{name:'Company details',exact:true});
 await expect(card).toBeVisible();await expect(card).toBeFocused();
 await expect(card.locator('[data-card-drag]')).toContainText('Micron');
 await expect(card.getByRole('heading',{name:'Selected event',exact:true})).toBeVisible();
 await expect(card).toContainText('Source summary 1');
 await expect(card.getByRole('link',{name:/Original release 1/})).toHaveAttribute('href','https://investors.example.com/0');
 await expect(panel.getByRole('region',{name:'Company details'})).toHaveCount(0);
 const host=page.locator('[data-company-workspace]');
 const atTopRight=async()=>{
  const box=(await card.boundingBox())!,bounds=(await host.boundingBox())!;
  expect(Math.abs(box.x+box.width-(bounds.x+bounds.width-12))).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y-Math.max(bounds.y+12,12))).toBeLessThanOrEqual(2);
 };
 await atTopRight();
 const before=(await card.boundingBox())!,handle=card.locator('[data-card-drag]');
 await handle.press('ArrowDown');
 await expect.poll(async()=>(await card.boundingBox())!.y-before.y).toBeGreaterThan(10);
 const drag=(await handle.boundingBox())!;
 await page.mouse.move(drag.x+20,drag.y+10);await page.mouse.down();
 await page.mouse.move(drag.x-30,drag.y+50,{steps:6});await page.mouse.up();
 await expect.poll(async()=>Math.abs((await card.boundingBox())!.x-before.x)+Math.abs((await card.boundingBox())!.y-before.y)).toBeGreaterThan(30);
 // Selecting another event for the same company replaces its content and resets placement.
 await panel.getByRole('button',{name:/Published company update 2 /}).click();
 await expect(card).toContainText('Source summary 2');await atTopRight();
 await page.screenshot({path:info.outputPath('selected-event-company-card.png')});
 await card.press('Escape');await expect(card).toHaveCount(0);
 await panel.getByRole('button',{name:/Published company update 1 /}).click();
 await expect(card).toBeVisible();await atTopRight();
 await page.getByRole('button',{name:'Close company details',exact:true}).click();
 await expect(card).toHaveCount(0);
});

for(const view of ['tree','hierarchy','table'])test(view+' company selection opens a movable card at the chart top right',async({page})=>{
 await open(page);
 await page.goto('http://workspace.test/?view='+view);
 const expand=page.getByRole('button',{name:'Expand left panel',exact:true});
 if(await expand.isVisible())await expand.click();
 await page.getByRole('button',{name:'Collapse right panel',exact:true}).click();
 if(view!=='table')await page.getByRole('textbox',{name:'Search companies'}).fill('LITE');
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
