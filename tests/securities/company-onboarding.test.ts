import {onboarding} from '../helpers/company-onboarding';
import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {ONBOARDING_COLLECTION,ONBOARDING_STEPS,ONBOARDING_START,OnboardingBlocked,createOnboardingRequest,onboardingIdentity} from '../../src/lib/instrument-onboarding/model';
import {requestInstrumentOnboarding,processInstrumentOnboarding,retryInstrumentOnboarding,type OnboardingHandlers} from '../../src/lib/instrument-onboarding/queue';
import {onboardingActions,backfillOnboardingActions} from '../../src/lib/instrument-onboarding/actions';
import {instrumentId,instrumentFromCompany} from '../../src/lib/instruments/model';
import {isSupportedInstrument} from '../../src/lib/instruments/support';
import {planInstrumentSupportMigration} from '../../src/lib/instruments/support-migration';

export function onboardingFixture(){
  const rows=new Map<string,Record<string,unknown>>([['companies/US:NEW',{name:'New',status:'DIRECTORY',cik:'123'}],['companies/XSHE:000001',{name:'A-share',status:'DIRECTORY'}]]);
  const ref=(path:string)=>({path,id:path.split('/').at(-1),get:async()=>snapshot(path)});
  const snapshot=(path:string)=>({ref:ref(path),id:path.split('/').at(-1),exists:rows.has(path),data:()=>rows.get(path),get:(key:string)=>rows.get(path)?.[key]});
  const collection=(name:string)=>{
    const query={name,field:'',value:undefined as unknown,where:(field:string,_op:string,value:unknown)=>({...query,field,value}),get:async()=>({docs:[...rows.keys()].filter(path=>path.startsWith(name+'/')).map(snapshot)})};
    return {...query,doc:(id:string)=>ref(`${name}/${id}`)};
  };
  const read=async(r:{path?:string;name?:string;field?:string;value?:unknown})=>r.path?snapshot(r.path):{docs:[...rows.keys()].filter(path=>path.startsWith(r.name+'/')&&rows.get(path)?.[r.field!]===r.value).map(snapshot)};
  let tail=Promise.resolve();
  const db={collection,getAll:async(...refs:{path:string}[])=>refs.map(r=>snapshot(r.path)),runTransaction:<T>(work:(tx:unknown)=>Promise<T>)=>{
    const run=tail.then(async()=>{const writes:(()=>void)[]=[];const value=await work({get:read,getAll:async(...refs:{path:string}[])=>refs.map(r=>snapshot(r.path)),
      create:(r:{path:string},data:Record<string,unknown>)=>{assert(!rows.has(r.path));writes.push(()=>rows.set(r.path,data));},
      set:(r:{path:string},data:Record<string,unknown>,options?:{merge?:boolean})=>writes.push(()=>rows.set(r.path,options?.merge?{...rows.get(r.path),...data}:data)),
      update:(r:{path:string},data:Record<string,unknown>)=>writes.push(()=>rows.set(r.path,{...rows.get(r.path),...data})),});writes.forEach(write=>write());return value;});tail=run.then(()=>undefined,()=>undefined);return run;
  }} as unknown as Firestore;
  let now=Date.parse('2026-10-25T12:00:00Z');const clock=()=>now,calls:string[]=[];
  const handlers=Object.fromEntries(ONBOARDING_STEPS.map(step=>[step,async()=>{calls.push(step);}])) as unknown as OnboardingHandlers;
  const id=instrumentId('US:NEW');
  const request=(key=id)=>rows.get(`${ONBOARDING_COLLECTION}/${key}`)!;
  const enqueue=(listing='US:NEW')=>requestInstrumentOnboarding(db,instrumentId(listing),listing,clock());
  const process=(custom=handlers,key=id)=>processInstrumentOnboarding(db,key,custom,clock);
  return {db,rows,calls,handlers,clock,id,request,enqueue,process,advance:(ms:number)=>{now+=ms;}};
}

