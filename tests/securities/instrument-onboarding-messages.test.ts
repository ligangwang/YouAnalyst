import assert from 'node:assert/strict';
import test from 'node:test';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {onboardingFixture} from '../helpers/instrument-onboarding';
import {drainInstrumentOnboarding} from '../../src/lib/instrument-onboarding/worker';
import {inspectOnboardingDelivery,processInstrumentOnboarding,retryInstrumentOnboarding,wakeInstrumentOnboarding} from '../../src/lib/instrument-onboarding/queue';
import {onboardingLeaseOwner} from '../../src/lib/instrument-onboarding/delivery-lease';
import {instrumentId} from '../../src/lib/instruments/model';
import {ONBOARDING_STEPS} from '../../src/lib/instrument-onboarding/model';
import {createOnboardingSubscriber,onboardingEventId} from '../../src/lib/instrument-onboarding/subscriber';
import {onboardingDeliveryProbeId,verifyOnboardingDelivery} from '../../src/lib/instrument-onboarding/delivery-check';

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
  assert.equal(first.status,'YIELDED');assert.deepEqual(f.request().steps,{identity:'COMPLETE'});
  assert.equal(f.request().status,'QUEUED');assert.equal(f.request().leaseOwner,null);
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

test('rollout probe refuses existing work and stale revisions before sending a provider-free message',async()=>{
  const sha='a'.repeat(40),calls:string[]=[];let exists=false,healthSha=sha;
  const input={url:'https://onboarding.example.run.app',project:'test',sha,exists:async()=>exists,
    send:async(url:string,headers?:Record<string,string>,body?:Uint8Array)=>{calls.push(url);if(headers){assert.match(headers['ce-subject'],/^documents\/instrument_onboarding_requests\/INS_[a-f0-9]{32}$/);return {status:204,data:null,disposition:body?'claim_event':undefined};}return {status:200,data:{sha:healthSha}};}};
  assert.equal((await verifyOnboardingDelivery(input)).providerCalls,0);assert.equal(calls.length,3);
  exists=true;calls.length=0;await assert.rejects(()=>verifyOnboardingDelivery(input),/unexpectedly exists/);assert.equal(calls.length,0);
  exists=false;healthSha='b'.repeat(40);await assert.rejects(()=>verifyOnboardingDelivery(input),/reviewed revision/);assert.equal(calls.length,1);
  healthSha=sha;await assert.rejects(()=>verifyOnboardingDelivery({...input,send:async(url,headers,body)=>({...await input.send(url,headers,body),disposition:undefined})}),/protobuf filter/);
});

