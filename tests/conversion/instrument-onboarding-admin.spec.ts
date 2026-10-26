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
      if(url.searchParams.has('instrumentId')){
        expect(url.searchParams.get('instrumentId')).toBe(id);
        return route.fulfill({json:url.searchParams.has('requesterCursor')?{items:[{requestedByUid:'second-user-456',requestedAt:'2026-10-25T14:00:00Z'}],nextCursor:null}:{items:[{requestedByUid:'requester-user-123',requestedAt:item.request.requestedAt}],nextCursor:'a'.repeat(64)}});
      }
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
  await page.getByText('View all requesters',{exact:true}).click();
  await expect(page.locator('details').getByText('requester-user-123',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Load more requesters',exact:true}).click();
  await expect(page.getByText('second-user-456',{exact:true})).toBeVisible();
  await expect(page.locator('details time').last()).toHaveAttribute('datetime','2026-10-25T14:00:00Z');
  await expect(page.locator('li[aria-current=step]')).toContainText('prices');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:info.outputPath('instrument-onboarding-admin.png'),fullPage:true});
  await page.getByRole('button',{name:'Retry failed step',exact:true}).click();
  await expect(page.getByRole('button',{name:'Queuing…',exact:true})).toBeDisabled();
  await expect(page.getByText('Failed step queued for retry. Completed steps were preserved.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry failed step',exact:true})).toBeDisabled();
  expect(writes).toBe(1);await expect(page.locator('li[data-complete=true]')).toHaveCount(5);
  await expect(page.locator('ol li')).toHaveCount(7);
  await expect(page.locator('ol li').filter({hasText:/\b(graph|fundamentals|metrics)\b/})).toHaveCount(0);
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

