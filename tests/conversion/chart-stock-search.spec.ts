import { expect, test } from '@playwright/test';
import { companyResearchPath } from '../../src/lib/ui/chart-share';
import { componentFixtureHtml } from './fixtures/component-html';
const nvda = { id: 'US:NVDA', symbol: 'NVDA', name: 'NVIDIA', market: 'US', exchange: 'NASDAQ' };
const msft = { id: 'US:MSFT', symbol: 'MSFT', name: 'Microsoft', market: 'US', exchange: 'NASDAQ' };
const maotai = { id: 'XSHG:600519', symbol: '600519', name: '贵州茅台', market: 'CN_A', exchange: 'XSHG' };
let html: string;
test.beforeAll(async () => {
  html = await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {CompanyTimeline} from './src/components/company-timeline';createRoot(document.getElementById('root')).render(<CompanyTimeline companyId="US:AMD" graph={{nodes:[{id:'US:AMD',kind:'COMPANY',order:0,name:'AMD',symbol:'AMD',market:'US'}],relationships:[],sources:[],asOf:'2026-10-13'}}/>);`, { jsx: 'automatic', plugins: [{ name: 'stock-chart-providers', setup(build) {
    build.onResolve({ filter: /(?:auth-provider|locale-provider|company-follow-button)$/ }, args => ({ path: args.path.split('/').at(-1)!, namespace: 'stock-mock' }));
    build.onLoad({ filter: /.*/, namespace: 'stock-mock' }, args => ({ loader: 'tsx', contents: args.path === 'auth-provider' ? `export function useAuth(){return {user:null,getIdToken:async()=>null}}` : args.path === 'company-follow-button' ? `export function CompanyFollowButton(){return null}` : `export function useLocale(){const chinese=new URLSearchParams(location.search).get('lang')==='zh-CN';return {locale:chinese?'zh-CN':'en',chinese,text:(en,zh)=>chinese?zh:en}}` }));
  } }] }, 'body{margin:0;font-family:Arial}*{box-sizing:border-box}');
});
async function open(page: import('@playwright/test').Page, chinese = false) {
  const priceRequests: string[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/tickers/search') {
      const query = (url.searchParams.get('q') ?? '').toLowerCase();
      const items = /^(nv|英|yw)/.test(query) ? [nvda] : /^(ms|micro|微|wr)/.test(query) ? [msft] : /^(600|贵州|gz)/.test(query) ? [maotai] : [];
      return route.fulfill({ json: { items } });
    }
    if (url.pathname === '/api/company-timeline') {
      const companyId = url.searchParams.get('company')!; priceRequests.push(companyId);
      return route.fulfill({ json: { companyId, start: '2026-01-01', end: '2026-10-13', currency: companyId.startsWith('US:') ? 'USD' : 'CNY', interval: 'daily', prices: [{ date: '2026-10-09', open: 100, high: 110, low: 99, close: 105, volume: 1000 }, { date: '2026-10-12', open: 105, high: 115, low: 100, close: 110, volume: 2000 }], available: true } });
    }
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto('https://chart.test/?chartMA=none&lang=' + (chinese ? 'zh-CN' : 'en'));
  await page.getByRole('button', { name: chinese ? '全屏' : 'Full screen', exact: true }).click();
  return priceRequests;
}
for (const chinese of [false, true]) test(`fullscreen ${chinese ? 'Chinese' : 'English'} chart keeps first character, closes only lookup and switches stocks without losing indicators`, async ({ page }) => {
  const requests = await open(page, chinese);
  if (chinese) await page.addStyleTag({ content: ':root{--ui-surface:#fff;--ui-text:#142536;--ui-line:#ccd7e1;--ui-muted:#475f73;--ui-selected:#d8edf0}' });
  const chart = page.locator('[data-company-timeline]');
  await page.getByLabel(chinese ? '股价时间范围' : 'Price history range').selectOption('90');
  await page.getByRole('button', { name: 'MACD (12,26,9)', exact: true }).click();
  await chart.focus(); await page.keyboard.press('n');
  const search = page.getByRole('dialog', { name: chinese ? '搜索公司' : 'Search company', exact: true });
  const input = search.getByRole('combobox');
  await expect(input).toHaveValue('n'); await expect(input).toBeFocused();
  await page.keyboard.press('Escape'); await expect(search).toHaveCount(0); await expect(chart).toHaveAttribute('data-chart-size', 'full');
  await page.keyboard.press('n'); await page.keyboard.type('vda');
  await expect(search.getByRole('option', { name: /NVIDIA/ })).toBeVisible();
  await page.screenshot({ path: `output/stock-search-${chinese ? 'zh-light' : 'en-dark'}-${test.info().project.name}.png` });
  await page.keyboard.press('Enter');
  await expect(chart).toHaveAttribute('data-company-timeline', 'US:NVDA'); await expect(chart).toHaveAttribute('data-chart-size', 'full');
  await expect(chart.getByRole('heading')).toContainText('NVIDIA');
  await expect(page.getByLabel(chinese ? '股价时间范围' : 'Price history range')).toHaveValue('90');
  await expect(page.getByRole('button', { name: 'MACD (12,26,9)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => requests.includes('US:NVDA')).toBe(true);
  await chart.focus(); await page.keyboard.type('600519');
  await expect(search.getByRole('option', { name: /贵州茅台/ })).toBeVisible(); await page.keyboard.press('Enter');
  await expect(chart).toHaveAttribute('data-company-timeline', 'XSHG:600519'); await expect(chart).toHaveAttribute('data-chart-size', 'full');
  await expect.poll(() => requests.includes('XSHG:600519')).toBe(true);
});
test('IME opens a real input and composition Enter never selects a stock; editable controls do not trigger lookup', async ({ page }) => {
  await open(page);
  const chart = page.locator('[data-company-timeline]');
  await page.getByRole('button', { name: 'MA settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Moving average settings', exact: true });
  await settings.locator('input').first().fill('120'); await expect(page.locator('[data-stock-search]')).toHaveCount(0);
  await settings.locator('header button').click(); await chart.focus();
  await chart.dispatchEvent('keydown', { key: 'Process', keyCode: 229, bubbles: true });
  const input = page.getByRole('combobox', { name: 'Search company' }); await expect(input).toBeFocused();
  await input.dispatchEvent('compositionstart'); await input.fill('微软');
  await expect(page.getByRole('option', { name: /Microsoft/ })).toBeVisible();
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true, keyCode: 229 }); await expect(chart).toHaveAttribute('data-company-timeline', 'US:AMD');
  await input.dispatchEvent('compositionend'); await input.press('Enter'); await expect(chart).toHaveAttribute('data-company-timeline', 'US:MSFT');
});


test('restoring layout after lookup opens the selected company with the same chart settings', async ({ page }) => {
  await open(page);
  await page.getByLabel('Price history range').selectOption('90');
  await page.locator('[data-company-timeline]').focus(); await page.keyboard.type('nvda');
  await expect(page.getByRole('option', { name: /NVIDIA/ })).toBeVisible(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Restore layout', exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(companyResearchPath('US:NVDA', 'en'));
  expect(new URL(page.url()).searchParams.get('chartRange')).toBe('90');
});
