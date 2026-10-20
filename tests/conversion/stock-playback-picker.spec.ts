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
    alias: { 'next/link': path.resolve('tests/industry/link.tsx'), '@/components/providers/auth-provider': path.resolve('tests/conversion/fixtures/mocks.tsx') },
    plugins: [{ name: 'chart-boundary', setup(build) {
      build.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'dynamic', namespace: 'chart-mock' }));
      build.onLoad({ filter: /.*/, namespace: 'chart-mock' }, () => ({ contents: 'export default function dynamic(){return ()=>null}', loader: 'js' }));
    } }],
  }, '.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}*{box-sizing:border-box}body{margin:0;font-family:Arial;--background:#07111d;--foreground:#f8fafc;--color-shell:#0f172a;--color-line:#ffffff30;--text-secondary:#9ba8b7;--text-muted:#8794a4;background:var(--background);color:var(--foreground)}button,input{font:inherit}button{color:inherit;background:transparent}');
});

test('a guest opens company color settings with an explicit sign-in destination', async ({ page }) => {
  let privateRequests = 0;
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/api/preferences/compare') privateRequests++;
    if (url.pathname === '/api/compare') return route.fulfill({ json: { dates: ['2025-01-02', '2025-12-31'], series: [{ symbol: 'AAPL', values: [0, 20] }], frequency: 'Daily', source: 'Fixture' } });
    return route.fulfill({ json: { items: [], total: 178 } });
  });
  await page.goto('http://playback.test/en/compare');
  await page.getByLabel('Selected stocks', { exact: true }).click();
  await page.getByRole('button', { name: 'Choose color for AAPL', exact: true }).click();
  const inline = page.getByRole('region', { name: 'Customize AAPL', exact: true });
  const link = inline.getByRole('link', { name: 'Sign in or create an account to customize', exact: true });
  await expect(link).toBeVisible();
  const next = new URL((await link.getAttribute('href'))!, 'http://playback.test').searchParams.get('next')!;
  expect(new URL(next, 'http://playback.test').searchParams.get('symbols')).toBe('AAPL');
  await expect(inline.locator('input[type=color]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove AAPL', exact: true })).toBeVisible();
  expect(privateRequests).toBe(0);
});

for (const chinese of [false, true]) test(`new stock colors are editable before applying the selection (${chinese ? 'Chinese' : 'English'})`, async ({ page }) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  const comparisons: string[][] = [];
  let saved: { companyColors: Record<string, string> } | null = null;
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/api/preferences/compare') {
      if (route.request().method() === 'PATCH') saved = route.request().postDataJSON();
      return route.fulfill({ json: { appearance: saved ?? { template: 'classic', style: 'line', companyColors: {} } } });
    }
    if (url.pathname === '/api/tickers/search') return route.fulfill({ json: { total: 178, items: url.searchParams.get('q') ? [{ id: 'US:MU', symbol: 'MU', name: 'Micron Technology' }] : [] } });
    if (url.pathname === '/api/compare') {
      const symbols = url.searchParams.get('symbols')!.split(','); comparisons.push(symbols);
      return route.fulfill({ json: { dates: ['2025-01-02', '2025-12-31'], series: symbols.map(symbol => ({ symbol, values: [0, 20] })), frequency: 'Daily', source: 'Fixture' } });
    }
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto(`http://playback.test/${chinese ? 'zh-cn' : 'en'}/compare`);
  await expect(page.getByTestId('comparison-date')).toBeVisible();
  const toggle = page.getByLabel(chinese ? '所选股票' : 'Selected stocks', { exact: true });
  await toggle.click();
  const input = page.getByRole('combobox', { name: chinese ? '搜索公司' : 'Search company', exact: true });
  await input.fill('MU');
  await page.getByRole('option', { name: /Micron Technology/ }).click();
  const inline = page.getByRole('region', { name: chinese ? '自定义 MU' : 'Customize MU', exact: true });
  await expect(inline).toBeVisible();
  const picker = inline.getByLabel(chinese ? 'MU 的颜色' : 'Color for MU', { exact: true });
  await expect(picker).toBeEnabled();
  await picker.fill('#123abc');
  await expect(page.getByRole('button', { name: chinese ? '选择 MU 的颜色' : 'Choose color for MU', exact: true }).locator('i')).toHaveCSS('background-color', 'rgb(18, 58, 188)');
  expect(comparisons).toEqual([['AAPL']]);
  await inline.getByRole('button', { name: chinese ? '保存默认设置' : 'Save my defaults', exact: true }).click();
  await expect(inline.getByRole('status')).toHaveText(chinese ? '默认设置已保存至账号。' : 'Defaults saved to your account.');
  expect(saved!.companyColors.MU).toBe('#123abc');
  await page.getByRole('button', { name: chinese ? '开始对比' : 'Compare', exact: true }).click();
  await expect(page.getByRole('button', { name: 'MU', exact: true }).locator('i')).toHaveCSS('background-color', 'rgb(18, 58, 188)');
  await toggle.click();
  await inline.getByRole('button', { name: chinese ? '默认颜色' : 'Default color', exact: true }).click();
  await expect(picker).not.toHaveValue('#123abc');
  await page.getByRole('button', { name: chinese ? '收起股票选择' : 'Collapse stock selection', exact: true }).click();
  await expect(page.locator('#comparison-settings')).toBeHidden();
  await expect(toggle).toContainText(chinese ? '展开' : 'Expand');
  await toggle.click();
  await page.getByRole('button', { name: chinese ? '关闭颜色设置' : 'Close color settings', exact: true }).click();
  await expect(inline).toHaveCount(0);
  await page.getByRole('button', { name: chinese ? '选择 MU 的颜色' : 'Choose color for MU', exact: true }).click();
  await expect(inline).toBeVisible();
  await page.getByRole('button', { name: chinese ? '移除 MU' : 'Remove MU', exact: true }).click();
  await expect(picker).toHaveCount(0);
});

