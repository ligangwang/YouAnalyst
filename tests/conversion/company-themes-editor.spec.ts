import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {compile} from '@tailwindcss/node';
let html:string;
const origin='http://theme-editor.test';
const initial={version:'a'.repeat(64),themes:[{id:'robotics',names:{en:'Robotics','zh-CN':'机器人'},roles:['manufacturers']},{id:'space',names:{en:'Space','zh-CN':'太空'},roles:['components']}],assignments:[{theme:'robotics',primarySector:'manufacturers',secondaryRoles:[],sources:[{url:'https://example.com/robots',title:'Company robots',summary:'Manufactures robots.'}]}]};
test.beforeAll(async()=>{
 const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {CompanyThemesEditor} from './src/components/company-themes-editor';import {LocaleProvider} from './src/components/providers/locale-provider';createRoot(document.getElementById('root')).render(<LocaleProvider locale="en"><CompanyThemesEditor companyId="US:TEST"/></LocaleProvider>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',alias:{'@/components/providers/auth-provider':path.resolve('tests/conversion/fixtures/mocks.tsx'),'next/navigation':path.resolve('tests/conversion/fixtures/mocks.tsx')},define:{'process.env':'{}'}});
 const source=await readFile('src/components/company-themes-editor.tsx','utf8');
 const css=await compile(await readFile('src/app/globals.css','utf8'),{base:path.resolve('src/app'),onDependency:()=>{}});
 const styles=css.build([...source.matchAll(/className="([^"]+)"/g)].flatMap(match=>match[1].split(/\s+/)));
 html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}body{padding:16px;font:14px Arial}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></body></html>`;
});
test('admin changes themes on the company page and saves immediate corrections',async({page},info)=>{
 await page.addInitScript(()=>{window.authScenario={signedIn:true};});let state=structuredClone(initial),writes=0;
 await page.route('**/*',async route=>{const r=route.request();if(new URL(r.url()).pathname==='/api/admin/company-themes'){
  expect(r.headers().authorization).toBe('Bearer isolated-test-token');
  if(r.method()==='POST'){writes++;const body=r.postDataJSON();expect(body.version).toBe(initial.version);expect(body.assignments.map((a:{theme:string})=>a.theme)).toEqual(['space']);state={...state,version:'b'.repeat(64),assignments:body.assignments};return route.fulfill({json:{themeIds:['space']}});}
  return route.fulfill({json:state});}
  return r.isNavigationRequest()?route.fulfill({contentType:'text/html',body:html}):route.fulfill({status:404});});
 await page.goto(origin);await page.getByRole('button',{name:'Edit company themes'}).click();await page.getByRole('checkbox',{name:'Robotics',exact:true}).uncheck();await expect(page.getByRole('button',{name:'Save themes',exact:true})).toBeDisabled();
 await page.getByRole('checkbox',{name:'Space',exact:true}).check();await page.getByLabel('Space source URL',{exact:true}).fill('https://example.com/space');await page.getByLabel('Space business evidence',{exact:true}).fill('Manufactures spacecraft components.');await page.getByRole('button',{name:'Save themes',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Themes saved.');expect(writes).toBe(1);await expect(page.getByRole('checkbox',{name:'Space',exact:true})).toBeChecked();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:info.outputPath('company-themes-editor.png'),fullPage:true});
});
test('non-admins do not see editing controls',async({page})=>{
 await page.addInitScript(()=>{window.authScenario={signedIn:true};});await page.route('**/*',r=>new URL(r.request().url()).pathname==='/api/admin/company-themes'?r.fulfill({status:403,json:{error:'Forbidden'}}):r.fulfill({contentType:'text/html',body:html}));await page.goto(origin);await expect(page.getByRole('button',{name:'Edit company themes'})).toHaveCount(0);
});
test('selected AI stage is submitted without broadening to its parent sector',async({page})=>{
 await page.addInitScript(()=>{window.authScenario={signedIn:true};});let saved=false;
 const state={version:initial.version,themes:[{id:'ai',names:{en:'AI','zh-CN':'人工智能'},roles:['applications','ai.applications.edge']}],assignments:[{...initial.assignments[0],theme:'ai',primarySector:'applications',aiStageIds:['applications']}]};
 await page.route('**/*',route=>{const r=route.request();if(new URL(r.url()).pathname==='/api/admin/company-themes'){
  if(r.method()==='POST'){const a=r.postDataJSON().assignments[0];expect(a.primarySector).toBe('ai.applications.edge');expect(a.aiStageIds).toEqual(['ai.applications.edge']);saved=true;return route.fulfill({json:{themeIds:['ai']}});}return route.fulfill({json:state});}return route.fulfill({contentType:'text/html',body:html});});
 await page.goto(origin);await page.getByRole('button',{name:'Edit company themes'}).click();await page.getByLabel('AI sector',{exact:true}).selectOption('ai.applications.edge');await page.getByRole('button',{name:'Save themes',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Themes saved.');expect(saved).toBe(true);
});
test('a concurrent correction requires reload and keeps unsaved input',async({page})=>{
 await page.addInitScript(()=>{window.authScenario={signedIn:true};});await page.route('**/*',route=>{const r=route.request();if(new URL(r.url()).pathname==='/api/admin/company-themes')return r.method()==='POST'?route.fulfill({status:409,json:{error:'Changed'}}):route.fulfill({json:initial});return route.fulfill({contentType:'text/html',body:html});});await page.goto(origin);await page.getByRole('button',{name:'Edit company themes'}).click();await page.getByLabel('Robotics business evidence',{exact:true}).fill('Updated business evidence.');await page.getByRole('button',{name:'Save themes',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Company changed');await expect(page.getByLabel('Robotics business evidence',{exact:true})).toHaveValue('Updated business evidence.');
});
