import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pubsubFirestore} from '../helpers/pubsub-firestore';
import {queueFundamentalsSeeding,processSeedMessage,type SeedMessage} from '../../src/lib/fundamentals/seed-queue';
import type {CompanyWorkRequest} from '../../src/lib/company-work-queue';

test('coverage and fetch/cap dispatch wait for every queued seed; failed seeds retry without duplicate receipts',async()=>{
  const f=pubsubFirestore(),messages:SeedMessage[]=[],seeded:string[]=[],audits:string[][]=[];
  Object.assign(f.db,{getAll:(...refs:FirebaseFirestore.DocumentReference[])=>Promise.all(refs.map(ref=>ref.get()))});
  const publish=async(message:SeedMessage)=>{messages.push(message);};
  const a=await queueFundamentalsSeeding(f.db,'execution',['US:AMD','US:MSFT'],'unused',false,publish);
  assert.equal((await queueFundamentalsSeeding(f.db,'execution',['US:MSFT','US:AMD'],'unused',false,publish)).batchId,a.batchId);
  let fail=true,dispatches=0,caps=0;
  const deps={seed:async(ticker:string)=>{if(ticker==='MSFT'&&fail)throw Error('seed failure');seeded.push(ticker);return null;},
    audit:async(_db:unknown,tickers:string[])=>{audits.push(tickers);return {companies:2,cached:0,pending:2,unavailable:0,missing:[]};},
    dispatch:async()=>{dispatches++;return {requested:2,batches:2,mode:'pubsub'};},
    caps:async()=>{caps++;return {queued:true,requested:2,batchId:'caps'};},
  };
  const deliver=(message:SeedMessage)=>processSeedMessage(message,f.db,f.log,publish,deps);
  await deliver(messages[0]);
  const tasks=messages.filter((m):m is CompanyWorkRequest=>m.type==='company.work.requested');
  await deliver(tasks[0]);await assert.rejects(deliver(tasks[1]),/seed failure/);
  await deliver(messages[0]);assert.equal(audits.length,0);assert.equal(dispatches,0);assert.equal(caps,0);
  fail=false;await deliver(tasks[1]);await deliver(tasks[1]);await deliver(messages[0]);
  assert.deepEqual(seeded,['AMD','MSFT']);assert.deepEqual(audits,[['AMD','MSFT']]);assert.equal(dispatches,1);assert.equal(caps,1);
  assert.equal(f.rows.get(`company_fundamentals/_seed_${a.batchId}`)?.completed,true);
});

test('seed-only audits coverage but does not dispatch financial fetches or market caps',async()=>{
  const f=pubsubFirestore(),messages:SeedMessage[]=[];
  Object.assign(f.db,{getAll:(...refs:FirebaseFirestore.DocumentReference[])=>Promise.all(refs.map(ref=>ref.get()))});
  const publish=async(message:SeedMessage)=>{messages.push(message);};
  await queueFundamentalsSeeding(f.db,'seed-only',['US:AMD'],'unused',true,publish);
  let audits=0;
  const deps={seed:async()=>null,audit:async()=>{audits++;return {companies:1,cached:0,pending:1,unavailable:0,missing:[]};},dispatch:async()=>{throw Error('unexpected fetch dispatch');},caps:async()=>{throw Error('unexpected caps');}};
  await processSeedMessage(messages[0],f.db,f.log,publish,deps);
  await processSeedMessage(messages.find(m=>m.type==='company.work.requested')!,f.db,f.log,publish,deps);
  await processSeedMessage(messages[0],f.db,f.log,publish,deps);assert.equal(audits,1);
});

test('snapshot instrument updates are isolated company tasks, including private companies',async()=>{
  const f=pubsubFirestore(),messages:SeedMessage[]=[],synced:string[]=[];
  Object.assign(f.db,{getAll:(...refs:FirebaseFirestore.DocumentReference[])=>Promise.all(refs.map(ref=>ref.get()))});
  f.rows.set('companies/ORG:OPENAI',{name:'OpenAI',listingStatus:'PRIVATE'});
  f.rows.set('companies/US:AMD',{name:'AMD'});
  const publish=async(message:SeedMessage)=>{messages.push(message);};
  await queueFundamentalsSeeding(f.db,'snapshots',['US:AMD','ORG:OPENAI'],'unused','instruments',publish);
  const deps={instrument:async(_db:unknown,id:string)=>{synced.push(id);return {changed:false};}};
  await processSeedMessage(messages[0],f.db,f.log,publish,deps);
  for(const task of messages.filter(m=>m.type==='company.work.requested'))await processSeedMessage(task,f.db,f.log,publish,deps);
  await processSeedMessage(messages[0],f.db,f.log,publish,deps);
  assert.deepEqual(synced,['ORG:OPENAI','US:AMD']);
});
