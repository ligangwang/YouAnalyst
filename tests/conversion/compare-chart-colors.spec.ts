import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { componentFixtureHtml } from './fixtures/component-html';

let html: string;
test.beforeAll(async () => {
  html = await componentFixtureHtml(`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {StockComparePage} from './src/components/stock-compare-page';
    import {LocaleProvider} from './src/components/providers/locale-provider';
    createRoot(document.getElementById('root')).render(<LocaleProvider locale="en"><StockComparePage initial={{symbols:['MU','SKHY'],start:'2025-01-01',end:'2025-12-31',style:'line'}}/></LocaleProvider>);
  `, {
    alias: { 'next/link': path.resolve('tests/industry/link.tsx'), '@/components/providers/auth-provider': path.resolve('tests/conversion/fixtures/mocks.tsx') },
    plugins: [{ name: 'real-dynamic-chart', setup(build) {
      build.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'dynamic', namespace: 'real-chart' }));
      build.onLoad({ filter: /.*/, namespace: 'real-chart' }, () => ({ contents: `
        import React,{useEffect,useState} from 'react';
        export default function dynamic(load){return function Component(props){const [C,setC]=useState(null);useEffect(()=>{let active=true;load().then(c=>{if(active)setC(()=>c)});return()=>{active=false}},[]);return C?React.createElement(C,props):null;}}
      `, loader: 'js', resolveDir: process.cwd() }));
    } }],
  }, '*{box-sizing:border-box}body{margin:0;font-family:Arial;--background:#07111d;--foreground:#f8fafc;--color-shell:#0f172a;--color-line:#ffffff30;--text-secondary:#9ba8b7;--text-muted:#8794a4;background:var(--background);color:var(--foreground)}button,input{font:inherit}button{color:inherit;background:transparent}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}');
});

async function colorPixels(page: Page, png: Buffer) {
  return page.evaluate(async source => {
    const img = new Image(); img.src = source; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    let yellow = 0, magenta = 0;
    for (let i = 0; i < data.length; i += 4) {
      // The line must contain fully bright pixels, not just dim anti-aliased edges.
      if (data[i] > 245 && data[i + 1] > 245 && data[i + 2] < 10) yellow++;
      if (data[i] > 245 && data[i + 1] < 10 && data[i + 2] > 245) magenta++;
    }
    return { yellow, magenta };
  }, `data:image/png;base64,${png.toString('base64')}`);
}

test('picker, chips and actual rendered lines and bars keep the same bright colors', async ({ page }, info) => {
  await page.addInitScript(() => { window.authScenario = { signedIn: true }; });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/api/preferences/compare') return route.fulfill({ json: { appearance: { template: 'classic', style: 'line', companyColors: { MU: '#ffff00', SKHY: '#ff00ff' } } } });
    if (url.pathname === '/api/compare') return route.fulfill({ json: { dates: ['2025-01-02', '2025-06-02', '2025-12-31'], series: [{ symbol: 'MU', values: [0, 10, 20] }, { symbol: 'SKHY', values: [0, 20, 10] }], frequency: 'Daily', source: 'Fixture' } });
    return route.fulfill({ json: { items: [], total: 178 } });
  });
  await page.goto('http://compare-colors.test/en/compare');
  const chart = page.getByRole('img', { name: 'Animated stock price return comparison', exact: true });
  await expect(chart.locator('canvas')).toBeVisible();
  await expect(page.getByRole('heading', { name: /^At a glance/ })).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByLabel('Selected stocks', { exact: true })).toHaveAttribute('aria-expanded', 'true');
  const chip = page.getByRole('button', { name: 'Choose color for MU', exact: true });
  await chip.click();
  const inline = page.getByRole('region', { name: 'Customize MU', exact: true });
  await expect(inline.getByLabel('Color for MU', { exact: true })).toHaveValue('#ffff00');
  await expect(chip.locator('i')).toHaveCSS('background-color', 'rgb(255, 255, 0)');
  const stage = page.getByRole('region', { name: 'Performance chart', exact: true });
  expect(await inline.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await stage.evaluate(el => getComputedStyle(el).backgroundColor));
  await page.screenshot({ path: info.outputPath('inline-company-color.png'), fullPage: true });
  await page.getByRole('button', { name: 'Collapse stock selection', exact: true }).click();
  await expect(page.locator('#comparison-settings')).toBeHidden();
  // Hide HTML grid/endpoint labels while sampling so a correctly colored label
  // cannot make an incorrectly colored or missing WebGL line pass this test.
  const pixelStyle = '[role="img"] > div[aria-hidden="true"] { visibility:hidden }';
  await page.screenshot({ path: info.outputPath('compare-colors.png'), fullPage: true });
  const lines = await chart.screenshot({ path: info.outputPath('bright-lines.png'), style: pixelStyle });
  const linePixels = await colorPixels(page, lines);
  expect(linePixels.yellow).toBeGreaterThan(40); expect(linePixels.magenta).toBeGreaterThan(40);
  await page.getByRole('button', { name: 'Bar', exact: true }).click();
  const bars = await chart.screenshot({ path: info.outputPath('bright-bars.png'), style: pixelStyle });
  const barPixels = await colorPixels(page, bars);
  expect(barPixels.yellow).toBeGreaterThan(200); expect(barPixels.magenta).toBeGreaterThan(200);
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.getByRole('slider', { name: 'Comparison timeline', exact: true }).fill('0.5');
  const partial = await colorPixels(page, await chart.screenshot({ style: pixelStyle }));
  expect(partial.yellow).toBeGreaterThan(20); expect(partial.magenta).toBeGreaterThan(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await chart.locator('canvas').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  await expect(page.getByText('Animation is unavailable in this browser. Returns are shown in the table below.', { exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'MU' }).locator('td').last()).toHaveText('+10.00%');
});
