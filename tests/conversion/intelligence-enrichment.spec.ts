import {expect,test} from '@playwright/test';
import {componentFixtureHtml} from './fixtures/component-html';
let html:string;
test.beforeAll(async()=>{
 html=await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {useIntelligenceEnrichment} from './src/components/use-intelligence-enrichment';import {IntelligenceEventDemand} from './src/components/intelligence-event-demand';import {LocaleProvider} from './src/components/providers/locale-provider';
 const event=id=>({id,origin:'US:AMD',companyIds:['US:AMD'],edgeIds:[],category:'BUSINESS',title:id,summary:'',published_at:null,publication_date:'2026-10-02',eventDate:null,planned:false,evidence:[],calendarPending:true});
 function App(){const [revision,refresh]=React.useState(0),[clicks,click]=React.useState(0);const base=React.useMemo(()=>({theme:'ai',events:[event('visible'),event('offscreen')],graph:{nodes:[{id:'US:AMD',kind:'COMPANY',order:0}],relationships:[],sources:[]},generatedAt:revision?'2026-10-02T17:00:00Z':'2026-10-02T16:00:00Z',graphVersion:'one',enrichmentDeferred:true}),[revision]);const data=useIntelligenceEnrichment(base);return <><button onClick={()=>click(clicks+1)}>Interact {clicks}</button><button onClick={()=>refresh(revision+1)}>Refresh</button><output>{data.snapshot.graph.nodes[0].dailyPrice?.close??'no price'}</output>{data.snapshot.events.map((event,i)=><React.Fragment key={event.id}>{i>0&&<div style={{height:3000}}/>}<IntelligenceEventDemand event={event} request={data.request} pending={data.pending('prices',event.id)||event.calendarPending} failed={data.failed(event.id)} className='row'><h2>{event.id}</h2></IntelligenceEventDemand></React.Fragment>)}</>;}createRoot(document.getElementById('root')).render(<LocaleProvider locale='en'><App/></LocaleProvider>);`);
});
test('visible-only demand keeps prices and interactions independent of stalled calendar requests',async({page})=>{
 const calls:Array<{kind:string;eventIds:string[];snapshotAt:string}>=[];let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/*',async route=>{
  if(!route.request().url().includes('/api/'))return route.fulfill({contentType:'text/html',body:html});
  const body=route.request().postDataJSON();calls.push(body);
  if(body.kind==='calendar'){await held;return route.fulfill({json:{snapshotAt:body.snapshotAt,calendar:Object.fromEntries(body.eventIds.map((id:string)=>[id,[]]))}});}
  return route.fulfill({json:{snapshotAt:body.snapshotAt,prices:{'US:AMD':{close:123}},eventReturns:{}}});
 });
 try{
  await page.goto('http://demand.test');await expect(page.locator('output')).toHaveText('123');
  expect(calls.map(call=>[call.kind,call.eventIds])).toEqual([['calendar',['visible']],['prices',['visible']]]);
  await page.getByRole('button',{name:'Interact 0'}).click();await expect(page.getByRole('button',{name:'Interact 1'})).toBeVisible();
  await page.getByRole('heading',{name:'offscreen',exact:true}).scrollIntoViewIfNeeded();
  await expect.poll(()=>calls.filter(call=>call.kind==='prices').length).toBe(2);
  expect(calls.filter(call=>call.kind==='prices')[1].eventIds).toEqual(['offscreen']);
  release();await expect.poll(()=>calls.filter(call=>call.kind==='calendar').length).toBe(2);
  await expect(page.locator('small[role="status"]')).toHaveCount(0);
  await page.getByRole('heading',{name:'visible',exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading',{name:'visible',exact:true})).toBeVisible();expect(calls).toHaveLength(4);
 }finally{release();}
});
test('refresh ignores old in-flight enrichment and failures require explicit retry',async({page})=>{
 let oldRelease!:()=>void;const oldHeld=new Promise<void>(resolve=>{oldRelease=resolve;});let failures=0;
 await page.route('**/*',async route=>{
  if(!route.request().url().includes('/api/'))return route.fulfill({contentType:'text/html',body:html});
  const body=route.request().postDataJSON();
  if(body.snapshotAt.includes('T16:')){await oldHeld;return route.fulfill({json:{snapshotAt:body.snapshotAt,prices:{'US:AMD':{close:999}}}}).catch(()=>{});}
  if(body.kind==='prices'&&failures++===0)return route.fulfill({status:503,json:{error:'unavailable'}});
  return route.fulfill({json:{snapshotAt:body.snapshotAt,calendar:{visible:[]},prices:body.kind==='prices'?{'US:AMD':{close:123}}:undefined}});
 });
 try{
  await page.goto('http://demand.test');await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry details'})).toBeVisible();expect(failures).toBe(1);
  oldRelease();await page.getByRole('button',{name:'Retry details'}).click();
  await expect(page.locator('output')).toHaveText('123');expect(failures).toBe(2);
 }finally{oldRelease();}
});
