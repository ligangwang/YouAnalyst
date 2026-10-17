import { expect, test } from '@playwright/test';
import path from 'node:path';
import { componentFixtureHtml } from './fixtures/component-html';

let html: string;
test.beforeAll(async () => {
  html = await componentFixtureHtml(`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {StockComparePage} from './src/components/stock-compare-page';
    import {LocaleProvider} from './src/components/providers/locale-provider';
    createRoot(document.getElementById('root')).render(<LocaleProvider locale={location.pathname.includes('zh-cn')?'zh-CN':'en'}><StockComparePage initial={{symbols:['AAPL'],start:'2025-01-01',end:'2025-12-31',style:'line'}}/></LocaleProvider>);
  `, {
    alias: { 'next/link': path.resolve('tests/industry/link.tsx') },
    plugins: [{ name: 'chart-boundary', setup(build) {
      build.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'dynamic', namespace: 'chart-mock' }));
      build.onLoad({ filter: /.*/, namespace: 'chart-mock' }, () => ({ contents: 'export default function dynamic(){return ()=>null}', loader: 'js' }));
    } }],
  }, '.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}*{box-sizing:border-box}body{margin:0;font-family:Arial;--background:#07111d;--foreground:#f8fafc;--color-shell:#0f172a;--color-line:#ffffff30;--text-secondary:#9ba8b7;--text-muted:#8794a4;background:var(--background);color:var(--foreground)}button,input{font:inherit}button{color:inherit;background:transparent}');
});

for (const chinese of [false, true]) test(`covered company picker and five-year custom range (${chinese ? 'Chinese' : 'English'})`, async ({ page }, info) => {
  const requests: URL[] = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/tickers/search') {
      requests.push(url);
      return route.fulfill({ json: { total: 178, items: url.searchParams.has('q') ? [{ id: 'XSHG:600519', symbol: '600519', name: '贵州茅台', market: 'CN_A' }] : [] } });
    }
    if (url.pathname === '/api/compare') return route.fulfill({ json: { dates: ['2025-01-02', '2025-12-31'], series: [{ symbol: 'AAPL', values: [0, 20] }], frequency: 'Daily', source: 'Fixture' } });
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto(`http://playback.test/${chinese ? 'zh-cn' : 'en'}/compare`);
  await expect(page.getByRole('heading', { name: chinese ? '股票表现回放' : 'Stock performance playback', exact: true })).toHaveClass('sr-only');
  await expect(page.getByText('THE MARKET, IN MOTION', { exact: true })).toHaveCount(0);
  const chart = page.getByRole('region', { name: chinese ? '表现图表' : 'Performance chart', exact: true });
  const editor = page.getByRole('region', { name: chinese ? '编辑对比' : 'Edit comparison', exact: true });
  await expect(chart.getByRole('region', { name: chinese ? '导出对比视频' : 'Export comparison video', exact: true })).toHaveCount(1);
  await expect(page.getByRole('region', { name: chinese ? '导出对比视频' : 'Export comparison video', exact: true })).toHaveCount(1);
  await expect(page.getByText('The chart uses the first and last available shared trading days within your selected range.', { exact: true })).toHaveCount(0);
  const chartBox = await chart.boundingBox(), editorBox = await editor.boundingBox();
  expect(editorBox!.y).toBeGreaterThanOrEqual(chartBox!.y + chartBox!.height);
  const hint = page.getByText(chinese ? '已覆盖 178 家公司，持续扩充中。' : '178 companies covered · More coming soon', { exact: true });
  await expect(hint).toBeVisible();
  const input = page.getByRole('combobox', { name: chinese ? '搜索公司' : 'Search company', exact: true });
  const inputBox = await input.boundingBox(), hintBox = await hint.boundingBox();
  expect(hintBox!.y).toBeGreaterThan(inputBox!.y + inputBox!.height);
  await input.fill('茅台');
  await page.getByRole('option', { name: /贵州茅台/ }).click();
  await expect(page.getByRole('button', { name: chinese ? '移除 XSHG:600519' : 'Remove XSHG:600519', exact: true })).toBeVisible();
  await expect(input).toHaveValue('');
  expect(requests.every(url => url.searchParams.get('scope') === 'covered')).toBe(true);
  await page.getByRole('button', { name: '5Y', exact: true }).click();
  const from = page.getByLabel(chinese ? '起始日期' : 'From', { exact: true });
  await expect(from).toHaveValue('2020-12-31');
  await expect(from).toHaveAttribute('min', '2020-12-31');
  await expect(page.getByRole('button', { name: '10Y', exact: true })).toHaveCount(0);
  await page.getByLabel(chinese ? '结束日期' : 'To', { exact: true }).fill('2026-01-01');
  await expect(from).toHaveAttribute('min', '2021-01-01');
  await page.getByRole('button', { name: chinese ? '开始对比' : 'Compare', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Choose a period of 5 years or less.' })).toBeVisible();
  await page.getByLabel(chinese ? '结束日期' : 'To', { exact: true }).fill('2024-02-29');
  await page.getByRole('button', { name: '5Y', exact: true }).click();
  await expect(from).toHaveValue('2020-12-31');
  await expect(from).toHaveAttribute('min', '2020-12-31');
  await from.fill('2020-12-30');
  await page.getByRole('button', { name: chinese ? '开始对比' : 'Compare', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Choose a start date on or after December 31, 2020.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('stock-picker.png'), fullPage: true });
});
