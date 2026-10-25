import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {ONBOARDING_COLLECTION,ONBOARDING_STEPS,ONBOARDING_START,OnboardingBlocked,createOnboardingRequest,onboardingIdentity} from '../../src/lib/company-onboarding/model';
import {requestCompanyOnboarding,processCompanyOnboarding,resumeCompanyOnboarding,type OnboardingHandlers} from '../../src/lib/company-onboarding/queue';
import {onboardingActions,backfillOnboardingActions} from '../../src/lib/company-onboarding/actions';

function fixture(){
  const rows=new Map<string,Record<string,unknown>>([['companies/US:NEW',{name:'New',status:'DIRECTORY',cik:'123'}],['companies/XSHE:000001',{name:'A-share',status:'DIRECTORY'}]]);
  const ref=(path:string)=>({path,id:path.split('/').at(-1),get:async()=>snapshot(path)});
  const snapshot=(path:string)=>({id:path.split('/').at(-1),exists:rows.has(path),data:()=>rows.get(path),get:(key:string)=>rows.get(path)?.[key]});
  let tail=Promise.resolve();
  const db={collection:(name:string)=>({doc:(id:string)=>ref(`${name}/${id}`)}),getAll:async(...refs:{path:string}[])=>refs.map(r=>snapshot(r.path)),
    runTransaction:<T>(work:(tx:unknown)=>Promise<T>)=>{
      const run=tail.then(async()=>{
        const writes:(()=>void)[]=[];
        const value=await work({getAll:async(...refs:{path:string}[])=>refs.map(r=>snapshot(r.path)),
          create:(r:{path:string},data:Record<string,unknown>)=>{assert(!rows.has(r.path));writes.push(()=>rows.set(r.path,data));},
          set:(r:{path:string},data:Record<string,unknown>)=>writes.push(()=>rows.set(r.path,data)),
          update:(r:{path:string},data:Record<string,unknown>)=>writes.push(()=>rows.set(r.path,{...rows.get(r.path),...data})),
        });
        writes.forEach(write=>write());return value;
      });tail=run.then(()=>undefined,()=>undefined);return run;
    }} as unknown as Firestore;
  let now=Date.parse('2026-10-25T12:00:00Z');
  const clock=()=>now;
  const calls:string[]=[];
  const handlers=Object.fromEntries(ONBOARDING_STEPS.map(step=>[step,async()=>{calls.push(step);}])) as unknown as OnboardingHandlers;
  return {db,rows,calls,handlers,clock,advance:(ms:number)=>{now+=ms;},request:()=>rows.get(`${ONBOARDING_COLLECTION}/US:NEW`)!};
}

test('eligibility requires matched US CIK and supported A-share listing; requests deduplicate without executing providers',async()=>{
  const f=fixture();
  await Promise.all([requestCompanyOnboarding(f.db,'US:NEW',f.clock()),requestCompanyOnboarding(f.db,'US:NEW',f.clock()+1)]);
  assert.equal(f.rows.size,3);assert.equal(f.request().status,'QUEUED');assert.deepEqual(f.calls,[]);
  const requestedAt=f.request().requestedAt;await requestCompanyOnboarding(f.db,'US:NEW',f.clock()+1000);assert.equal(f.request().requestedAt,requestedAt);
  await requestCompanyOnboarding(f.db,'XSHE:000001',f.clock());
  assert.throws(()=>onboardingIdentity('US:NO-CIK',{name:'No CIK',status:'DIRECTORY'}),/CIK not matched/);
  assert.throws(()=>onboardingIdentity('XBSE:830001',{name:'Unsupported',status:'DIRECTORY'}),/not supported/);
  assert.equal(createOnboardingRequest('US:NEW',{name:'New',status:'DIRECTORY',cik:123},new Date(f.clock())).targetThrough,'2026-10-24');
});

