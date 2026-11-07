import {expect,test} from '@playwright/test';
import {componentFixtureHtml} from './fixtures/component-html';

test('tooltip shows both completed market dates without any company prices',async({page})=>{
 const html=await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {IntelligencePriceAsOf} from './src/components/intelligence-price-as-of';import {LocaleProvider} from './src/components/providers/locale-provider';createRoot(document.getElementById('root')).render(<LocaleProvider locale='en'><IntelligencePriceAsOf/></LocaleProvider>);`);
 await page.route('**/*',route=>route.request().url().includes('/api/eod/completed')?route.fulfill({json:{US:'2026-11-06',CN_A:'2026-11-05'}}):route.fulfill({contentType:'text/html',body:html}));
 await page.goto('http://eod-tooltip.test');
 await page.getByRole('button',{name:'Price change and closing date details'}).focus();
 const tooltip=page.getByRole('tooltip');
 await expect(tooltip).toContainText('US 2026-11-06');
 await expect(tooltip).toContainText('CN 2026-11-05');
});
