import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {componentFixtureHtml} from './fixtures/component-html';

let html:string;
const graph={asOf:'2026-10-14',relationships:[],sources:[],nodes:[
 {id:'US:AMD',kind:'COMPANY',order:0,symbol:'AMD',name:'AMD',names:{'zh-CN':'超威半导体'},stageIds:['design'],dailyPrice:{close:110,currency:'USD',tradingDate:'2026-10-14',previousTradingDate:'2026-10-13',change:.1}},
 {id:'US:NVDA',kind:'COMPANY',order:1,symbol:'NVDA',name:'NVIDIA',names:{'zh-CN':'英伟达'},stageIds:['design'],dailyPrice:{close:200,currency:'USD',tradingDate:'2026-10-13',previousTradingDate:'2026-10-12',change:-.02}},
 {id:'US:CEG',kind:'COMPANY',order:2,symbol:'CEG',name:'Constellation',stageIds:['energy']},
 {id:'stage:memory',kind:'STAGE',order:3,label:'Memory & storage',labels:{en:'Memory & storage','zh-CN':'内存与存储'}},
 {id:'US:MU',kind:'COMPANY',order:4,symbol:'MU',name:'Micron',names:{'zh-CN':'美光科技'},stageIds:['memory'],market:'US'},
 {id:'US:SKHY',kind:'COMPANY',order:5,symbol:'SKHY',name:'SK hynix',stageIds:['memory'],market:'US'},
 {id:'US:SNDK',kind:'COMPANY',order:6,symbol:'SNDK',name:'Sandisk',stageIds:['memory'],market:'US'},
]};
test.beforeAll(async()=>{
 html=await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {CompanyTimeline} from './src/components/company-timeline';const graph=${JSON.stringify(graph)};if(new URLSearchParams(location.search).has('crowded'))graph.nodes.push(...Array.from({length:30},(_,index)=>({id:'US:PEER'+index,kind:'COMPANY',order:index+7,symbol:'PEER'+index,name:'Market peer '+index,stageIds:['energy'],market:'US'})));createRoot(document.getElementById('root')).render(<CompanyTimeline companyId={new URLSearchParams(location.search).get('company')||'US:AMD'} graph={graph} events={[]}/>);`,{jsx:'automatic',plugins:[{name:'chart-review-services',setup(build){
  build.onResolve({filter:/auth-provider$|locale-provider$/},args=>({path:args.path,namespace:'review-mock'}));
  build.onLoad({filter:/.*/,namespace:'review-mock'},args=>({loader:'tsx',contents:args.path.endsWith('auth-provider')?`const user={uid:'viewer'};const token=async()=>'fixture-token';export function useAuth(){return {user:new URLSearchParams(location.search).has('guest')?null:user,loading:false,getIdToken:token}}`:`export function useLocale(){const chinese=new URLSearchParams(location.search).get('lang')==='zh-CN';return {locale:chinese?'zh-CN':'en',chinese,text:(en,zh)=>chinese?zh:en}}`}));
 }}]},'body{margin:0;font-family:Arial}*{box-sizing:border-box}');
});
async function open(page:Page,query='',fail=false,showReview=true){
 let ids:string[]=[];const writes:unknown[]=[];
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/map-follows'){
   if(route.request().method()==='PATCH'){
    const body=route.request().postDataJSON();writes.push(body);
    if(fail)return route.fulfill({status:503,json:{error:'unavailable'}});
    ids=body.follow?[...new Set([...ids,body.companyId])]:ids.filter(id=>id!==body.companyId);
   }
   return route.fulfill({json:{companyIds:ids}});
  }
  if(url.pathname==='/api/company-timeline')return route.fulfill({json:{companyId:url.searchParams.get('company'),start:'2026-01-01',end:'2026-10-14',currency:'USD',available:true,prices:[{date:'2026-10-13',open:100,high:108,low:98,close:105,volume:1000},{date:'2026-10-14',open:105,high:115,low:100,close:110,volume:2000}]}});
  return route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.fulfill({status:404,body:''});
 });
 await page.goto('http://review.test/en?chartMA=none'+query);
 await expect(page.locator('[data-price-candle]')).toHaveCount(2);
 if(showReview){
  await page.getByRole('button',{name:query.includes('zh-CN')?'股票工具':'Stock tools',exact:true}).click();
  await page.getByRole('checkbox',{name:query.includes('zh-CN')?'自选股':'Watchlist',exact:true}).check();
  await page.getByRole('button',{name:query.includes('zh-CN')?'关闭股票工具':'Close stock tools',exact:true}).click();
 }
 return writes;
}

test('quote table preserves price color preferences in dark and light themes',async({page})=>{
 await open(page,'&lang=zh-CN',false,false);
 await page.addStyleTag({content:readFileSync('src/app/globals.css','utf8').replace('@import "tailwindcss";','')});
 const sector=page.locator('[data-chart-sectors]');
 const row=sector.getByRole('row').filter({has:page.getByRole('button',{name:'英伟达',exact:true})});
 await expect(row).toBeVisible();
 await expect(row).toContainText('200 USD');
 for(const theme of ['dark','light']){
  await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
  for(const preference of ['green-up','red-up']){
   await page.evaluate(preference=>{document.documentElement.dataset.priceColors=preference;},preference);
   const actual=await row.locator('td').nth(3).evaluate(el=>getComputedStyle(el).color);
   const expected=await page.evaluate(preference=>{
    const sample=document.createElement('span');sample.style.color=preference==='red-up'?'var(--price-green)':'var(--price-red)';document.body.append(sample);
    const color=getComputedStyle(sample).color;sample.remove();return color;
   },preference);
   expect(actual).toBe(expected);
  }
  await sector.screenshot({path:test.info().outputPath(`sector-palette-${theme}.png`)});
 }
});

for(const chinese of [false,true])test(`grouped stock sectors show sourced Micron concepts and precise peers in ${chinese?'Chinese':'English'}`,async({page})=>{
 await open(page,'&company=US%3AMU'+(chinese?'&lang=zh-CN':''),false,false);
 await page.getByRole('button',{name:chinese?'股票工具':'Stock tools',exact:true}).click();
 const tools=page.getByRole('dialog',{name:(chinese?'股票工具':'Stock tools')+' · MU',exact:true});
 await tools.locator('summary').click();
 await expect(tools.getByRole('group',{name:chinese?'行业':'Industry',exact:true})).toBeVisible();
 const business=tools.getByRole('group',{name:chinese?'业务概念':'Business concepts',exact:true});
 await expect(business.getByRole('button')).toHaveCount(9);
 await expect(tools.getByRole('group',{name:chinese?'上市市场':'Listing market',exact:true})).toBeAttached();
 await tools.screenshot({path:test.info().outputPath('grouped-stock-sectors.png')});
 await business.getByRole('button',{name:(chinese?'高带宽内存（HBM）':'High-bandwidth memory (HBM)')+' →',exact:true}).click();
 await expect(tools.getByRole('button',{name:'SK hynix',exact:true})).toBeVisible();
 await expect(tools.getByRole('button',{name:'Sandisk',exact:true})).toHaveCount(0);
 await tools.getByText(chinese?'分类依据':'Classification sources',{exact:true}).click();
 await expect(tools.getByRole('link',{name:'Micron products ↗',exact:true})).toHaveAttribute('href','https://www.micron.com/products/');
 await tools.getByRole('button',{name:'← '+(chinese?'股票工具':'Stock tools'),exact:true}).click();
 await tools.getByRole('group',{name:chinese?'业务概念':'Business concepts',exact:true}).getByRole('button',{name:(chinese?'NAND 闪存':'NAND flash')+' →',exact:true}).click();
 await expect(tools.getByRole('button',{name:'Sandisk',exact:true})).toBeVisible();
 await tools.getByRole('button',{name:'Sandisk',exact:true}).click();
 await expect(page.locator('[data-company-timeline="US:SNDK"]')).toBeVisible();
});

for(const chinese of [false,true])test(`stock tools can be dragged by mouse or touch and stay within the fullscreen viewport (${chinese?'Chinese':'English'})`,async({page,isMobile})=>{
 await open(page,chinese?'&lang=zh-CN':'',false,false);
 await page.getByRole('button',{name:chinese?'全屏':'Full screen',exact:true}).click();
 await page.locator('[data-company-timeline] svg[role=img]').click({button:'right'});
 const tools=page.getByRole('dialog',{name:(chinese?'股票工具':'Stock tools')+' · AMD',exact:true});
 const handle=tools.getByRole('group',{name:chinese?'移动窗口':'Move window',exact:true});
 const before=(await tools.boundingBox())!,header=(await handle.boundingBox())!;
 const start={x:header.x+45,y:header.y+header.height/2};
 if(isMobile){
  const session=await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x,y:start.y+80}]});
  await expect.poll(async()=>(await tools.boundingBox())!.y).toBeGreaterThan(before.y+30);
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:0,y:0}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await session.detach();
 }else{
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(0,0,{steps:8});await page.mouse.up();
 }
 const moved=(await tools.boundingBox())!;
 expect(moved.x).toBeCloseTo(12,0);expect(moved.y).toBeCloseTo(12,0);
 if(!isMobile)expect(Math.abs(moved.x-before.x)+Math.abs(moved.y-before.y)).toBeGreaterThan(10);
 await handle.focus();await handle.press('ArrowDown');await handle.press('Shift+ArrowDown');
 await expect.poll(async()=>(await tools.boundingBox())!.y).toBeCloseTo(52,0);
 await tools.getByRole('button',{name:'MACD',exact:true}).click();
 await expect(tools.getByRole('button',{name:'MACD',exact:true})).toHaveAttribute('aria-pressed','true');
 expect((await tools.boundingBox())!.y).toBeCloseTo(52,0);
 expect(await tools.evaluate(el=>!!el.closest('[data-chart-size="full"]'))).toBe(true);
 await page.setViewportSize({width:320,height:600});
 await expect.poll(async()=>{
  const box=(await tools.boundingBox())!;return box.x>=11&&box.y>=11&&box.x+box.width<=309&&box.y+box.height<=589;
 }).toBe(true);
 await tools.getByRole('button',{name:chinese?'关闭股票工具':'Close stock tools',exact:true}).click();
 await expect(tools).toHaveCount(0);
});

test('watchlist panel is hidden by default and only the chart-menu checkbox enables it',async({page})=>{
 const writes=await open(page,'',false,false);
 const review=page.getByRole('region',{name:'Watchlist review',exact:true});
 await expect(review).toHaveCount(0);
 await page.locator('[data-company-timeline] svg[role=img]').click({button:'right'});
 const tools=page.getByRole('dialog',{name:'Stock tools · AMD',exact:true});
 const toggle=tools.getByRole('checkbox',{name:'Watchlist',exact:true});
 await expect(toggle).not.toBeChecked();
 await tools.getByRole('button',{name:'Add to watchlist',exact:true}).click();
 await expect(tools.getByRole('button',{name:'Remove from watchlist',exact:true})).toBeVisible();
 await expect(review).toHaveCount(0);
 await toggle.check();
 await expect(review.getByRole('button',{name:'AMD',exact:true})).toBeVisible();
 await toggle.uncheck();await expect(review).toHaveCount(0);
 expect(writes).toEqual([{companyId:'US:AMD',follow:true}]);
 await toggle.check();await page.reload();
 await expect(review.getByRole('button',{name:'AMD',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Stock tools',exact:true}).click();
 await expect(page.getByRole('checkbox',{name:'Watchlist',exact:true})).toBeChecked();
});
test('right click opens indicators and all covered peers; selected peer switches the fullscreen chart',async({page})=>{
 await open(page);
 await page.getByRole('button',{name:'Full screen',exact:true}).click();
 await page.locator('[data-company-timeline] svg[role=img]').click({button:'right'});
 const tools=page.getByRole('dialog',{name:'Stock tools · AMD',exact:true});
 await expect(tools).toBeVisible();
 await tools.screenshot({path:test.info().outputPath('stock-tools.png')});
 await tools.getByRole('button',{name:'MACD',exact:true}).click();
 await expect(tools.getByRole('button',{name:'MACD',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('[data-macd-panel]')).not.toHaveCount(0);
 await tools.locator('summary').click();
 await tools.getByRole('button',{name:'Semiconductors →',exact:true}).click();
 await expect(tools.getByRole('button',{name:'NVIDIA',exact:true})).toBeVisible();
 await expect(tools.getByRole('button',{name:'Constellation',exact:true})).toHaveCount(0);
 await expect(tools.locator('tbody tr')).toHaveCount(1);
 await tools.screenshot({path:test.info().outputPath('sector-peers.png')});
 await tools.getByRole('button',{name:'NVIDIA',exact:true}).click();
 await expect(page.locator('[data-company-timeline="US:NVDA"]')).toHaveAttribute('data-chart-size','full');
 await expect(page.getByRole('button',{name:'MACD (12,26,9)',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(tools).toHaveCount(0);
});
test('watchlist saves below all chart indicators, switches charts and persists on reload',async({page})=>{
 const writes=await open(page);
 const review=page.getByRole('region',{name:'Watchlist review',exact:true});
 await review.getByRole('button',{name:'Add current stock',exact:true}).click();
 await expect(review.getByRole('button',{name:'AMD',exact:true})).toBeVisible();
 expect(writes).toEqual([{companyId:'US:AMD',follow:true}]);
 await page.getByRole('button',{name:'MACD (12,26,9)',exact:true}).click();
 const chart=page.locator('[data-company-timeline] svg[role=img]');
 expect((await review.boundingBox())!.y).toBeGreaterThanOrEqual((await chart.boundingBox())!.y+(await chart.boundingBox())!.height);
 await page.reload();
 await expect(review.getByRole('button',{name:'AMD',exact:true})).toBeVisible();
 await review.getByRole('button',{name:'Remove current stock',exact:true}).click();
 await expect(review.locator('tbody tr')).toHaveCount(0);
});
test('failed watchlist save does not add a stock; keyboard tools dismiss with Escape',async({page})=>{
 await open(page,'',true);
 const review=page.getByRole('region',{name:'Watchlist review',exact:true});
 await review.getByRole('button',{name:'Add current stock',exact:true}).click();
 await expect(review.getByRole('alert')).toBeVisible();
 await expect(review.locator('tbody tr')).toHaveCount(0);
 const trigger=page.getByRole('button',{name:'Stock tools',exact:true});await trigger.press('Enter');
 await expect(page.getByRole('dialog',{name:'Stock tools · AMD',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog',{name:'Stock tools · AMD',exact:true})).toHaveCount(0);
 await expect(trigger).toBeFocused();
});
test('Chinese touch toolbar offers sectors and a session watchlist without account writes',async({page})=>{
 const writes=await open(page,'&lang=zh-CN&guest=1');
 await page.getByRole('button',{name:'股票工具',exact:true}).click();
 const tools=page.getByRole('dialog',{name:'股票工具 · AMD',exact:true});
 await tools.getByRole('button',{name:'加入自选股',exact:true}).click();
 const review=page.getByRole('region',{name:'自选股复盘',exact:true});
 await expect(review.getByRole('button',{name:'超威半导体',exact:true})).toBeAttached();
 expect(writes).toHaveLength(0);
 await tools.locator('summary').click();
 await tools.getByRole('button',{name:'半导体制造 →',exact:true}).click();
 await expect(tools.getByRole('button',{name:'英伟达',exact:true})).toBeVisible();
 const box=(await tools.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('guest watchlist survives chart close, reopen and navigation in the same tab',async({page})=>{
 const writes=await open(page,'&guest=1');
 const review=page.getByRole('region',{name:'Watchlist review',exact:true});
 await review.getByRole('button',{name:'Add current stock',exact:true}).click();
 await expect(review.getByRole('button',{name:'AMD',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close timeline',exact:true}).click();
 await expect(review).toHaveCount(0);
 await page.getByRole('button',{name:'Show timeline',exact:true}).click();
 await expect(review.getByRole('button',{name:'AMD',exact:true})).toBeVisible();
 await page.goto('http://review.test/en?chartMA=none&guest=1&view=tree');
 await expect(review).toHaveCount(0);
 await page.getByRole('button',{name:'Stock tools',exact:true}).click();
 await page.getByRole('checkbox',{name:'Watchlist',exact:true}).check();
 await page.getByRole('button',{name:'Close stock tools',exact:true}).click();
 await expect(review.getByRole('button',{name:'AMD',exact:true})).toBeVisible();
 expect(writes).toHaveLength(0);
});

test('refresh failure keeps previously loaded watchlist rows visible and retry recovers',async({page})=>{
 await open(page);
 const review=page.getByRole('region',{name:'Watchlist review',exact:true});
 await review.getByRole('button',{name:'Add current stock',exact:true}).click();
 await expect(review.getByRole('button',{name:'AMD',exact:true})).toBeVisible();
 await page.route('**/api/map-follows',route=>route.fulfill({status:503,json:{error:'offline'}}));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(review.getByRole('button',{name:'Could not refresh watchlist. Retry',exact:true})).toBeVisible();
 await expect(review.getByRole('button',{name:'AMD',exact:true})).toBeVisible();
 await page.route('**/api/map-follows',route=>route.fulfill({json:{companyIds:['US:AMD']}}));
 await review.getByRole('button',{name:'Could not refresh watchlist. Retry',exact:true}).click();
 await expect(review.getByRole('button',{name:'Could not refresh watchlist. Retry',exact:true})).toHaveCount(0);
 await expect(review.getByRole('button',{name:'AMD',exact:true})).toBeVisible();
});


for(const chinese of [false,true])test(`sector companies stay below the chart and switch peers (${chinese?'Chinese':'English'})`,async({page})=>{
 const writes=await open(page,'&company=US%3AMU'+(chinese?'&lang=zh-CN':''),false,false);
 const sector=page.locator('[data-chart-sectors]');
 await expect(sector).toBeVisible();
 await sector.getByRole('button',{name:chinese?'高带宽内存（HBM）':'High-bandwidth memory (HBM)',exact:true}).click();
 await expect(sector.getByRole('button',{name:'SK hynix',exact:true})).toBeVisible();
 await expect(sector.getByRole('button',{name:'Sandisk',exact:true})).toHaveCount(0);
 await sector.getByRole('button',{name:'SK hynix',exact:true}).click();
 await expect(page.locator('[data-company-timeline]')).toHaveAttribute('data-company-timeline','US:SKHY');
 await expect(sector.getByRole('button',{name:chinese?'美光科技':'Micron',exact:true})).toBeVisible();
 expect(writes).toEqual([]);
});

test('Chinese sector heading and filters stay visible when fullscreen peer rows scroll',async({page})=>{
 await open(page,'&company=US%3AMU&lang=zh-CN&crowded=1',false,false);
 const timeline=page.locator('[data-company-timeline]');
 const sector=timeline.locator('[data-chart-sectors]');
 await page.getByRole('button',{name:'半屏',exact:true}).click();
 const market=sector.getByRole('button',{name:'美股',exact:true});
 await market.click();
 await expect(market).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'全屏',exact:true}).click();
 await expect(timeline).toHaveAttribute('data-chart-size','full');
 const rows=sector.locator('[data-chart-review-rows]');
 await expect.poll(()=>rows.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await rows.evaluate(el=>{el.scrollTop=el.scrollHeight;});
 await sector.evaluate(el=>{el.scrollTop=el.scrollHeight;});
 await expect.poll(()=>sector.getByRole('heading',{name:'所属板块',exact:true}).evaluate(el=>{
  const panel=el.closest('[data-chart-sectors]')!.getBoundingClientRect(),heading=el.getBoundingClientRect();
  return heading.top>=panel.top&&heading.bottom<=panel.bottom;
 })).toBe(true);
 await expect(market).toBeInViewport();
 await expect(market).toHaveAttribute('aria-pressed','true');
 const headingBox=(await sector.getByRole('heading',{name:'所属板块',exact:true}).boundingBox())!;
 const marketBox=(await market.boundingBox())!;
 expect(headingBox.y+headingBox.height/2).toBeCloseTo(marketBox.y+marketBox.height/2,0);
 await sector.screenshot({path:test.info().outputPath('fullscreen-sector-filters.png')});
 await page.getByRole('button',{name:'半屏',exact:true}).click();
 await expect(market).toHaveAttribute('aria-pressed','true');
});

for(const chinese of [false,true])test(`indicators expand inline and restore on double click while candles stay fixed (${chinese?'Chinese':'English'})`,async({page})=>{
 await open(page,chinese?'&lang=zh-CN':'',false,false);
 const rows=Array.from({length:60},(_,index)=>({date:new Date(Date.UTC(2026,7,16+index)).toISOString().slice(0,10),open:100+index,high:105+index,low:98+index,close:102+index+Math.sin(index),volume:index===52?null:1000+index*100}));
 await page.route('**/api/company-timeline?*',route=>route.fulfill({json:{companyId:'US:AMD',start:'2026-09-14',end:'2026-10-14',currency:'USD',available:true,warmupPrices:rows.slice(0,40),prices:rows.slice(40)}}));
 await page.reload();
 const timeline=page.locator('[data-company-timeline]');
 await expect(timeline.locator('[data-price-candle]')).toHaveCount(31);
 await expect(timeline.locator('[data-volume-ma="5"]')).toHaveCount(1);
 await expect(timeline.locator('[data-volume-ma="10"]')).toHaveCount(1);
 await expect(timeline.getByRole('checkbox',{name:/Volume MA5|量能 MA5/})).toHaveCount(0);
 await expect(timeline.getByRole('button',{name:/Expand volume|放大成交量/})).toHaveCount(0);
 const volumeLabel=timeline.locator('[data-volume-panel]').getByRole('button',{name:chinese?'成交量副图':'Volume panel',exact:true});
 await expect(volumeLabel.locator('title')).toContainText(chinese?'双击放大':'Double-click to enlarge');
 await volumeLabel.focus();await volumeLabel.press('Enter');
 await expect(timeline.locator('[data-volume-panel]')).toHaveAttribute('data-expanded','true');
 await volumeLabel.press('Space');
 await expect(timeline.locator('[data-volume-panel]')).toHaveAttribute('data-expanded','false');
 const candleGeometry=()=>timeline.locator('[data-price-candle]').evaluateAll(nodes=>nodes.map(node=>node.innerHTML));
 async function doubleClickPanel(kind:string){
  const hit=timeline.locator(`[data-indicator-hit="${kind}"]`),box=(await hit.boundingBox())!;
  // Use the unchanged top edge so enlargement does not scroll the price plot into view.
  await page.mouse.dblclick(box.x+box.width-8,box.y+6);
 }
 for(const size of ['compact','half','full']){
  if(size!=='compact')await page.getByRole('button',{name:size==='full'?(chinese?'全屏':'Full screen'):(chinese?'半屏':'Half screen'),exact:true}).click();
  for(const kind of ['volume','macd','kdj','boll']){
   if(kind!=='volume'){
    const label=kind==='macd'?'MACD (12,26,9)':kind==='kdj'?'KDJ (9,3,3)':'BOLL (20,2)';
    await timeline.getByRole('button',{name:label,exact:true}).click();
   }
   const panel=timeline.locator(`[data-${kind}-panel]`),hit=timeline.locator(`[data-indicator-hit="${kind}"]`);
   await expect(timeline.locator('[data-indicator-study-controls]')).toHaveCount(0);
   await expect(timeline.getByRole('button',{name:/^(Expand|放大) (MACD|KDJ|BOLL)/})).toHaveCount(0);
   await expect(panel).toHaveAttribute('data-expanded','false');
   const originalHeight=Number(await hit.getAttribute('height'));
   const geometry=await candleGeometry();
   const priceBottom=await timeline.locator('svg[role="img"]').getAttribute('data-price-bottom');
   const firstCandle=(await timeline.locator('[data-price-candle]').first().boundingBox())!;
   await doubleClickPanel(kind);
   await expect(panel).toHaveAttribute('data-expanded','true');
   await expect(timeline.locator('[data-volume-ma]')).toHaveCount(2);
   expect(Number(await hit.getAttribute('height'))).toBe(originalHeight+160);
   expect(await candleGeometry()).toEqual(geometry);
   expect(await timeline.locator('svg[role="img"]').getAttribute('data-price-bottom')).toBe(priceBottom);
   const enlargedCandle=(await timeline.locator('[data-price-candle]').first().boundingBox())!;
   expect(enlargedCandle.y).toBeCloseTo(firstCandle.y,0);
   expect(enlargedCandle.height).toBeCloseTo(firstCandle.height,0);
   await expect(page.getByRole('dialog',{name:/study|研究/})).toHaveCount(0);
   if(size==='full'&&kind==='volume')await timeline.screenshot({path:test.info().outputPath('inline-volume-expanded.png')});
   await doubleClickPanel(kind);
   await expect(panel).toHaveAttribute('data-expanded','false');
   expect(Number(await hit.getAttribute('height'))).toBe(originalHeight);
   expect(await candleGeometry()).toEqual(geometry);
   if(kind!=='volume'){
    const label=panel.getByRole('button',{name:chinese?`${kind.toUpperCase()} 副图`:`${kind.toUpperCase()} panel`,exact:true});
    await label.press('Enter');await expect(panel).toHaveAttribute('data-expanded','true');
    await label.press('Space');await expect(panel).toHaveAttribute('data-expanded','false');
   }
  }
 }
 await expect(timeline).toHaveAttribute('data-chart-size','full');
 await expect(page.locator('[data-chart-sectors]')).toBeVisible();
});
