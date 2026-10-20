import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { componentFixtureHtml } from './fixtures/component-html';

let html: string;
test.beforeAll(async () => {
  const css = readFileSync('src/app/globals.css', 'utf8').replace('@import "tailwindcss";', '').replace(/@theme inline\s*\{[^}]+\}/, '');
  html = await componentFixtureHtml(`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {LocaleProvider,LanguageSwitch} from './src/components/providers/locale-provider';
    import {MarketProvider} from './src/components/providers/market-provider';
    import {DisplayPreferencesPanel} from './src/components/display-preferences';
    import {CompanyTimeline} from './src/components/company-timeline';
    import {CompanyPriceChange} from './src/components/company-price-change';
    import {DirectionBadge} from './src/components/prediction-ui';
    const prices={companyId:'US:AMD',start:'2026-09-11',end:'2026-10-11',currency:'USD',available:true,prices:[{date:'2026-10-08',open:100,high:110,low:98,close:108,volume:1000},{date:'2026-10-09',open:108,high:109,low:101,close:104,volume:1100}]};
    createRoot(document.getElementById('root')).render(<LocaleProvider locale="en"><MarketProvider><DisplayPreferencesPanel/><LanguageSwitch/><p><CompanyPriceChange price={{change:.04,close:104,currency:'USD',tradingDate:'2026-10-09',previousTradingDate:'2026-10-08'}} locale="en"/><DirectionBadge direction="UP"/></p><p className="text-rose-300" role="note">Error colors stay red</p><p className="text-amber-200" role="status">Stale data warning</p><CompanyTimeline companyId="US:AMD" initialPrices={prices} events={[]} graph={{nodes:[],relationships:[],sources:[]}}/></MarketProvider></LocaleProvider>);
  `, {jsx:'automatic', plugins:[{name:'preference-services',setup(build){
    build.onResolve({filter:/auth-provider$|next\/navigation$/},args=>({path:args.path,namespace:'preference-mock'}));
    build.onLoad({filter:/.*/,namespace:'preference-mock'},args=>({loader:'tsx',contents:args.path==='next/navigation'?`const router={replace:url=>history.replaceState(null,'',url)};export function useRouter(){return router}`:`const user={uid:'viewer'};const token=async()=>'fixture-token';export function useAuth(){return {user:window.visitor?null:user,loading:false,getIdToken:token}}`}));
  }}]}, css+'body{margin:0;padding:16px;font-family:Arial}section{margin:0 0 16px}select{max-width:100%;padding:10px}label{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}h2{font-size:18px}');
});

async function open(page: import('@playwright/test').Page, preferences: object | null = null, fail = false) {
  const writes: Record<string,unknown>[] = [];
  await page.route('**/*', async route => {
    if (route.request().url().includes('/api/preferences')) {
      if (route.request().method()==='PATCH') { writes.push(route.request().postDataJSON()); return route.fulfill({status:fail?503:200,json:{preferences:writes.at(-1)}}); }
      return route.fulfill({json:{preferences}});
    }
    return route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.fulfill({status:404});
  });
  await page.goto('http://preferences.test/en');
  await expect(page.getByLabel('UI theme')).toBeVisible();
  return writes;
}

test('localized profile restores account appearance and swaps only price direction colors', async ({page}) => {
  const writes=await open(page,{language:'en',market:'ALL',theme:'light',priceColors:'red-up'});
  await expect(page.getByLabel('UI theme')).toHaveValue('light');
  await expect(page.getByLabel('Price color convention')).toHaveValue('red-up');
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(245, 248, 252)');
  await expect(page.locator('[data-candle-direction="up"] rect')).toHaveCSS('fill','rgb(200, 49, 72)');
  await expect(page.locator('[data-candle-direction="down"] rect')).toHaveCSS('fill','rgb(8, 123, 86)');
  await expect(page.locator('.price-up')).toHaveCSS('color','rgb(200, 49, 72)');
  await expect(page.getByRole('note')).toHaveCSS('color','rgb(186, 48, 71)');
  await expect(page.getByRole('status').filter({hasText:'Stale data warning'})).toHaveCSS('color','rgb(140, 97, 0)');
  await expect(page.getByRole('status').filter({hasText:'Indicator history unavailable'})).toBeVisible();
  await expect(page.locator('[data-price-candle]')).toHaveCount(2);
  const themeSelect=page.getByLabel('UI theme');await themeSelect.focus();await expect(themeSelect).toHaveCSS('outline-color','rgb(8, 124, 156)');
  await page.getByLabel('Price color convention').selectOption('green-up');
  await expect(page.locator('[data-candle-direction="up"] rect')).toHaveCSS('fill','rgb(8, 123, 86)');
  expect(writes.at(-1)).toEqual({language:'en',market:'ALL',theme:'light',priceColors:'green-up'});
  await page.getByLabel('UI theme').selectOption('dark');
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(7, 13, 25)');
  await page.getByLabel('Price color convention').selectOption('red-up');
  await expect(page.locator('[data-candle-direction="up"] rect')).toHaveCSS('fill','rgb(255, 142, 161)');
  await page.getByRole('button',{name:'Change language',exact:true}).click();
  await page.getByRole('button',{name:'简体中文',exact:true}).click();
  await expect(page).toHaveURL(/\/zh-cn/);
  expect(writes.at(-1)).toEqual({language:'zh-CN',market:'ALL',theme:'dark',priceColors:'red-up'});
});

test('legacy account appearance and failed account saves preserve price convention', async ({page}) => {
  await open(page,{language:'zh-CN',market:'ALL'},true);
  await expect(page.getByLabel('UI theme')).toHaveValue('dark');
  await expect(page.getByLabel('Price color convention')).toHaveValue('green-up');
  await page.getByLabel('Price color convention').selectOption('red-up');
  await expect(page.getByRole('alert')).toContainText('Could not save');
  await expect(page.getByLabel('UI theme')).toHaveValue('dark');
  await expect(page.getByLabel('Price color convention')).toHaveValue('green-up');
  await expect(page.locator('body')).toHaveCSS('background-color','rgb(7, 13, 25)');
});

test('visitor appearance persists on reload without account writes and fits mobile', async ({page},testInfo) => {
  await page.addInitScript(()=>{(window as unknown as {visitor:boolean}).visitor=true;});
  const writes=await open(page);
  await page.getByLabel('UI theme').selectOption('light');
  await page.getByLabel('Price color convention').selectOption('red-up');
  await page.reload();
  await expect(page.getByLabel('UI theme')).toHaveValue('light');
  await expect(page.getByLabel('Price color convention')).toHaveValue('red-up');
  expect(writes).toHaveLength(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  mkdirSync('.cache/display-preferences',{recursive:true});
  await page.screenshot({path:`.cache/display-preferences/${testInfo.project.name}-light.png`,fullPage:true});
});

test('first-time system appearance follows OS changes, explicit choice persists and switching never navigates', async ({page}) => {
  await page.emulateMedia({colorScheme:'light'});
  await page.addInitScript(()=>{(window as unknown as {visitor:boolean}).visitor=true;});
  const writes=await open(page);
  const selector=page.getByLabel('UI theme');
  await expect(selector).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByLabel('Price color convention').selectOption('red-up');
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(selector).toHaveValue('system');
  await page.reload();
  await expect(selector).toHaveValue('system');
  const url=page.url();
  await selector.selectOption('light');
  await page.emulateMedia({colorScheme:'light'});
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.reload();
  await expect(selector).toHaveValue('light');
  await expect(page.getByLabel('Price color convention')).toHaveValue('red-up');
  expect(page.url()).toBe(url);expect(writes).toHaveLength(0);
});
