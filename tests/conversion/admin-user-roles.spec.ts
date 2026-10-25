import {expect,test} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';

let html:string;const origin='http://admin-roles.test';
const account={id:'target-user-uid',displayName:'Target user',nickname:'admin',email:'admin@youanalyst.com',admin:false,profileAdmin:false,claimsAdmin:false,version:'10:1',self:false,disabled:false};
test.beforeAll(async()=>{
  const mock=path.resolve('tests/conversion/fixtures/mocks.tsx');
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {AdminAccessGuard} from './src/components/admin-access-guard';import {AdminUserRoles} from './src/components/admin-user-roles';import {LocaleProvider} from './src/components/providers/locale-provider';createRoot(document.getElementById('root')).render(<LocaleProvider locale="en"><AdminAccessGuard><AdminUserRoles/></AdminAccessGuard></LocaleProvider>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,outfile:'roles-fixture.js',platform:'browser',alias:{'@/components/providers/auth-provider':mock},define:{'process.env':'{}'}});
  html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:12px;background:#07111d;font:14px Arial;color:#dbeaf6}#root{max-width:900px;margin:auto}${bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text??''}</style></head><body><div id="root"></div><script>${bundle.outputFiles.find(file=>file.path.endsWith('.js'))!.text.replaceAll('</script','<\\/script')}</script></body></html>`;
});

test('admin confirms the exact account before granting or revoking access',async({page},info)=>{
  await page.addInitScript(()=>{window.authScenario={signedIn:true};});const patches:{userId:string;admin:boolean;version:string}[]=[];let current={...account};
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==='/api/admin/me')return route.fulfill({json:{isAdmin:true}});
    if(url.pathname==='/api/admin/users/role'){
      expect(request.headers().authorization).toBe('Bearer isolated-test-token');
      if(request.method()==='PATCH'){const body=request.postDataJSON();patches.push(body);current={...current,admin:body.admin,profileAdmin:body.admin,version:body.admin?'10:2':'10:3'};}
      else expect(url.searchParams.get('q')).toBe('@admin');
      return route.fulfill({json:{user:current}});
    }
    return route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto(origin+'/admin');await page.getByLabel('Account identifier',{exact:true}).fill('@admin');await page.getByRole('button',{name:'Look up account',exact:true}).click();
  await expect(page.getByText('admin@youanalyst.com',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Grant admin access',exact:true}).click();
  const confirm=page.getByRole('group',{name:'Confirm administrator access change'});await expect(confirm).toContainText('admin@youanalyst.com');await expect(confirm).toContainText('target-user-uid');expect(patches).toHaveLength(0);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(patches).toHaveLength(0);
  await page.getByRole('button',{name:'Grant admin access',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:info.outputPath('admin-role-confirmation.png'),fullPage:true});
  await page.getByRole('button',{name:'Confirm grant',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Administrator access granted.');
  expect(patches).toEqual([{userId:'target-user-uid',admin:true,version:'10:1'}]);
  await page.getByRole('button',{name:'Revoke admin access',exact:true}).click();await page.getByRole('button',{name:'Confirm revoke',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Administrator access revoked.');
  expect(patches[1]).toEqual({userId:'target-user-uid',admin:false,version:'10:2'});
});

for(const mode of ['self','claims'] as const)test(`${mode} admin access cannot be revoked from this control`,async({page})=>{
  await page.addInitScript(()=>{window.authScenario={signedIn:true};});let writes=0;
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());if(url.pathname==='/api/admin/me')return route.fulfill({json:{isAdmin:true}});
    if(url.pathname==='/api/admin/users/role'){if(request.method()!=='GET')writes++;return route.fulfill({json:{user:{...account,admin:true,profileAdmin:mode==='self',self:mode==='self',claimsAdmin:mode==='claims'}}});}
    return route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto(origin+'/admin');await page.getByLabel('Account identifier').fill('admin');await page.getByRole('button',{name:'Look up account',exact:true}).click();
  await expect(page.getByRole('button',{name:'Revoke admin access',exact:true})).toBeDisabled();expect(writes).toBe(0);
});

test('non-admin sees no role management controls',async({page})=>{
  await page.addInitScript(()=>{window.authScenario={signedIn:true};});let reads=0;
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname==='/api/admin/me')return route.fulfill({json:{isAdmin:false}});if(url.pathname==='/api/admin/users/role')reads++;return route.fulfill({contentType:'text/html',body:html});});
  await page.goto(origin+'/admin');await expect(page.getByRole('alert')).toHaveText('This page is available to administrators only.');await expect(page.getByLabel('Account identifier')).toHaveCount(0);expect(reads).toBe(0);
});
