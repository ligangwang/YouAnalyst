import {expect,test} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';

let html:string;
const origin='http://onboarding.test',id='INS_0123456789abcdef0123456789abcdef';
const item={request:{instrumentId:id,companyId:'US:NEW',version:1,status:'BLOCKED',requestedByUid:'requester-user-123',requestedAt:'2026-10-25T12:00:00Z',updatedAt:'2026-10-25T13:00:00Z',targetThrough:'2026-10-24',steps:{identity:'COMPLETE',themes:'COMPLETE',profile:'COMPLETE',fundamentals:'COMPLETE',graph:'COMPLETE',events:'COMPLETE',corporateActions:'COMPLETE'},attemptCount:2,nextAttemptAt:0,leaseOwner:null,leaseExpiresAt:0,lastError:'prices: Historical price provider returned HTTP 503'},companyName:'New company',instrumentName:'New class B',listing:'US:NEW.B',companyStatus:'SUPPORTED',instrumentStatus:'BLOCKED',step:'prices',canRetry:true};
test.beforeAll(async()=>{
  const mock=path.resolve('tests/conversion/fixtures/mocks.tsx');
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AdminAccessGuard} from './src/components/admin-access-guard';import {AdminInstrumentOnboardingPage} from './src/components/admin-instrument-onboarding-page';import {LocaleProvider} from './src/components/providers/locale-provider';createRoot(document.getElementById('root')).render(<LocaleProvider locale="en"><AdminAccessGuard><AdminInstrumentOnboardingPage/></AdminAccessGuard></LocaleProvider>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,outfile:'admin-fixture.js',platform:'browser',alias:{'@/components/providers/auth-provider':mock,'next/link':mock,'next/navigation':mock},define:{'process.env':'{}'}});
  html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;background:#07111d;font:14px Arial;color:#dbeaf6}${bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text??''}</style></head><body><div id="root"></div><script>${bundle.outputFiles.find(file=>file.path.endsWith('.js'))!.text.replaceAll('</script','<\\/script')}</script></body></html>`;
});

test('admin sees separated readiness and can retry just the failed step',async({page},info)=>{
  await page.addInitScript(()=>{window.authScenario={signedIn:true};});let queued=false,writes=0;
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==='/api/admin/me')return route.fulfill({json:{isAdmin:true}});
    if(url.pathname==='/api/admin/instrument-onboarding'){
      expect(request.headers().authorization).toBe('Bearer isolated-test-token');
      if(request.method()==='POST'){
        writes++;expect(request.postDataJSON()).toEqual({instrumentId:id,step:'prices',updatedAt:item.request.updatedAt});
        await new Promise(resolve=>setTimeout(resolve,200));queued=true;return route.fulfill({json:{status:'QUEUED'}});
      }
      return route.fulfill({json:{items:[queued?{...item,request:{...item.request,status:'QUEUED',lastError:null},canRetry:false}:item],nextCursor:null}});
    }
    return request.isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.fulfill({status:404,body:''});
  });
  await page.goto(origin+'/admin/instrument-onboarding');
  await expect(page.getByRole('heading',{name:'Instrument Onboarding',exact:true})).toBeVisible();
  await expect(page.getByText('Company: SUPPORTED',{exact:true})).toBeVisible();
  await expect(page.getByText('Instrument: BLOCKED',{exact:true})).toBeVisible();
  await expect(page.getByText(item.request.lastError,{exact:true})).toBeVisible();
  await expect(page.getByText('requester-user-123',{exact:true})).toBeVisible();
  await expect(page.locator('li[aria-current=step]')).toContainText('prices');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:info.outputPath('instrument-onboarding-admin.png'),fullPage:true});
  await page.getByRole('button',{name:'Retry failed step',exact:true}).click();
  await expect(page.getByRole('button',{name:'Queuing…',exact:true})).toBeDisabled();
  await expect(page.getByText('Failed step queued for retry. Completed steps were preserved.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry failed step',exact:true})).toBeDisabled();
  expect(writes).toBe(1);await expect(page.locator('li[data-complete=true]')).toHaveCount(7);
});

test('non-admin cannot view onboarding requests or retry controls',async({page})=>{
  await page.addInitScript(()=>{window.authScenario={signedIn:true};});let reads=0;
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());if(url.pathname==='/api/admin/me')return route.fulfill({json:{isAdmin:false}});
    if(url.pathname==='/api/admin/instrument-onboarding'){reads++;return route.fulfill({status:403,json:{error:'Forbidden'}});}
    return route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto(origin+'/admin/instrument-onboarding');
  await expect(page.getByRole('alert')).toHaveText('This page is available to administrators only.');expect(reads).toBe(0);
  await expect(page.getByRole('button',{name:'Retry failed step'})).toHaveCount(0);
});
