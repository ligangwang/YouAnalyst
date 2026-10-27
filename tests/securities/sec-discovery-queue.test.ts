import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSecDiscoveryTask,publishSecDiscoveryTasks,processSecDiscoveryTask,updateSecDiscoveryFreshness} from '../../src/lib/sec-filings/discovery-queue';
import {acquireSecDiscoveryCompanyLease,releaseSecDiscoveryCompanyLease} from '../../src/lib/sec-collector-state';
import {earningsFirestore} from '../helpers/earnings-firestore';
import {discoverSecCompany} from '../../src/lib/sec-filings/discovery';
import {secBudget} from '../../src/lib/sec-budget';
import {restoreEarningsFixtures} from '../../src/lib/earnings/issuers';
import {withThemeCatalog} from '../helpers/theme-catalog';
const at='2026-10-23T12:00:00.000Z',now=()=>Date.parse(at);
const task={version:1 as const,type:'sec.company.discovery.requested' as const,batchId:'secd_'+'a'.repeat(64),companyId:'US:AMD',requestedAt:at};
test('SEC task accepts one canonical listing only and never accepts caller URLs',()=>{
 assert.deepEqual(parseSecDiscoveryTask({...task,url:'https://evil.invalid'}),task);
 for(const patch of [{companyId:'AMD'},{companyId:'US:AMD,NVDA'},{companyId:'XSHG:688981'},{batchId:'bad'},{requestedAt:'bad'}])assert.throws(()=>parseSecDiscoveryTask({...task,...patch}));
});
test('SEC dispatcher is bounded, retries stable identities, and rotates a truncated scope',async()=>{
 const sent:unknown[]=[],opts={execution:'run',now,deadline:now()+60000,maxCompanies:1};
 const first=await publishSecDiscoveryTasks(['US:NVDA','US:AMD'],async t=>{sent.push(t);},opts);
 assert.equal(first.requested,1);assert.equal(first.deferred,1);assert.equal(first.afterCompanyId,'US:AMD');
 await publishSecDiscoveryTasks(['US:AMD','US:NVDA'],async t=>{assert.deepEqual(t,sent[0]);},opts);
 const next=await publishSecDiscoveryTasks(['US:AMD','US:NVDA'],async t=>{assert.equal(t.companyId,'US:NVDA');},{...opts,after:first.afterCompanyId!});assert.equal(next.requested,1);
 assert.equal((await publishSecDiscoveryTasks(['US:AMD'],async()=>assert.fail(),{...opts,deadline:now()+1000})).deferred,1);
 assert.equal((await publishSecDiscoveryTasks(['US:AMD'],async()=>{throw Error('outage');},opts)).failed,1);
});
test('SEC dispatcher spaces deliveries and retains its rotation checkpoint at the deadline',async()=>{
 let clock=0;const times:number[]=[];
 const result=await publishSecDiscoveryTasks(['US:A','US:B','US:C'],async()=>{times.push(clock);},{execution:'paced',deadline:31500,now:()=>clock,intervalMs:1000,sleep:async ms=>{clock+=ms;}});
 assert.deepEqual(times,[0,1000]);assert.equal(result.requested,2);assert.equal(result.deferred,1);assert.equal(result.afterCompanyId,'US:B');
 await assert.rejects(publishSecDiscoveryTasks(['US:A'],async()=>{},{execution:'bad',deadline:60000,now:()=>0,intervalMs:-1}),/interval/);
});
test('SEC worker rechecks enrollment before source work and cannot run when disabled',async()=>{
 const f=earningsFirestore(),db=withThemeCatalog(f.db);let runs=0;const opts={enabled:true,run:async(ticker:string)=>{assert.equal(ticker,'AMD');runs++;return {status:'verified'};}};
 assert.equal((await processSecDiscoveryTask(task,db,opts)).status,'ineligible');
 f.rows.set('companies/US:AMD',{name:'AMD',status:'PUBLISHED',onboarding:{status:'SUPPORTED'},themeMemberships:{ai:{status:'PUBLISHED',primarySector:'chips'}}});
 assert.equal((await processSecDiscoveryTask(task,db,opts)).status,'verified');assert.equal(runs,1);
 f.rows.get('companies/US:AMD')!.themeMemberships={};
 assert.equal((await processSecDiscoveryTask(task,db,opts)).status,'verified');assert.equal(runs,2);
 f.rows.get('companies/US:AMD')!.onboarding={status:'BLOCKED'};
 assert.equal((await processSecDiscoveryTask(task,db,opts)).status,'ineligible');assert.equal(runs,2);
 await assert.rejects(processSecDiscoveryTask(task,db,{...opts,enabled:false}),/disabled/);
});
test('company fencing excludes duplicate tasks and old global collectors without serializing other companies',async()=>{
 const f=earningsFirestore();
 assert(await acquireSecDiscoveryCompanyLease(f.db,'AMD','a',now()));
 assert.equal(await acquireSecDiscoveryCompanyLease(f.db,'AMD','b',now()),false);
 assert(await acquireSecDiscoveryCompanyLease(f.db,'NVDA','b',now()));
 await releaseSecDiscoveryCompanyLease(f.db,'AMD','wrong');assert.equal(await acquireSecDiscoveryCompanyLease(f.db,'AMD','c',now()),false);
 await releaseSecDiscoveryCompanyLease(f.db,'AMD','a');assert(await acquireSecDiscoveryCompanyLease(f.db,'AMD','c',now()));
 f.rows.set('sec_collector_state/_sec_filings_collector',{leaseExpiresAtMs:now()+60000});
 assert.equal(await acquireSecDiscoveryCompanyLease(f.db,'INTC','d',now()),false);
});
test('queued freshness uses completed coverage of every company, not accepted tasks',async()=>{
 const f=earningsFirestore();f.rows.set('sec_collector_state/_sec_filings_collector',{bridgeRetired:true});
 f.rows.set('sec_collector_state/US:AMD',{secFilingsCollector:{version:1,cik:'0000002488',baselineAt:at,lastCompleteAt:at,nextPollAfterMs:0,scan:null}});
 f.rows.set('collectors/sec-US:AMD',{status:'complete',lastSuccessAt:at});
 await updateSecDiscoveryFreshness(f.db,['US:AMD'],false,now());
 assert.equal((f.rows.get('sec_collector_state/_website_freshness')!.result as {remaining:number}).remaining,0);
 await updateSecDiscoveryFreshness(f.db,['US:AMD','US:NVDA'],false,now());
 assert.equal((f.rows.get('sec_collector_state/_website_freshness')!.result as {remaining:number}).remaining,1);
});
test('live company discovery loads only its issuer snapshot and shares the ticker directory across tasks',async()=>{
 const f=earningsFirestore(),originalFetch=globalThis.fetch,gate=secBudget.run,agent=process.env.SEC_USER_AGENT,earnings=process.env.EARNINGS_COLLECTION_ENABLED;
 const calls:string[]=[];
 for(const [ticker,cik] of [['AMD','0000002488'],['NVDA','0001045810']])f.rows.set(`companies/US:${ticker}`,{name:ticker,cik,status:'PUBLISHED',onboarding:{status:'SUPPORTED'},themeMemberships:{ai:{status:'PUBLISHED',primarySector:'chips'}}});
 f.rows.set('sec_collector_state/_sec_filings_collector',{bridgeRetired:true});
 try{
  process.env.SEC_USER_AGENT='Existing test contact';process.env.EARNINGS_COLLECTION_ENABLED='0';
  secBudget.run=async(_signal,work)=>work(()=>{});
  globalThis.fetch=async input=>{
   const url=String(input);calls.push(url);
   if(url.endsWith('company_tickers_exchange.json'))return new Response(JSON.stringify({fields:['ticker','cik'],data:[['AMD',2488],['NVDA',1045810]]}));
   const cik=url.match(/CIK(\d+)\.json$/)?.[1];assert(cik);
   return new Response(JSON.stringify({cik:Number(cik),filings:{files:[],recent:{form:[],accessionNumber:[],filingDate:[],primaryDocument:[],isXBRL:[]}}}));
  };
  const db=withThemeCatalog(f.db);
  assert.equal((await discoverSecCompany(db,'AMD')).status,'verified');
  assert(!calls.some(url=>url.includes('1045810')),'AMD task must not fetch another company');
  assert.equal((await discoverSecCompany(db,'NVDA')).status,'verified');
  assert.equal(calls.filter(url=>url.endsWith('company_tickers_exchange.json')).length,1);
  assert.equal(calls.filter(url=>url.includes('/submissions/')).length,2,'raw observers and financial scan reuse one snapshot per task');
 }finally{
  globalThis.fetch=originalFetch;secBudget.run=gate;restoreEarningsFixtures();
  if(agent===undefined)delete process.env.SEC_USER_AGENT;else process.env.SEC_USER_AGENT=agent;
  if(earnings===undefined)delete process.env.EARNINGS_COLLECTION_ENABLED;else process.env.EARNINGS_COLLECTION_ENABLED=earnings;
 }
});
