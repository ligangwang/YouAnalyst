import assert from 'node:assert/strict';
import test from 'node:test';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {onboardingFixture} from '../helpers/instrument-onboarding';
import {drainInstrumentOnboarding} from '../../src/lib/instrument-onboarding/worker';
import {retryInstrumentOnboarding,wakeInstrumentOnboarding} from '../../src/lib/instrument-onboarding/queue';
import {ONBOARDING_STEPS} from '../../src/lib/instrument-onboarding/model';
import {createOnboardingSubscriber,onboardingEventId} from '../../src/lib/instrument-onboarding/subscriber';

test('one message advances consecutive checkpoints; duplicate delivery never repeats completed work',async()=>{
  const f=onboardingFixture();await f.enqueue();
  assert.equal((await drainInstrumentOnboarding(f.db,f.id,f.handlers,{clock:f.clock})).status,'SUPPORTED');
  assert.deepEqual(f.calls,ONBOARDING_STEPS);
  assert.equal((await drainInstrumentOnboarding(f.db,f.id,f.handlers,{clock:f.clock})).status,'SUPPORTED');
  assert.deepEqual(f.calls,ONBOARDING_STEPS);
});

test('budget continuation resumes the next unfinished checkpoint without polling',async()=>{
  const f=onboardingFixture();await f.enqueue();
  const first=await drainInstrumentOnboarding(f.db,f.id,{...f.handlers,identity:async()=>{f.calls.push('identity');f.advance(1000);}},{clock:f.clock,budgetMs:500});
  assert.equal(first.status,'CONTINUE');assert.deepEqual(f.request().steps,{identity:'COMPLETE'});
  assert.equal((await drainInstrumentOnboarding(f.db,f.id,f.handlers,{clock:f.clock})).status,'SUPPORTED');
  assert.deepEqual(f.calls,ONBOARDING_STEPS);
});

test('provider errors stop immediately, including redelivery and legacy queued failures; admin retry preserves checkpoints',async()=>{
  const f=onboardingFixture();await f.enqueue();let calls=0;
  const handlers={...f.handlers,themes:async()=>{calls++;throw Error('HTTP 500');}};
  assert.equal((await drainInstrumentOnboarding(f.db,f.id,handlers,{clock:f.clock})).status,'INCOMPLETE');
  assert.equal(f.request().status,'BLOCKED');assert.equal(f.request().nextAttemptAt,0);
  f.advance(24*3600_000);
  await drainInstrumentOnboarding(f.db,f.id,handlers,{clock:f.clock});assert.equal(calls,1);
  f.request().status='QUEUED'; // Pre-rollout retryable failure must not start another call.
  await drainInstrumentOnboarding(f.db,f.id,handlers,{clock:f.clock});assert.equal(calls,1);assert.equal(f.request().status,'BLOCKED');
  await retryInstrumentOnboarding(f.db,f.id,{step:'themes',updatedAt:String(f.request().updatedAt)},f.clock());
  await drainInstrumentOnboarding(f.db,f.id,f.handlers,{clock:f.clock});
  assert.equal(f.request().status,'SUPPORTED');assert.equal(f.calls.filter(x=>x==='identity').length,1);
});

test('an interrupted expired lease blocks ambiguous work instead of repeating a provider call',async()=>{
  const f=onboardingFixture();await f.enqueue();await f.process();
  Object.assign(f.request(),{status:'PROCESSING',leaseOwner:'crashed-worker',leaseExpiresAt:f.clock()-1});
  assert.equal((await drainInstrumentOnboarding(f.db,f.id,f.handlers,{clock:f.clock})).status,'BLOCKED');
  assert.deepEqual(f.calls,['identity']);assert.match(String(f.request().lastError),/interrupted/);
});

test('explicit migration wake touches only ready queued requests, retaining completed steps',async()=>{
  const f=onboardingFixture();await f.enqueue();await f.process();
  const saved=structuredClone(f.request());
  assert(await wakeInstrumentOnboarding(f.db,f.id,f.clock()));
  assert.deepEqual({...f.request(),updatedAt:saved.updatedAt},saved);
  assert.notEqual(f.request().updatedAt,saved.updatedAt);
  for(const patch of [{status:'BLOCKED'},{status:'PROCESSING'},{status:'SUPPORTED'},{status:'QUEUED',lastError:'themes: failed'},{status:'QUEUED',lastError:null,leaseExpiresAt:f.clock()+1000}]){
    Object.assign(f.request(),patch);const before=structuredClone(f.request());
    assert.equal(await wakeInstrumentOnboarding(f.db,f.id,f.clock()),false);assert.deepEqual(f.request(),before);
  }
});

test('active leases defer message delivery without taking over another worker',async()=>{
  const f=onboardingFixture();await f.enqueue();let release!:()=>void,entered!:()=>void;
  const start=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const work=f.process({...f.handlers,identity:async()=>{entered();await hold;}});await start;
  assert.equal((await drainInstrumentOnboarding(f.db,f.id,f.handlers,{clock:f.clock})).status,'CONTINUE');
  release();await work;assert.deepEqual(f.request().steps,{identity:'COMPLETE'});
});

test('private subscriber restricts document routing and acknowledges failed checkpoints',async()=>{
  const f=onboardingFixture(),headers={'ce-type':'google.cloud.firestore.document.v1.written','ce-source':'//firestore.googleapis.com/projects/test/databases/(default)','ce-specversion':'1.0','ce-id':'event-1','ce-subject':`documents/instrument_onboarding_requests/${f.id}`};
  assert.equal(onboardingEventId(headers,'test'),f.id);
  for(const change of [{'ce-source':'//firestore.googleapis.com/projects/other/databases/(default)'},{'ce-subject':headers['ce-subject']+'/requesters/user'},{'ce-type':'other'}])assert.throws(()=>onboardingEventId({...headers,...change},'test'));
  let calls=0,status='INCOMPLETE';
  const server=createOnboardingSubscriber({project:'test',process:async id=>{calls++;assert.equal(id,f.id);return {status};}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try{
    assert.equal((await fetch(url+'/events',{method:'POST',body:'bad'})).status,400);assert.equal(calls,0);
    assert.equal((await fetch(url+'/events',{method:'POST',headers,body:Buffer.from([1,2,3])})).status,204);
    status='CONTINUE';assert.equal((await fetch(url+'/events',{method:'POST',headers,body:''})).status,503);
    status='BLOCKED';assert.equal((await fetch(url+'/events',{method:'POST',headers,body:''})).status,204);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