for(const chinese of [false,true])test(`comparison custom right-click menu (${chinese?'Chinese':'English'})`,async({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).pathname==='/api/compare'?route.fulfill({json:{dates:['2025-01-02','2025-12-31'],series:[{symbol:'AAPL',values:[0,20]}],frequency:'Daily',source:'Fixture'}}):route.fulfill({contentType:'text/html',body:html}));
 await page.goto(`http://playback.test/${chinese?'zh-cn':'en'}/compare`);
 await expect(page.getByTestId('comparison-date')).toBeVisible();
 const chart=page.getByRole('region',{name:chinese?'表现图表':'Performance chart',exact:true});
 expect(await chart.evaluate(el=>!el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})))).toBe(true);
 const tools=page.getByRole('dialog',{name:chinese?'对比工具':'Comparison tools',exact:true});await expect(tools).toBeVisible();
 await tools.getByRole('button',{name:chinese?'条形':'Bar',exact:true}).click();
 await expect(tools.getByRole('button',{name:chinese?'条形':'Bar',exact:true})).toHaveAttribute('aria-pressed','true');
 await tools.getByRole('button',{name:chinese?'重播动画':'Replay animation',exact:true}).click();await expect(tools).toHaveCount(0);
 await expect(page.getByRole('button',{name:chinese?'暂停动画':'Pause animation',exact:true})).toBeVisible();
 expect(await page.locator('main').evaluate(el=>!el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})))).toBe(true);
 await expect(tools).toBeVisible();await page.keyboard.press('Escape');await expect(tools).toHaveCount(0);
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
  expect(chartBox!.y).toBeGreaterThanOrEqual(editorBox!.y + editorBox!.height);
  expect(editorBox!.height).toBeLessThan(140);
  const toggle = editor.getByLabel(chinese ? '所选股票' : 'Selected stocks', { exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(editor.locator('#comparison-settings')).toBeHidden();
  await toggle.focus();
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
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
  await from.fill('2021-03-01');
  await page.getByRole('button', { name: chinese ? '开始对比' : 'Compare', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(editor.locator('#comparison-settings')).toBeHidden();
  await expect(toggle).toContainText('2021-03-01');
  await toggle.click();
  await expect(from).toHaveValue('2021-03-01');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('stock-picker.png'), fullPage: true });
});