test('each invocation checkpoints one step and final support is published atomically after verification',async()=>{
  const f=fixture();await requestCompanyOnboarding(f.db,'US:NEW',f.clock());
  for(const step of ONBOARDING_STEPS){
    const result=await processCompanyOnboarding(f.db,'US:NEW',f.handlers,f.clock);assert.equal(result.step,step);
    const summary=f.rows.get('companies/US:NEW')!.onboarding as {status:string};
    assert.equal(summary.status,step==='verify'?'SUPPORTED':'PROCESSING');
  }
  assert.deepEqual(f.calls,[...ONBOARDING_STEPS]);assert.equal(f.request().status,'SUPPORTED');
  assert.equal((await processCompanyOnboarding(f.db,'US:NEW',f.handlers,f.clock)).status,'SKIPPED');
});

test('retry preserves completed steps, respects backoff, and blocks only after review or exhausted retries',async()=>{
  const f=fixture();await requestCompanyOnboarding(f.db,'US:NEW',f.clock());
  await processCompanyOnboarding(f.db,'US:NEW',f.handlers,f.clock);
  const bad={...f.handlers,themes:async()=>{throw Error('https://provider.test?api_token=secret');}};
  await processCompanyOnboarding(f.db,'US:NEW',bad,f.clock);
  assert.equal(f.request().status,'QUEUED');assert.equal(f.request().attemptCount,1);
  assert.equal(String(f.request().lastError).includes('secret'),false);
  assert.equal((await processCompanyOnboarding(f.db,'US:NEW',bad,f.clock)).status,'SKIPPED');
  f.advance(60_001);await processCompanyOnboarding(f.db,'US:NEW',f.handlers,f.clock);
  assert.deepEqual(f.calls,['identity','themes']);
  await processCompanyOnboarding(f.db,'US:NEW',{...f.handlers,profile:async()=>{throw new OnboardingBlocked('Reviewed company description is required');}},f.clock);
  assert.equal(f.request().status,'BLOCKED');
  assert.equal((await requestCompanyOnboarding(f.db,'US:NEW',f.clock())).status,'BLOCKED');
  await resumeCompanyOnboarding(f.db,'US:NEW',f.clock());assert.equal(f.request().status,'QUEUED');
  assert.deepEqual(f.request().steps,{identity:'COMPLETE',themes:'COMPLETE'});
});

test('concurrent or stale workers cannot publish support or overwrite another owner',async()=>{
  const f=fixture();await requestCompanyOnboarding(f.db,'US:NEW',f.clock());
  let release:()=>void=()=>{},entered:()=>void=()=>{};
  const started=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const running=processCompanyOnboarding(f.db,'US:NEW',{...f.handlers,identity:async()=>{entered();await hold;}},f.clock);
  await started;assert.equal((await processCompanyOnboarding(f.db,'US:NEW',f.handlers,f.clock)).status,'SKIPPED');
  f.rows.set(`${ONBOARDING_COLLECTION}/US:NEW`,{...f.request(),leaseOwner:'replacement'});
  release();await running;assert.equal(f.request().leaseOwner,'replacement');assert.equal(f.request().status,'PROCESSING');
});

test('a date rollover catches up prices and actions before completing onboarding',async()=>{
  const f=fixture();await requestCompanyOnboarding(f.db,'US:NEW',f.clock());
  for(let i=0;i<9;i++)await processCompanyOnboarding(f.db,'US:NEW',f.handlers,f.clock);
  f.advance(86400_000);
  assert.equal((await processCompanyOnboarding(f.db,'US:NEW',f.handlers,f.clock)).step,'corporateActions');
  assert.equal(f.request().targetThrough,'2026-10-25');assert.equal(f.request().status,'QUEUED');
});

test('verification rejects a concurrent theme change instead of publishing stale readiness',async()=>{
  const f=fixture();await requestCompanyOnboarding(f.db,'US:NEW',f.clock());
  for(let i=0;i<9;i++)await processCompanyOnboarding(f.db,'US:NEW',f.handlers,f.clock);
  await processCompanyOnboarding(f.db,'US:NEW',{...f.handlers,verify:async()=>{f.rows.set('companies/US:NEW',{...f.rows.get('companies/US:NEW'),themeMemberships:{}});}},f.clock);
  assert.equal(f.request().status,'QUEUED');assert.equal((f.request().steps as Record<string,unknown>).verify,undefined);
});