test('instrument requests validate listing/issuer linkage, deduplicate and make no provider calls',async()=>{
  const f=onboardingFixture();await Promise.all([f.enqueue(),f.enqueue()]);
  assert.equal(f.rows.size,4);assert.equal(f.request().status,'QUEUED');assert.deepEqual(f.calls,[]);
  const at=f.request().requestedAt;await f.enqueue();assert.equal(f.request().requestedAt,at);
  await f.enqueue('XSHE:000001');
  assert.throws(()=>onboardingIdentity('US:NO-CIK',{name:'No CIK',status:'DIRECTORY'}),/CIK not matched/);
  assert.throws(()=>onboardingIdentity('XBSE:830001',{name:'Unsupported',status:'DIRECTORY'}),/not supported/);
  const company=f.rows.get('companies/US:NEW')!;
  assert.equal(createOnboardingRequest(f.id,instrumentFromCompany('US:NEW',company)!,company,new Date(f.clock())).targetThrough,'2026-10-24');
  await assert.rejects(()=>requestInstrumentOnboarding(f.db,instrumentId('US:OTHER'),'US:NEW',f.clock()),/identity/);
});

test('issuer readiness completes independently before instrument prices and actions',async()=>{
  const f=onboardingFixture();await f.enqueue();
  for(const step of ONBOARDING_STEPS){
    assert.equal((await f.process()).step,step);
    const company=f.rows.get('companies/US:NEW')!,stock=f.rows.get(`instruments/${f.id}`)!;
    if(['corporateActions','prices','metrics','verify'].includes(step))assert.equal((company.onboarding as {status:string}).status,'SUPPORTED');
    assert.equal((stock.onboarding as {status:string}).status,step==='verify'?'SUPPORTED':'PROCESSING');
  }
  assert.deepEqual(f.calls,[...ONBOARDING_STEPS]);assert.equal(f.request().status,'SUPPORTED');assert.equal((await f.process()).status,'SKIPPED');
});

test('another share class reuses issuer work but must finish its own price and action checkpoints',async()=>{
  const f=onboardingFixture();f.rows.set('companies/US:NEW',{...f.rows.get('companies/US:NEW'),onboarding:onboarding()});
  f.rows.set('companies/US:NEW.B',{name:'New B',status:'DIRECTORY',supersededByCompanyId:'US:NEW'});
  const second=instrumentId('US:NEW.B');await f.enqueue('US:NEW.B');
  for(const step of ONBOARDING_STEPS){
    await f.process(f.handlers,second);
    if(step==='corporateActions')assert.equal((f.rows.get('companies/US:NEW')!.onboarding as {status:string}).status,'SUPPORTED');
  }
  assert.deepEqual(f.calls,['identity','fundamentals','corporateActions','prices','metrics','verify']);
  assert.equal(f.request(second).companyId,'US:NEW');assert.equal(f.request(second).status,'SUPPORTED');
});

test('retry keeps completed checkpoints, blocks stale admin actions and redacts provider errors',async()=>{
  const f=onboardingFixture();await f.enqueue();await f.process();
  await f.process({...f.handlers,themes:async()=>{throw Error('Provider unavailable https://provider.test?api_token=secret');}});
  assert.equal(f.request().status,'QUEUED');assert.equal(f.request().attemptCount,1);assert(!String(f.request().lastError).includes('secret'));
  assert.equal((await f.process()).status,'SKIPPED');
  await assert.rejects(()=>retryInstrumentOnboarding(f.db,f.id,{step:'themes',updatedAt:'old'},f.clock()),/changed/);
  await retryInstrumentOnboarding(f.db,f.id,{step:'themes',updatedAt:String(f.request().updatedAt)},f.clock());
  await assert.rejects(()=>retryInstrumentOnboarding(f.db,f.id,{step:'themes',updatedAt:String(f.request().updatedAt)},f.clock()),/changed/);
  await f.process();await f.process({...f.handlers,profile:async()=>{throw new OnboardingBlocked('Reviewed company description is required');}});
  assert.equal(f.request().status,'BLOCKED');assert.equal((await f.enqueue()).status,'BLOCKED');
  await retryInstrumentOnboarding(f.db,f.id,{step:'profile',updatedAt:String(f.request().updatedAt)},f.clock());
  assert.deepEqual(f.request().steps,{identity:'COMPLETE',themes:'COMPLETE'});
});

