import { test,expect } from '@playwright/test';
import { componentFixtureHtml } from './fixtures/component-html';
import seed from '../../data/investment-themes/catalog-v1.json';

for(const chinese of [false,true])test(`theme selector groups Firestore themes by family and refreshes new themes without a reload (${chinese?'Chinese':'English'})`,async({page})=>{
  const html=await componentFixtureHtml(`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {IntelligenceThemeSelector} from './src/components/intelligence-theme-selector';function App(){const [theme,setTheme]=useState('ai');return <IntelligenceThemeSelector theme={theme} onChange={setTheme}/>;}createRoot(document.getElementById('root')).render(<App/>);`,{mockThemeCatalog:false,plugins:[{name:'locale',setup(build){build.onResolve({filter:/locale-provider$/},()=>({path:'locale',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({loader:'js',contents:`export const useLocale=()=>({chinese:${chinese}});`}));}}]});
  const nodes=structuredClone(seed.nodes);let reads=0,failed=false;
  await page.clock.install();
  await page.route('**/*',route=>{
    if(new URL(route.request().url()).pathname==='/api/investment-themes'){reads++;return failed?route.fulfill({status:503,json:{error:'Unavailable'}}):route.fulfill({json:{nodes}});}
    return route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto('http://catalog.test');
  const select=page.getByRole('combobox',{name:chinese?'投资主题':'Investment theme'});
  const family=page.getByRole('combobox',{name:chinese?'主题大类':'Theme family'});
  await expect(family.locator('option')).toHaveCount(4);
  await expect(family).toHaveValue('transformative-technologies');
  await expect(select).toHaveValue('ai');
  await expect(select.locator('option')).toHaveCount(5);
  await expect(select.locator('optgroup').first()).toHaveAttribute('label',chinese?'变革科技':'Transformative Technologies');
  nodes.push({id:'fusion',parentId:'environment-resources',names:{en:'Fusion Energy','zh-CN':'聚变能源'},order:20,status:'PUBLISHED'});
  await family.selectOption('environment-resources');
  await page.clock.fastForward(61_000);
  await expect(select.locator('option[value=fusion]')).toHaveText(chinese?'聚变能源':'Fusion Energy');
  await select.selectOption('fusion');await expect(select).toHaveValue('fusion');
  failed=true;await page.clock.fastForward(61_000);
  await expect(select).toHaveValue('fusion');expect(reads).toBeGreaterThanOrEqual(3);
  await family.selectOption('transformative-technologies');
  await select.selectOption('robotics');await expect(select).toHaveValue('robotics');
  await family.selectOption('health-healthcare');await expect(select).toHaveValue('biotechnology');
});