test('empty dividends and splits are valid, malformed or out-of-window actions are not',()=>{
  assert.deepEqual(onboardingActions([],'dividend','2026-10-24'),[]);
  assert.deepEqual(onboardingActions([],'split','2026-10-24'),[]);
  assert.equal(onboardingActions([{date:ONBOARDING_START,value:1,currency:'USD'}],'dividend','2026-10-24').length,1);
  assert.throws(()=>onboardingActions([{date:'2020-12-29',value:1,currency:'USD'}],'dividend','2026-10-24'));
  assert.throws(()=>onboardingActions([{date:'2021-01-01',value:-1,currency:'USD'}],'dividend','2026-10-24'));
  assert.throws(()=>onboardingActions([{date:'2021-01-01',split:'1/0'}],'split','2026-10-24'));
  assert.throws(()=>onboardingActions([{date:'2021-01-01',split:'2/1'},{date:'2021-01-01',split:'2/1'}],'split','2026-10-24'));
});

test('corporate action ingestion resumes from cache, preserves creation metadata and reconciles corrections',async()=>{
  const rows=new Map<string,Record<string,unknown>>([
    ['US_NEW_split_2021-01-02',{ticker:'NEW',market:'US',type:'split',source:'eodhd-splits',effectiveDate:'2021-01-02',status:'completed',createdAt:'original'}],
    ['US_NEW_split_2021-01-03',{ticker:'NEW',market:'US',type:'split',source:'eodhd-splits',effectiveDate:'2021-01-03',status:'completed'}],
  ]);
  const files=new Map<string,string>();let providerCalls=0,failDividend=true,commits=0;
  const ref=(id:string)=>({id});
  const db={collection:()=>({doc:ref,where:()=>({get:async()=>({docs:[...rows].map(([id,data])=>({id,data:()=>data}))})})}),batch:()=>{
    const writes:{id:string;data:Record<string,unknown>}[]=[];
    return {set:(r:{id:string},data:Record<string,unknown>)=>writes.push({id:r.id,data}),commit:async()=>{assert(writes.length<=5);commits++;for(const write of writes)rows.set(write.id,{...rows.get(write.id),...write.data});}};
  }} as unknown as Firestore;
  const bucket={file:(name:string)=>({download:async()=>{if(!files.has(name))throw {code:404};return [Buffer.from(files.get(name)!)];},save:async(text:string)=>{files.set(name,text);}})} as unknown as Bucket;
  const input={db,bucket,ticker:'NEW',market:'US',providerSymbol:'NEW.US',through:'2026-10-24',token:'test',guard:async()=>{},pause:async()=>{},fetcher:async(url:string|URL|Request)=>{
    providerCalls++;const endpoint=new URL(String(url));assert.equal(endpoint.searchParams.get('from'),ONBOARDING_START);
    return endpoint.pathname.includes('/splits/')?new Response(JSON.stringify([{date:'2021-01-02',split:'3/2'}]))
      :failDividend?new Response('unavailable',{status:503}):new Response(JSON.stringify([{date:'2022-02-02',value:0.25,unadjustedValue:0.5,currency:'USD'}]));
  }};
  await assert.rejects(()=>backfillOnboardingActions(input));assert.equal(commits,0,'Both provider histories must validate before publishing actions');
  failDividend=false;assert.deepEqual(await backfillOnboardingActions(input),{splits:1,dividends:1});assert.equal(providerCalls,3);
  assert.equal(rows.get('US_NEW_split_2021-01-02')?.createdAt,'original');
  assert.equal(rows.get('US_NEW_split_2021-01-02')?.splitFactor,1.5);
  assert.equal(rows.get('US_NEW_split_2021-01-03')?.status,'cancelled');
  assert.equal((rows.get('US_NEW_dividend_2022-02-02')?.sourcePayload as {unadjustedValue:number}).unadjustedValue,0.5);
  await backfillOnboardingActions(input);assert.equal(providerCalls,3,'Checkpoint retries reuse immutable provider responses');
});