test('status selector filters before pagination, keeps refresh scoped, and shows retrying errors',async({page},info)=>{
  await page.addInitScript(()=>{window.authScenario={signedIn:true};});const queries:{filter:string;cursor:string|null}[]=[];
  const queued={...item,listing:'US:WAIT',request:{...item.request,instrumentId:'INS_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',status:'QUEUED'},canRetry:true};
  await page.route('**/*',route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/api/admin/me')return route.fulfill({json:{isAdmin:true}});
    if(url.pathname==='/api/admin/instrument-onboarding'){
      const filter=url.searchParams.get('filter')??'ALL',cursor=url.searchParams.get('cursor');queries.push({filter,cursor});
      return route.fulfill({json:{items:filter==='SUPPORTED'?[]:filter==='ALL'?[queued]:filter==='ERRORS'?[item,queued]:cursor?[{...item,listing:'US:NEXT',request:{...item.request,instrumentId:'INS_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'}}]:[item],nextCursor:filter==='BLOCKED'&&!cursor?id:null}});
    }
    return route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto(origin+'/admin/instrument-onboarding');const selector=page.getByLabel('Show requests',{exact:true});
  await expect(page.getByRole('heading',{name:'US:WAIT',exact:true})).toBeVisible();
  await selector.selectOption('BLOCKED');await expect(page.getByRole('heading',{name:'US:NEW.B',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'US:WAIT',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Load more',exact:true}).click();await expect(page.getByRole('heading',{name:'US:NEXT',exact:true})).toBeVisible();expect(queries.at(-1)).toEqual({filter:'BLOCKED',cursor:id});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('heading',{name:'US:NEXT',exact:true})).toHaveCount(0);expect(queries.at(-1)).toEqual({filter:'BLOCKED',cursor:null});
  await page.screenshot({path:info.outputPath('onboarding-blocked-filter.png'),fullPage:true});
  await selector.selectOption('ERRORS');await expect(page.getByRole('heading',{name:'US:WAIT',exact:true})).toBeVisible();await expect(page.getByText('Includes blocked requests and temporary failures waiting for another attempt.',{exact:true})).toBeVisible();
  await selector.selectOption('SUPPORTED');await expect(page.getByText('No onboarding requests match this status.',{exact:true})).toBeVisible();await expect(page.locator('article')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

test('a delayed response from a previous filter cannot replace the current status results',async({page})=>{
  await page.addInitScript(()=>{window.authScenario={signedIn:true};});let releaseBlocked!:()=>void;
  const blockedGate=new Promise<void>(resolve=>{releaseBlocked=resolve;});let blockedStarted!:()=>void;const started=new Promise<void>(resolve=>{blockedStarted=resolve;});
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.pathname==='/api/admin/me')return route.fulfill({json:{isAdmin:true}});
    if(url.pathname==='/api/admin/instrument-onboarding'){
      const filter=url.searchParams.get('filter');if(filter==='BLOCKED'){blockedStarted();await blockedGate;}
      return route.fulfill({json:{items:filter==='QUEUED'?[{...item,listing:'US:WAIT',request:{...item.request,status:'QUEUED'}}]:[item],nextCursor:null}});
    }
    return route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto(origin+'/admin/instrument-onboarding');await expect(page.getByRole('heading',{name:'US:NEW.B',exact:true})).toBeVisible();
  const selector=page.getByLabel('Show requests',{exact:true});await selector.selectOption('BLOCKED');await started;await selector.selectOption('QUEUED');await expect(page.getByRole('heading',{name:'US:WAIT',exact:true})).toBeVisible();
  const oldResponse=page.waitForResponse(r=>r.url().includes('filter=BLOCKED'));releaseBlocked();await oldResponse;
  await expect(selector).toHaveValue('QUEUED');await expect(page.getByRole('heading',{name:'US:WAIT',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'US:NEW.B',exact:true})).toHaveCount(0);
});

test('admin batch form resolves exact listings and submits once with the signed-in identity',async({page},info)=>{
  await page.addInitScript(()=>{window.authScenario={signedIn:true};});
  let writes=0;const lookedUp:string[]=[];
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/api/admin/me')return route.fulfill({json:{isAdmin:true}});
    if(url.pathname==='/api/admin/instrument-onboarding')return route.fulfill({json:{items:[],nextCursor:null}});
    if(url.pathname==='/api/tickers/search'){
      const listing=url.searchParams.get('q')!;lookedUp.push(listing);
      return route.fulfill({json:{items:[{id:listing,instrumentId:listing==='US:IBM'?id:'INS_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}]}});
    }
    if(url.pathname==='/api/admin/instrument-onboarding/requests'){
      writes++;expect(req.headers().authorization).toBe('Bearer isolated-test-token');
      expect(req.postDataJSON()).toEqual({items:[{listingId:'US:IBM',instrumentId:id},{listingId:'XSHE:300274',instrumentId:'INS_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}]});
      await new Promise(resolve=>setTimeout(resolve,150));
      return route.fulfill({status:503,json:{items:[{index:0,status:'QUEUED',outcome:'QUEUED'},{index:1,status:'DEFERRED',outcome:'DEFERRED',error:'Batch stopped; safe to retry'}]}});
    }
    return route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto(origin+'/admin/instrument-onboarding');
  await page.getByLabel('Listings (one per line)',{exact:true}).fill('us:ibm\nXSHE:300274\nUS:IBM');
  await page.getByRole('button',{name:'Submit onboarding requests',exact:true}).click();
  await expect(page.getByRole('button',{name:'Submitting…',exact:true})).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('US:IBM — Onboarding Queued');
  await expect(page.getByRole('status')).toContainText('XSHE:300274 — Deferred');
  expect(writes).toBe(1);expect(lookedUp).toEqual(['US:IBM','XSHE:300274']);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:info.outputPath('onboarding-batch-form.png'),fullPage:true});
  await page.getByLabel('Listings (one per line)',{exact:true}).fill('NOT_A_LISTING');
  await page.getByRole('button',{name:'Submit onboarding requests',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Enter 1–25');expect(writes).toBe(1);
});
