import {expect,test} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';

let html:string;
const origin='http://unmatched-cik.test';
test.beforeAll(async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AdminUnmatchedCik} from './src/components/admin-unmatched-cik';import {LocaleProvider} from './src/components/providers/locale-provider';createRoot(document.getElementById('root')).render(<LocaleProvider locale="en"><AdminUnmatchedCik/></LocaleProvider>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',alias:{'@/components/providers/auth-provider':path.resolve('tests/conversion/fixtures/mocks.tsx')},define:{'process.env':'{}'}});
  html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`;
});
test('admin can inspect empty batches and continue to unmatched records',async({page},info)=>{
  await page.addInitScript(()=>{window.authScenario={signedIn:true};});
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/admin/unmatched-cik'){
      expect(route.request().headers().authorization).toBe('Bearer isolated-test-token');
      return route.fulfill({json:url.searchParams.get('after')?{items:[{id:'US:NEW',name:'New Company',symbol:'NEW',active:true,supported:false}],scanned:20,nextCursor:null}:{items:[],scanned:100,nextCursor:'US:ABC'}});
    }
    return route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.fulfill({status:404});
  });
  await page.goto(origin+'/admin/unmatched-cik');
  await expect(page.getByRole('heading',{name:'Companies without a matched CIK'})).toBeVisible();
  await expect(page.getByText('No unmatched companies in this batch.')).toBeVisible();
  await page.getByRole('button',{name:'Next batch'}).click();
  await expect(page.getByText('New Company',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Next batch'})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('unmatched-cik.png')});
  await page.getByRole('button',{name:'Refresh from beginning'}).click();
  await expect(page.getByRole('button',{name:'Next batch'})).toBeVisible();
});
