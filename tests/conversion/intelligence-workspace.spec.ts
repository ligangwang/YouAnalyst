import {expect,test} from '@playwright/test';
import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import type {IntelligenceSnapshot} from '../../src/lib/intelligence/model';
import {accelerateTours,tourClockPlugin} from './fixtures/tour-clock';

const companies=[{id:'US:LITE',symbol:'LITE',name:'Lumentum',summary:'Communication supplier',kind:'COMPANY',order:1,stageIds:['optics']},{id:'US:MULT',symbol:'MULT',name:'Multiple Systems',kind:'COMPANY',order:2,stageIds:['compute']},{id:'US:MU',symbol:'MU',name:'Micron',kind:'COMPANY',order:3,stageIds:['memory']},{id:'US:MEM',symbol:'MEM',name:'Memory Supplier',summary:'Memory partner',kind:'COMPANY',order:4,stageIds:['memory']}];
const events=Array.from({length:200},(_,i)=>({id:`event-${i}`,origin:'US:MU',companyIds:['US:MU'],edgeIds:[],category:'BUSINESS',title:`Published company update ${i+1}`,summary:`Source summary ${i+1}`,published_at:i===0?'2026-10-02T12:00:00Z':null,publication_date:'2026-10-02',eventDate:null,evidence:[{id:`source-${i}`,url:`https://investors.example.com/${i}`,title:`Original release ${i+1}`,sourceDate:'2026-10-02',channel:'IR'}],planned:false}));
events[1].companyIds=['US:MU','US:MEM','US:MULT','US:LITE','US:UNKNOWN'];
events[199]={...events[199],origin:'US:LITE',companyIds:['US:LITE'],title:'Lumentum communication update'};
const snapshot={graph:{asOf:'2026-10-04',nodes:companies,relationships:[],sources:[]},graphVersion:'fixture',events,generatedAt:'2026-10-04T16:00:00Z',session:{date:'2026-10-04',timeZone:'America/New_York',startAt:'2026-10-04T04:00:00Z',endAt:'2026-10-05T04:00:00Z'},coverage:[{channel:'IR',status:'connected'}],sourceDocuments:Array.from({length:350},(_,i)=>({id:`https://investors.example.com/${i}`,channel:'IR',companyIds:['US:MU'],published_at:null,publication_date:'2026-10-02'})),statisticsComplete:true,warnings:[],truncated:true,limit:200} as IntelligenceSnapshot;
let html:string;
snapshot.sourceDocuments![349].companyIds=['US:LITE'];
async function workspaceFixture(realCharts=false){
  const bundled=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {LiveInvestmentIntelligence} from './src/components/live-investment-intelligence';createRoot(document.getElementById('root')).render(<LiveInvestmentIntelligence initialSnapshot={${JSON.stringify(snapshot)}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outfile:'fixture.js',platform:'browser',jsx:'automatic',define:{'process.env':'{}'},alias:{'next/link':path.resolve('tests/conversion/fixtures/mocks.tsx')},plugins:[{name:'workspace-services',setup(build){
    build.onResolve({filter:realCharts?/(?:locale-provider|company-follow-button|site-nav|next\/image)$/:/(?:company-graph-3d|industry-tree-scene|locale-provider|company-follow-button|site-nav|next\/image)$/},args=>({path:args.path.split('/').at(-1)!,namespace:'workspace-mock'}));
    build.onLoad({filter:/.*/,namespace:'workspace-mock'},args=>({loader:'tsx',resolveDir:process.cwd(),contents:args.path==='company-graph-3d'?`export default function Graph(){return <div style={{height:'100%',background:'radial-gradient(ellipse at center,#123b45,#07111b 70%)'}}>Local interaction fixture</div>}`:args.path==='industry-tree-scene'?`export default function Scene(){return <div>Tree interaction fixture</div>}`:args.path==='locale-provider'?`export function useLocale(){const chinese=new URLSearchParams(location.search).get('lang')==='zh-CN';return {locale:chinese?'zh-CN':'en',chinese,text:(en,zh)=>chinese?zh:en}};export function LanguageSwitch(){return <button>中文</button>}`:args.path==='company-follow-button'?`export function CompanyFollowButton(){return null}export function useCompanyFollows(){return {user:null,ids:[],change:async()=>{}}}`:args.path==='site-nav'?`export function AvatarButton(){return <span>Profile</span>}`:`export default function Image({priority,...props}){return <img {...props}/>} `}));
  }},...(realCharts?[tourClockPlugin]:[])]});
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}*{box-sizing:border-box}a{color:inherit;text-decoration:none}${bundled.outputFiles.find(file=>file.path.endsWith('.css'))?.text??''}</style></head><body><div id="root"></div><script>${bundled.outputFiles.find(file=>file.path.endsWith('.js'))!.text.replaceAll('</script','<\\/script')}</script></body></html>`;
}
test.beforeAll(async()=>{
  html=await workspaceFixture();
  if(process.env.INTELLIGENCE_PREVIEW_OUT){const directory=process.env.INTELLIGENCE_PREVIEW_OUT;mkdirSync(path.join(directory,'api'),{recursive:true});writeFileSync(path.join(directory,'index.html'),html);writeFileSync(path.join(directory,'api/intelligence'),JSON.stringify(snapshot));}
});
async function open(page:import('@playwright/test').Page,zh=false){
  await page.route('**/*',route=>route.request().url().includes('/api/intelligence')?route.fulfill({json:snapshot}):route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.fulfill({status:404,body:''}));
  await page.goto(`http://workspace.test/${zh?'?lang=zh-CN':''}`);
}

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
  const selection=panel.getByRole('region',{name:'Selected sources'});await expect(selection).toBeVisible();await expect(selection).toBeFocused();
  const bounds=await selection.boundingBox();expect(bounds!.y).toBeLessThan(180);expect(bounds!.height).toBeLessThan(400);
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
  await expect(selection.getByRole('link',{name:'Company research ↗'})).toHaveAttribute('href','/en/ticker/MU');
  await page.reload();await expect(selection.getByRole('link',{name:'Company research ↗'})).toBeVisible();
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
  const selection=panel.getByRole('region',{name:'选中来源'});await expect(selection).toBeVisible();await expect(selection.getByText('选中事件',{exact:true})).toBeVisible();await selection.press('Escape');await expect(selection).toHaveCount(0);
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
  const replayableAi:IntelligenceSnapshot={...snapshot,events:[...snapshot.events,{...snapshot.events[0],id:'today-event',title:'Today release',publication_date:snapshot.session.date,published_at:'2026-10-04T12:00:00Z',evidence:[{id:'today-source',url:'https://investors.example.com/today',title:'Today release',sourceDate:snapshot.session.date,channel:'IR'}]}],sourceDocuments:[...snapshot.sourceDocuments!,{id:'https://investors.example.com/today',channel:'IR',companyIds:['US:MU'],published_at:'2026-10-04T12:00:00Z',publication_date:snapshot.session.date}]};
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
    await route.fulfill({json:theme==='space'?space:theme==='robotics'?robotics:replayableAi});
  });
  // Start with the replacement route installed; a focus event can race the initial in-flight refresh.
  await page.reload();
  await expect(page.getByRole('button',{name:'Replay',exact:true})).toBeEnabled();
  const workspace=await page.locator('main').elementHandle();
  await page.getByRole('button',{name:'Save MU',exact:true}).click();
  await page.getByRole('tab',{name:'Company list',exact:true}).click();
  await page.getByPlaceholder('Search company / ticker').fill('MU');
  await page.getByRole('combobox',{name:'Investment theme',exact:true}).selectOption('robotics');
  await expect(page.getByRole('status').filter({hasText:'Loading Robotics…'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Replay',exact:true})).toBeDisabled();
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
  await expect(page.locator('[data-list-company]')).toHaveCount(4);await expect(page.getByRole('button',{name:'Unsave MU',exact:true})).toBeVisible();
});
