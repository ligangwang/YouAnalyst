import {test,expect} from '@playwright/test';
import {componentFixtureHtml} from './fixtures/component-html';
import type {NameResolutionReceipt} from '../../src/lib/market-companies/name-resolution';
const receipt:NameResolutionReceipt={id:'news_analysis_'+'a'.repeat(64),sourceEventId:'company_news_'+'b'.repeat(64),title:'Arista and AMD announce networking partnership',sourceUrl:'https://investors.arista.com/news/partnership',contentHash:'c'.repeat(64),relationships:[{sourceId:'',targetId:'US:AMD',sourceName:'Arista Networks',targetName:'AMD',type:'PARTNER_OF',state:'ANNOUNCED',summaryEn:'A planned networking partnership.',summaryZh:'计划开展网络合作。',evidence:'Arista Networks and AMD announced a partnership to develop Ethernet networking for AI systems.',product:'Networking',eventDate:null,confidence:.9}],proposals:[]};
let html:string;
test.beforeAll(async()=>{
 html=await componentFixtureHtml(`import React from 'react';import {createRoot} from 'react-dom/client';import {EventCompanyNameResolution} from './src/components/company-name-resolution';createRoot(document.getElementById('root')).render(<main style={{maxWidth:380,margin:'16px auto',padding:12}}><EventCompanyNameResolution eventId="news-${receipt.sourceEventId}"/></main>);`,{jsx:'automatic',plugins:[{name:'identity-providers',setup(build){
  build.onResolve({filter:/(auth-provider|locale-provider)$/},args=>({path:args.path.split('/').at(-1)!,namespace:'identity-mock'}));
  build.onLoad({filter:/.*/,namespace:'identity-mock'},args=>({loader:'tsx',contents:args.path==='auth-provider'?`const user=new URLSearchParams(location.search).has('signedout')?null:{uid:'fixture-user'};const getIdToken=async()=>user?'fixture-token':null;export function useAuth(){return {user,getIdToken}}`:`export function useLocale(){const chinese=new URLSearchParams(location.search).get('lang')==='zh-CN';return {locale:chinese?'zh-CN':'en',chinese,text:(en,zh)=>chinese?zh:en}}`}));
 }}]},'body{margin:0;font-family:Arial;background:#fff;--ui-text:#142c3c;--ui-surface:#fff;--ui-line:#bacbd8;--ui-link:#006c8a}*{box-sizing:border-box}button,input{font:inherit}');
});
for(const chinese of [false,true])for(const admin of [false,true])test(`${chinese?'Chinese':'English'} ${admin?'admin alias approval':'user article proposal'} preserves explicit review scope`,async({page})=>{
 const posts:Record<string,unknown>[]=[];
 const current=structuredClone(receipt);
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/company-name-resolution'){
   expect(request.headers().authorization).toBe('Bearer fixture-token');
   if(request.method()==='POST'){
    const body=request.postDataJSON();posts.push(body);
    if(admin){current.relationships[0].sourceId='US:ANET';}else{current.proposals=[{id:'d'.repeat(64),relationshipIndex:0,side:'source',name:'Arista Networks',companyId:'US:ANET',proposedBy:'fixture-user',proposedAt:'2026-10-13T12:00:00Z',status:'PENDING'}];}
    return route.fulfill({json:{status:admin?'APPROVED':'PENDING'}});
   }
   if(url.searchParams.has('q'))return route.fulfill({json:{items:[{id:'US:ANET',name:'Arista',legalName:'Arista Networks',country:'US',website:'https://www.arista.com/',symbol:'ANET',exchange:'NASDAQ',aliases:[]}],admin}});
   return route.fulfill({json:{receipt:current,admin}});
  }
  if(request.isNavigationRequest())return route.fulfill({contentType:'text/html',body:html});
  return route.fulfill({status:404,body:''});
 });
 await page.goto('https://fixture.test/?lang='+(chinese?'zh-CN':'en'));
 await page.getByRole('button',{name:chinese?'审核公司名称':'Review company names',exact:true}).click();
 await expect(page.getByText(chinese?'请选择同一法律实体。母公司与子公司应保持独立身份。':'Choose the same legal entity. A parent company and its subsidiary are separate identities.')).toBeVisible();
 await page.getByRole('button',{name:chinese?'搜索公司库':'Search directory'}).click();
 const choice=page.getByRole('button',{name:/Arista Networks.*NASDAQ.*US/});await choice.click();await expect(choice).toHaveAttribute('aria-pressed','true');
 if(admin){
  await page.getByRole('checkbox',{name:chinese?'将此名称批准为同一实体的可复用别名':'Approve this name as a reusable alias for the same entity'}).check();
  const confirm=page.getByRole('button',{name:chinese?'确认本文匹配':'Confirm article match'});await expect(confirm).toBeDisabled();
  await page.getByLabel(chinese?'官方依据网址':'Official evidence URL').fill('https://www.arista.com/company');
  await page.screenshot({path:`output/name-resolution-${chinese?'zh':'en'}-${test.info().project.name}.png`,fullPage:true});
  await confirm.click();
  await expect.poll(()=>posts.length).toBe(1);expect(posts[0]).toMatchObject({action:'approve',reusableAlias:true,evidenceUrl:'https://www.arista.com/company'});
  await expect(page.getByText(chinese?'本文身份已匹配':'Article identities matched',{exact:false})).toBeVisible();
 }else{
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button',{name:chinese?'提交匹配供审核':'Submit match for review'}).click();
  await expect.poll(()=>posts.length).toBe(1);expect(posts[0].action).toBe('propose');expect(posts[0].reusableAlias).toBeUndefined();
  await expect(page.getByText(chinese?'等待管理员审核。':'Awaiting administrator review.',{exact:true})).toBeVisible();
 }
 expect(posts[0]).toMatchObject({receiptId:receipt.id,contentHash:receipt.contentHash,relationshipIndex:0,side:'source',expectedName:'Arista Networks',companyId:'US:ANET'});
 await expect(page.getByRole('link',{name:/US:ANET/})).toHaveAttribute('href',`/${chinese?'zh-cn':'en'}/company/arista-networks`);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('signed-out visitors receive a login link without reading private proposals',async({page})=>{
 let calls=0;await page.route('**/*',route=>{if(route.request().url().includes('/api/company-name-resolution')){calls++;return route.fulfill({status:401});}return route.fulfill({contentType:'text/html',body:html});});
 await page.goto('https://fixture.test/?signedout=1');await expect(page.getByRole('link',{name:'Sign in to help resolve company names'})).toHaveAttribute('href','/auth');expect(calls).toBe(0);
});
