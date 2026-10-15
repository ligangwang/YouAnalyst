import {test,expect,type Page} from '@playwright/test';
import {componentFixtureHtml} from './fixtures/component-html';

let html:string;
const graph={asOf:'2026-10-14',relationships:[],sources:[],nodes:[
 {id:'US:AMD',kind:'COMPANY',order:0,symbol:'AMD',name:'AMD',names:{'zh-CN':'超威半导体'},stageIds:['design'],dailyPrice:{close:110,currency:'USD',tradingDate:'2026-10-14',previousTradingDate:'2026-10-13',change:.1}},
 {id:'US:NVDA',kind:'COMPANY',order:1,symbol:'NVDA',name:'NVIDIA',names:{'zh-CN':'英伟达'},stageIds:['design'],dailyPrice:{close:200,currency:'USD',tradingDate:'2026-10-13',previousTradingDate:'2026-10-12',change:-.02}},
 {id:'US:CEG',kind:'COMPANY',order:2,symbol:'CEG',name:'Constellation',stageIds:['energy']},
]};
test.beforeAll(async()=>{
 html=await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {CompanyTimeline} from './src/components/company-timeline';createRoot(document.getElementById('root')).render(<CompanyTimeline companyId="US:AMD" graph={${JSON.stringify(graph)}} events={[]}/>);`,{jsx:'automatic',plugins:[{name:'chart-review-services',setup(build){
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
