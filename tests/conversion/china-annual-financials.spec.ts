import { test,expect } from '@playwright/test';
import { build } from 'esbuild';
import { parseCnAnnual } from '../../src/lib/fundamentals/cn-annual';
const annual=parseCnAnnual('XSHE:301308',{symbol:'SZ301308',rows:[{SECUCODE:'301308.SZ',SECURITY_CODE:'301308',REPORT_DATE:'2025-12-31',REPORT_TYPE:'年报',NOTICE_DATE:'2026-04-28',UPDATE_DATE:'2026-04-28',CURRENCY:'CNY',OPERATE_INCOME:22766169990.55,PARENT_NETPROFIT:1423298162.88}]},new Date('2026-09-27'));
let html='';
test.beforeAll(async()=>{
 const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ChinaAnnualFinancials} from './src/components/china-annual-financials';import {LocaleProvider} from './src/components/providers/locale-provider';const q=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<LocaleProvider locale={q.get('lang')==='zh-CN'?'zh-CN':'en'}><ChinaAnnualFinancials annual={q.has('missing')?null:${JSON.stringify(annual)}} stale/></LocaleProvider>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',define:{'process.env':'{}'}});
 html=`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`;
});
test('annual section displays real CNY values, report year, provenance, stale and missing states',async({page})=>{
 await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://annual.test/?lang=zh-CN');
 await expect(page.getByRole('region')).toContainText('227.66亿 CNY');
 await expect(page.getByRole('region')).toContainText('14.23亿 CNY');
 await expect(page.getByRole('region')).toContainText('2025');
 await expect(page.getByRole('region')).toContainText('年度归母净利润');
 await expect(page.getByRole('region')).toContainText('较早的缓存快照');
 await expect(page.getByRole('link')).toHaveAttribute('href',/eastmoney\.com/);
 await page.goto('http://annual.test/?lang=en');
 await expect(page.getByRole('region')).toContainText('22.77B CNY');
 await expect(page.getByRole('region')).toContainText('Annual net income attributable to parent');
 await page.goto('http://annual.test/?lang=zh-CN&missing=1');
 await expect(page.getByRole('region')).toContainText('年度财报数据尚未缓存');
});