test('busy worker serves health and a safe probe without processing another stock',async()=>{
 const f=onboardingFixture(),sha='a'.repeat(40);let started!:()=>void,release!:()=>void,calls=0,absent=true;
 const entered=new Promise<void>(resolve=>{started=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
 const server=createOnboardingSubscriber({project:'test',sha,probe:async()=>absent,admit:async()=>calls?'retry':'ready',process:async()=>{calls++;started();await hold;return {status:'SUPPORTED'};}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const headers={'ce-type':'google.cloud.firestore.document.v1.written','ce-source':'//firestore.googleapis.com/projects/test/databases/(default)','ce-specversion':'1.0','ce-id':'event-1','ce-subject':`documents/instrument_onboarding_requests/${f.id}`};
 try{
  const first=fetch(url+'/events',{method:'POST',headers});await entered;
  assert.equal((await fetch(url+'/health')).status,200);
  const duplicate=fetch(url+'/events',{method:'POST',headers});assert.equal(calls,1);
  const probe={...headers,'ce-id':'delivery-check-'+sha,'ce-subject':`documents/instrument_onboarding_requests/${onboardingDeliveryProbeId(sha)}`};
  assert.equal((await fetch(url+'/events',{method:'POST',headers:probe})).status,204);assert.equal(calls,1);
  absent=false;assert.equal((await fetch(url+'/events',{method:'POST',headers:probe})).status,503);assert.equal(calls,1);
  release();assert.equal((await first).status,204);assert.equal((await duplicate).status,204);assert.equal(calls,1);
 }finally{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('one delivery retains its fenced lease and publishes no intermediate QUEUED checkpoints',async()=>{
  const f=onboardingFixture();await f.enqueue();
  await drainInstrumentOnboarding(f.db,f.id,f.handlers,{clock:f.clock,eventId:'original-event'});
  assert.equal(f.states[0].status,'QUEUED');assert.equal(f.states.at(-1)!.status,'SUPPORTED');
  const intermediate=f.states.slice(1,-1);
  assert(intermediate.length>=ONBOARDING_STEPS.length);
  assert(intermediate.every(row=>row.status==='PROCESSING'));
  assert.equal(new Set(intermediate.map(row=>row.leaseOwner)).size,1);
});

test('acknowledges other deliveries without discarding the owning event retry after a crash',async()=>{
  const f=onboardingFixture();await f.enqueue();const owner=onboardingLeaseOwner('original-event');
  await processInstrumentOnboarding(f.db,f.id,f.handlers,f.clock,{leaseOwner:owner,retainLease:true,eventId:'original-event'});
  assert.equal(await inspectOnboardingDelivery(f.db,f.id,'checkpoint-event',f.clock()),'duplicate');
  assert.equal(await inspectOnboardingDelivery(f.db,f.id,'original-event',f.clock()),'retry');
  assert.equal((await drainInstrumentOnboarding(f.db,f.id,f.handlers,{clock:f.clock,eventId:'checkpoint-event'})).status,'IN_FLIGHT');
  assert.equal((await drainInstrumentOnboarding(f.db,f.id,f.handlers,{clock:f.clock,eventId:'original-event'})).status,'CONTINUE');
  assert.deepEqual(f.calls,['identity']);
  f.advance(21*60_000);
  assert.equal((await drainInstrumentOnboarding(f.db,f.id,f.handlers,{clock:f.clock,eventId:'original-event'})).status,'BLOCKED');
  assert.deepEqual(f.calls,['identity']);
});

test('full work slots preserve probe capacity and defer excess deliveries without provider calls',async()=>{
  const f=onboardingFixture(),sha='a'.repeat(40);let entered!:()=>void,release!:()=>void,queued!:()=>void,calls=0;
  const started=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;}),secondSeen=new Promise<void>(resolve=>{queued=resolve;});
  const server=createOnboardingSubscriber({project:'test',sha,probe:async()=>true,admit:async(_id,event)=>{if(event==='second')queued();return 'ready';},process:async()=>{calls++;if(calls===1){entered();await hold;}return {status:'SUPPORTED'};}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers={'ce-type':'google.cloud.firestore.document.v1.written','ce-source':'//firestore.googleapis.com/projects/test/databases/(default)','ce-specversion':'1.0','ce-id':'first','ce-subject':`documents/instrument_onboarding_requests/${f.id}`};
  try{
    const first=fetch(url+'/events',{method:'POST',headers});await started;
    const second=fetch(url+'/events',{method:'POST',headers:{...headers,'ce-id':'second'}});await secondSeen;await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await fetch(url+'/events',{method:'POST',headers:{...headers,'ce-id':'third'}})).status,503);
    assert.equal((await fetch(url+'/events',{method:'POST',headers})).status,503);assert.equal(calls,1);
    assert.equal((await fetch(url+'/health')).status,200);
    assert.equal((await fetch(url+'/events',{method:'POST',headers:{...headers,'ce-id':'delivery-check-'+sha,'ce-subject':`documents/instrument_onboarding_requests/${onboardingDeliveryProbeId(sha)}`}})).status,204);
    const claim=JSON.stringify({value:{name:`projects/test/databases/(default)/documents/instrument_onboarding_requests/${f.id}`,fields:{status:{stringValue:'PROCESSING'}}}});
    assert.equal((await fetch(url+'/events',{method:'POST',headers:{...headers,'content-type':'application/json'},body:claim})).status,204);assert.equal(calls,1);
    release();assert.equal((await first).status,204);assert.equal((await second).status,204);assert.equal(calls,2);
    assert.equal((await fetch(url+'/events',{method:'POST',headers:{...headers,'ce-id':'third'}})).status,204);assert.equal(calls,3);
  }finally{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('terminal delivery inspection never occupies a provider slot',async()=>{
  const f=onboardingFixture();await f.enqueue();
  for(const state of ['SUPPORTED','BLOCKED']){f.request().status=state;assert.equal(await inspectOnboardingDelivery(f.db,f.id,'old-event',f.clock()),'terminal');}
  assert.deepEqual(f.calls,[]);
});

test('issuer exclusion starts before retaining identity and never strands another listing lease',async()=>{
  const f=onboardingFixture();f.rows.set('companies/US:ALT',{name:'Other class',status:'DIRECTORY',cik:'123',supersededByCompanyId:'US:NEW'});
  await f.enqueue();await f.enqueue('US:ALT');const second=instrumentId('US:ALT');
  let entered!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const first=drainInstrumentOnboarding(f.db,f.id,{...f.handlers,identity:async()=>{f.calls.push('identity');entered();await hold;}},{clock:f.clock,eventId:'issuer-owner'});
  try{
    await started;
    assert.equal((await drainInstrumentOnboarding(f.db,second,f.handlers,{clock:f.clock,eventId:'other-listing'})).status,'CONTINUE');
    assert.equal(f.request(second).status,'QUEUED');assert.equal(f.request(second).leaseOwner,null);
    release();assert.equal((await first).status,'SUPPORTED');
    assert.equal((await drainInstrumentOnboarding(f.db,second,f.handlers,{clock:f.clock,eventId:'other-listing'})).status,'SUPPORTED');
    assert.equal(f.calls.filter(step=>step==='themes').length,1);
  }finally{release();await first;}
});

test('distinct ready deliveries queue locally without busy 503 responses or concurrent provider work',async()=>{
  const f=onboardingFixture();let entered!:()=>void,release!:()=>void,active=0,peak=0,calls=0;
  const started=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const server=createOnboardingSubscriber({project:'test',process:async()=>{calls++;active++;peak=Math.max(peak,active);if(calls===1){entered();await hold;}active--;return {status:'SUPPORTED'};}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/events`;
  const headers={'ce-type':'google.cloud.firestore.document.v1.written','ce-source':'//firestore.googleapis.com/projects/test/databases/(default)','ce-specversion':'1.0','ce-id':'first','ce-subject':`documents/instrument_onboarding_requests/${f.id}`};
  try{
    const first=fetch(url,{method:'POST',headers});await started;
    const second=fetch(url,{method:'POST',headers:{...headers,'ce-id':'second'}});
    release();assert.equal((await first).status,204);assert.equal((await second).status,204);
    assert.equal(calls,2);assert.equal(peak,1);
  }finally{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

for(const status of ['SUPPORTED','BLOCKED'] as const)test(`terminal ${status} delivery reuses its claim read without a second lookup`,async()=>{
  const f=onboardingFixture();await f.enqueue();f.request().status=status;f.reads.length=0;
  const result=await drainInstrumentOnboarding(f.db,f.id,f.handlers,{clock:f.clock});
  assert.equal(result.status,status);assert.equal('statusRead' in result&&result.statusRead,'claim_transaction');
  assert.deepEqual(f.reads,[`transaction:instrument_onboarding_requests/${f.id}`]);assert.deepEqual(f.calls,[]);
  // A later explicit requeue must be read afresh and processed, not memoized.
  f.request().status='QUEUED';
  assert.equal((await drainInstrumentOnboarding(f.db,f.id,f.handlers,{clock:f.clock})).status,'SUPPORTED');
  assert.deepEqual(f.calls,ONBOARDING_STEPS);
});