test('an active worker cannot be retried or overwritten by another worker',async()=>{
  const f=onboardingFixture();await f.enqueue();let release:()=>void=()=>{},entered:()=>void=()=>{};
  const started=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const running=f.process({...f.handlers,identity:async()=>{entered();await hold;}});await started;
  assert.equal((await f.process()).status,'SKIPPED');
  await assert.rejects(()=>retryInstrumentOnboarding(f.db,f.id,{step:'identity',updatedAt:String(f.request().updatedAt)},f.clock()),/active/);
  f.rows.set(`${ONBOARDING_COLLECTION}/${f.id}`,{...f.request(),leaseOwner:'replacement'});release();await running;assert.equal(f.request().leaseOwner,'replacement');
});

test('company work is serialized across requests for the same issuer',async()=>{
  const f=onboardingFixture();f.rows.set('companies/US:NEW.B',{name:'New B',status:'DIRECTORY',supersededByCompanyId:'US:NEW'});
  await f.enqueue();await f.enqueue('US:NEW.B');const second=instrumentId('US:NEW.B');
  await f.process();await f.process(f.handlers,second);
  let release:()=>void=()=>{},entered:()=>void=()=>{};const started=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const running=f.process({...f.handlers,themes:async()=>{entered();await hold;}});await started;
  assert.equal((await f.process(f.handlers,second)).status,'SKIPPED');release();await running;
});

test('date rollover catches up only instrument history and preserves company admission',async()=>{
  const f=onboardingFixture();await f.enqueue();for(let i=0;i<9;i++)await f.process();f.advance(86400_000);
  assert.equal((await f.process()).step,'corporateActions');assert.equal(f.request().targetThrough,'2026-10-25');
  assert.equal((f.rows.get('companies/US:NEW')!.onboarding as {status:string}).status,'SUPPORTED');
});

test('concurrent theme edits or instrument reparenting cannot publish stale instrument readiness',async()=>{
  const f=onboardingFixture();await f.enqueue();for(let i=0;i<9;i++)await f.process();
  await f.process({...f.handlers,verify:async()=>{f.rows.set('companies/US:NEW',{...f.rows.get('companies/US:NEW'),themeMemberships:{}});}});
  assert.equal(f.request().status,'QUEUED');assert.equal((f.request().steps as Record<string,unknown>).verify,undefined);
});

test('supported issuer alone does not make a new instrument supported',()=>{
  const company={name:'Issuer',status:'DIRECTORY',onboarding:onboarding()};const record=instrumentFromCompany('US:NEW',company)!;
  assert.equal(isSupportedInstrument(record,company),false);assert(isSupportedInstrument({...record,onboarding:onboarding()},company));
  assert.equal(isSupportedInstrument({...record,onboarding:onboarding()}, {...company,onboarding:onboarding('BLOCKED')}),false);
});

test('instrument migration grandfathers only the frozen legacy list and refuses active requests',()=>{
  const company={name:'Issuer',status:'DIRECTORY',onboarding:onboarding()};
  const input={id:'US:OLD',company};
  assert.equal(planInstrumentSupportMigration([input],['US:OLD'])[0].id,instrumentId('US:OLD'));
  assert.throws(()=>planInstrumentSupportMigration([input],['US:OTHER']),/scope/);
  assert.throws(()=>planInstrumentSupportMigration([{...input,company:{...company,onboarding:undefined}}],['US:OLD']),/company support first/);
  const record=instrumentFromCompany('US:OLD',company)!;
  assert.deepEqual(planInstrumentSupportMigration([{...input,instrument:{...record,onboarding:onboarding()}}],['US:OLD']),[]);
  assert.throws(()=>planInstrumentSupportMigration([{...input,instrument:{...record,onboarding:onboarding('QUEUED')}}],['US:OLD']),/conflicts/);
});

test('invalidated instrument is blocked for admin correction without reverting its company',async()=>{
  const f=onboardingFixture();f.rows.set('companies/US:NEW',{...f.rows.get('companies/US:NEW'),onboarding:onboarding()});await f.enqueue();
  f.rows.set(`instruments/${f.id}`,{...f.rows.get(`instruments/${f.id}`),companyId:'US:OTHER'});
  await f.process();assert.equal(f.request().status,'BLOCKED');assert.equal((f.rows.get('companies/US:NEW')!.onboarding as {status:string}).status,'SUPPORTED');
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
