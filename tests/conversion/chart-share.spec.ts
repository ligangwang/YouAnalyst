import {expect,test} from '@playwright/test';
import {componentFixtureHtml} from './fixtures/component-html';
import path from 'node:path';

let html:string;
test.beforeAll(async()=>{
  html=await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {CompanyTimeline} from './src/components/company-timeline';createRoot(document.getElementById('root')).render(<CompanyTimeline companyId="US:AMD" graph={{nodes:[],relationships:[],sources:[]}} initialPrices={{companyId:'US:AMD',start:'2026-01-01',end:'2026-10-04',currency:'USD',available:true,prices:[{date:'2026-10-01',open:100,high:110,low:95,close:105,volume:1000},{date:'2026-10-02',open:105,high:115,low:100,close:110,volume:2000}]}} events={[{id:'event_1',date:'2026-10-01',title:'AMD business update',description:'Published details',sourceUrl:'https://example.com/news',sourceTitle:'Original announcement',lane:'business',eventType:'business'}]}/>);`,{alias:{'next/link':path.resolve('tests/conversion/fixtures/mocks.tsx')},plugins:[{name:'share-fixture',setup(build){build.onResolve({filter:/(locale-provider|company-follow-button)$/},args=>({path:args.path,namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},args=>({loader:'tsx',contents:args.path.endsWith('locale-provider')?`export function useLocale(){const chinese=location.pathname.startsWith('/zh-cn');return {locale:chinese?'zh-CN':'en',chinese,text:(en,zh)=>chinese?zh:en}}`:`export function CompanyFollowButton(){return null}`}));}}]});
});
test('copy chart link restores settings and selected event; close clears the event',async({page})=>{
  await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.fulfill({json:{companyId:'US:AMD',start:'2026-01-01',end:'2026-10-04',prices:[],available:true}}));
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{(window as unknown as {copiedLink:string}).copiedLink=value;}}}));
  await page.goto('http://chart.test/en/ticker/AMD?chartRange=ytd&chartStyle=line&chartMA=5,20&chartMacd=1&chartEvent=event_1&watchlist=private');
  await expect(page.getByLabel('Price history range')).toHaveValue('ytd');
  await expect(page.getByRole('button',{name:'Line',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'MACD (12,26,9)',exact:true})).toHaveAttribute('aria-pressed','true');
  const details=page.getByRole('dialog',{name:'Event details'});
  await expect(details).toContainText('AMD business update');
  const copy=page.getByRole('button',{name:'Copy chart link',exact:true});
  await copy.focus();await copy.press('Enter');
  const eventLink=new URL(await page.evaluate(()=>(window as unknown as {copiedLink:string}).copiedLink));
  expect(eventLink.searchParams.get('chartEvent')).toBe('event_1');
  // The event window can cover controls on a narrow screen; dismiss before copying.
  await page.keyboard.press('Escape');
  await expect(details).not.toBeVisible();
  await expect(page).not.toHaveURL(/chartEvent=/);
  await page.getByRole('button',{name:'Copy chart link',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Chart link copied');
  const url=new URL(await page.evaluate(()=>(window as unknown as {copiedLink:string}).copiedLink));
  expect(url.origin).toBe('https://youanalyst.com');
  expect(url.searchParams.has('watchlist')).toBe(false);
  expect(url.searchParams.get('chartRange')).toBe('ytd');
  expect(url.searchParams.get('chartMA')).toBe('5,20');
  await page.goto(`http://chart.test${url.pathname}${url.search}`);
  await expect(page.getByLabel('Price history range')).toHaveValue('ytd');
  await expect(page.getByRole('button',{name:'Line',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'MA settings',exact:true}).click();
  for(const period of [5,20])await page.getByRole('button',{name:`MA${period}`,exact:true}).click();
  await page.getByRole('button',{name:'Close MA settings'}).click();
  await copy.click();
  const disabled=new URL(await page.evaluate(()=>(window as unknown as {copiedLink:string}).copiedLink));
  expect(disabled.searchParams.get('chartMA')).toBe('none');
  await page.goto(`http://chart.test${disabled.pathname}${disabled.search}`);
  await page.getByRole('button',{name:'MA settings',exact:true}).click();
  for(const period of [5,10,20,60])await expect(page.getByRole('button',{name:`MA${period}`,exact:true})).toHaveAttribute('aria-pressed','false');
});
test('Chinese share offers a selectable link when clipboard is blocked',async({page})=>{
  await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.fulfill({status:404}));
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('Blocked');}}}));
  await page.goto('http://chart.test/zh-cn/ticker/AMD');
  await page.getByRole('button',{name:'复制图表链接',exact:true}).click();
  await expect(page.getByLabel('图表链接',{exact:true})).toHaveValue(/https:\/\/youanalyst.com\/zh-cn\/company\/amd/);
  await page.getByRole('button',{name:'关闭分享提示'}).click();
  await expect(page.getByLabel('图表链接',{exact:true})).not.toBeVisible();
});

test('icon toolbar fits wide screens, wraps on phones and exposes help and MA controls',async({page},info)=>{
  await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.fulfill({status:404}));
  await page.goto('http://chart.test/en/ticker/AMD');
  const toolbar=page.locator('[data-chart-toolbar]');
  const original=page.viewportSize()!;
  for(const width of [1600,390]){
    await page.setViewportSize({width,height:900});
    const bounds=await toolbar.evaluate(element=>({rows:new Set(Array.from(element.querySelectorAll(':scope > *, :scope > div > button')).map(child=>Math.round(child.getBoundingClientRect().top))).size,overflow:document.documentElement.scrollWidth>innerWidth}));
    expect(bounds.overflow).toBe(false);
    if(width===1600)expect(bounds.rows).toBe(1);
    await page.screenshot({path:`output/chart-toolbar-${width}-${info.project.name}.png`});
  }
  await page.setViewportSize(original);
  for(const name of ['Fundamentals (F10)','Copy chart link','Candles','Line','Events','Volume','Turnover','MACD (12,26,9)','KDJ (9,3,3)','BOLL (20,2)']){
    const control=toolbar.getByRole(name.startsWith('Fundamentals')?'link':'button',{name,exact:true});
    await expect(control).toHaveAttribute('title',/.+/);
    expect((await control.textContent())?.trim()).toBe('');
  }
  await toolbar.getByRole('button',{name:'Chart help',exact:true}).click();
  const help=page.getByRole('dialog',{name:'Chart help',exact:true});
  await expect(help).toContainText('↑↓ zoom');
  await expect(help).toContainText('F10');
  await help.getByRole('button',{name:'Close chart help'}).click();
  await toolbar.getByRole('button',{name:'MA settings',exact:true}).click();
  const ma=page.getByRole('dialog',{name:'Moving average settings',exact:true});
  for(const period of [5,10,20,60])await expect(ma.getByRole('button',{name:`MA${period}`,exact:true})).toHaveAttribute('aria-pressed','true');
  await ma.getByRole('button',{name:'MA20',exact:true}).click();
  await expect(ma.getByRole('button',{name:'MA20',exact:true})).toHaveAttribute('aria-pressed','false');
  await page.keyboard.press('Escape');
  await expect(ma).toHaveCount(0);
  await expect(toolbar.getByRole('button',{name:'MA settings',exact:true})).toBeFocused();
});
