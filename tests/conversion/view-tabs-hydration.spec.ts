import { test, expect } from '@playwright/test';
import { componentFixtureHtml } from './fixtures/component-html';

test('view tabs wait for the responsive layout before accepting the first click', async ({ page }) => {
  const html=await componentFixtureHtml(`
    import React,{useState,useSyncExternalStore} from 'react';
    import {renderToString} from 'react-dom/server';
    import {hydrateRoot} from 'react-dom/client';
    import {LocaleProvider} from './src/components/providers/locale-provider';
    import {IntelligenceViewTabs} from './src/components/intelligence-view-tabs';
    const subscribe=()=>()=>{};
    function App(){
      const wide=useSyncExternalStore(subscribe,()=>innerWidth>=1440,()=>true);
      const [view,setView]=useState('table');
      return <LocaleProvider locale="en"><div style={{marginLeft:wide?272:200}}>
        <IntelligenceViewTabs view={view} onChange={setView} id="views"/>
      </div></LocaleProvider>;
    }
    const root=document.getElementById('root');
    root.innerHTML=renderToString(<App/>);
    window.startHydration=()=>hydrateRoot(root,<App/>);
  `,{jsx:'automatic'});
  await page.setViewportSize({width:1280,height:720});
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto('http://view-tabs.test');
  const graph=page.getByRole('tab',{name:'Relationship graph',exact:true});
  await expect(graph).toBeDisabled();
  await page.evaluate(()=> (window as unknown as {startHydration:()=>void}).startHydration());
  await expect(graph).toBeEnabled();
  expect((await graph.boundingBox())!.x).toBe(208);
  await graph.click();
  await expect(graph).toHaveAttribute('aria-selected','true');
});
