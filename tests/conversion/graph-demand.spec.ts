import {expect,test} from '@playwright/test';
import path from 'node:path';
import {componentFixtureHtml} from './fixtures/component-html';
let prediction:string,timeline:string;
test.beforeAll(async()=>{
 const mocks={name:'demand-mocks',setup(build:import('esbuild').PluginBuild){
  build.onResolve({filter:/(auth-provider|use-theme-catalog)$/},args=>({path:args.path,namespace:'demand'}));
  build.onLoad({filter:/.*/,namespace:'demand'},args=>({loader:'tsx',contents:args.path.endsWith('auth-provider')?
   `export function useAuth(){return {user:window.signedIn?{uid:'test'}:null,loading:false,getIdToken:async()=>null}}export const useOptionalAuth=useAuth;`:
   `const themes=['ai','robotics'];export function useThemeCatalog(){return {themes,nodes:[]}}`}));
 }};
 prediction=await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {CreatePredictionPage} from './src/components/create-prediction-page';function App(){const [signed,setSigned]=React.useState(false);window.signedIn=signed;return <><button onClick={()=>setSigned(!signed)}>Toggle sign in</button><CreatePredictionPage requestedTicker='AMD'/></>}createRoot(document.getElementById('root')).render(<App/>);`,{plugins:[mocks],alias:{'next/link':path.resolve('tests/industry/link.tsx'),'next/navigation':path.resolve('tests/conversion/fixtures/mocks.tsx')}});
 timeline=await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {CompanyTimeline} from './src/components/company-timeline';createRoot(document.getElementById('root')).render(<><h1>Overview</h1><div style={{height:3000}}/><CompanyTimeline companyId='US:AMD'/></>);`,{plugins:[mocks],alias:{'next/link':path.resolve('tests/industry/link.tsx'),'next/navigation':path.resolve('tests/conversion/fixtures/mocks.tsx')}});
});
test('anonymous publishing does not fetch graphs; signed-in coverage is sequential and stops on sign out',async({page})=>{
 const calls:string[]=[];let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url.includes('/api/knowledge-graph')){calls.push(url);await held;await route.fulfill({json:{nodes:[],relationships:[],sources:[]}});}
  else if(url.includes('/api/'))await route.fulfill({json:[]});
  else await route.fulfill({contentType:'text/html',body:prediction});
 });
 await page.goto('http://demand.test');await expect(page.getByRole('link',{name:'Sign in to publish'})).toBeVisible();expect(calls).toEqual([]);
 await page.getByRole('button',{name:'Toggle sign in'}).click();await expect.poll(()=>calls.length).toBe(1);expect(calls[0]).toContain('theme=ai');
 await page.getByRole('button',{name:'Toggle sign in'}).click();release();await expect(page.getByRole('link',{name:'Sign in to publish'})).toBeVisible();
 await page.getByRole('button',{name:'Toggle sign in'}).click();await expect.poll(()=>calls.length).toBe(3);expect(calls[2]).toContain('theme=robotics');
});
test('company timeline requests the full graph only when the chart is visible',async({page})=>{
 const graphs:string[]=[];
 await page.route('**/*',route=>{
  const url=route.request().url();
  if(url.includes('/api/knowledge-graph')){graphs.push(url);return route.fulfill({json:{nodes:[],relationships:[],sources:[]}});}
  if(url.includes('/api/'))return route.fulfill({json:{companyId:'US:AMD',available:true,currency:'USD',start:'2026-10-01',end:'2026-10-30',prices:[]}});
  return route.fulfill({contentType:'text/html',body:timeline});
 });
 await page.goto('http://demand.test');await expect(page.getByRole('heading',{name:'Overview'})).toBeVisible();expect(graphs).toEqual([]);
 await page.getByLabel('Price history range').scrollIntoViewIfNeeded();await expect.poll(()=>graphs.length).toBe(1);
 await page.getByRole('heading',{name:'Overview'}).scrollIntoViewIfNeeded();await page.getByLabel('Price history range').scrollIntoViewIfNeeded();expect(graphs).toHaveLength(1);
});

