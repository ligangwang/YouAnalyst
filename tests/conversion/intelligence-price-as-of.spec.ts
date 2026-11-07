import {expect,test} from '@playwright/test';
import {componentFixtureHtml} from './fixtures/component-html';

test('tooltip shows both completed market dates without any company prices',async({page})=>{
 const html=await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {IntelligencePriceAsOf} from './src/components/intelligence-price-as-of';import {LocaleProvider} from './src/components/providers/locale-provider';createRoot(document.getElementById('root')).render(<LocaleProvider locale='en'><IntelligencePriceAsOf/></LocaleProvider>);`);
 let calls=0;
 await page.route('**/*',route=>{if(route.request().url().includes('/api/eod/completed')){calls++;return route.fulfill({json:{US:'2026-11-06',CN_A:'2026-11-05'}});}return route.fulfill({contentType:'text/html',body:html});});
 await page.goto('http://eod-tooltip.test');
 await expect(page.getByRole('button',{name:'Price change and closing date details'})).toBeVisible();
 expect(calls).toBe(0);
 await page.getByRole('button',{name:'Price change and closing date details'}).focus();
 const tooltip=page.getByRole('tooltip');
 await expect(tooltip).toContainText('US 2026-11-06');
 await expect(tooltip).toContainText('CN 2026-11-05');
 expect(calls).toBe(1);
});
