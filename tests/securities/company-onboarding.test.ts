import {onboardingFixture} from '../helpers/instrument-onboarding';
import {onboarding} from '../helpers/company-onboarding';
import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {ONBOARDING_COLLECTION,ONBOARDING_STEPS,ONBOARDING_START,OnboardingBlocked,createOnboardingRequest,onboardingIdentity} from '../../src/lib/instrument-onboarding/model';
import {requestInstrumentOnboarding,retryInstrumentOnboarding} from '../../src/lib/instrument-onboarding/queue';
import {onboardingActions,backfillOnboardingActions} from '../../src/lib/instrument-onboarding/actions';
import {instrumentId,instrumentFromCompany} from '../../src/lib/instruments/model';
import {isSupportedInstrument} from '../../src/lib/instruments/support';
import {requesterId} from '../../src/lib/instrument-onboarding/requesters';
import {planInstrumentSupportMigration,instrumentMigrationScope} from '../../src/lib/instruments/support-migration';

test('instrument requests validate listing/issuer linkage, deduplicate and make no provider calls',async()=>{
  const f=onboardingFixture();await Promise.all([f.enqueue(),f.enqueue()]);
  assert.equal(f.rows.size,5);assert.equal(f.request().status,'QUEUED');assert.deepEqual(f.calls,[]);
  const at=f.request().requestedAt;await f.enqueue();assert.equal(f.request().requestedAt,at);
  assert.equal(at,new Date(f.clock()).toISOString());assert.equal(f.request().requestedByUid,'requester-one');
  await requestInstrumentOnboarding(f.db,f.id,'another-user','US:NEW',f.clock()+5000);
  assert.equal(f.request().requestedByUid,'requester-one');assert.equal(f.request().requestedAt,at);
  await f.enqueue('XSHE:000001');
  assert.throws(()=>onboardingIdentity('US:NO-CIK',{name:'No CIK',status:'DIRECTORY'}),/CIK not matched/);
  assert.throws(()=>onboardingIdentity('XBSE:830001',{name:'Unsupported',status:'DIRECTORY'}),/not supported/);
  const company=f.rows.get('companies/US:NEW')!;
  assert.equal(createOnboardingRequest(f.id,instrumentFromCompany('US:NEW',company)!,company,'requester-one',new Date(f.clock())).targetThrough,'2026-10-24');
  await assert.rejects(()=>requestInstrumentOnboarding(f.db,instrumentId('US:OTHER'),'requester-one','US:NEW',f.clock()),/identity/);
});

test('issuer readiness completes independently before instrument prices and actions',async()=>{
  const f=onboardingFixture();await f.enqueue();
  for(const step of ONBOARDING_STEPS){
    assert.equal((await f.process()).step,step);
    const company=f.rows.get('companies/US:NEW')!,stock=f.rows.get(`instruments/${f.id}`)!;
    if(['events','corporateActions','prices','verify'].includes(step))assert.equal((company.onboarding as {status:string}).status,'SUPPORTED');
    if(step==='events')assert.equal(f.calls.includes('fundamentals'),false);
    assert.equal((stock.onboarding as {status:string}).status,step==='verify'?'SUPPORTED':'PROCESSING');
  }
  assert.deepEqual(f.calls,[...ONBOARDING_STEPS]);assert.equal(f.request().status,'SUPPORTED');assert.equal((await f.process()).status,'SKIPPED');
});

test('company admission has no graph checkpoint and tolerates a completed legacy checkpoint',async()=>{
  const f=onboardingFixture();await f.enqueue();
  await f.process();await f.process();await f.process();
  assert.deepEqual(f.calls,['identity','themes','profile']);
  // Older staged requests may still contain the removed COMPLETE checkpoint.
  f.request().steps={...f.request().steps as object,graph:'COMPLETE'};
  assert.equal((await f.process()).step,'events');
  assert.equal((f.rows.get('companies/US:NEW')!.onboarding as {status:string}).status,'SUPPORTED');
  assert(!f.calls.includes('graph'));assert.equal((await f.process()).step,'corporateActions');
});

test('each user gets one immutable request record while the instrument is onboarded only once',async()=>{
  const f=onboardingFixture(),start=f.clock();
  await Promise.all([
    requestInstrumentOnboarding(f.db,f.id,'first-user','US:NEW',start),
    requestInstrumentOnboarding(f.db,f.id,'second/user 名','US:NEW',start+1000),
    requestInstrumentOnboarding(f.db,f.id,'first-user','US:NEW',start+2000),
  ]);
  const prefix=`${ONBOARDING_COLLECTION}/${f.id}/requesters/`;
  assert.equal([...f.rows.keys()].filter(path=>path.startsWith(prefix)).length,2);
  assert.deepEqual(f.rows.get(prefix+requesterId('first-user')),{requestedByUid:'first-user',requestedAt:new Date(start).toISOString()});
  assert.deepEqual(f.rows.get(prefix+requesterId('second/user 名')),{requestedByUid:'second/user 名',requestedAt:new Date(start+1000).toISOString()});
  const saved=structuredClone(f.request());
  await requestInstrumentOnboarding(f.db,f.id,'third-user','US:NEW',start+3000);assert.deepEqual(f.request(),saved);
  for(let n=0;n<ONBOARDING_STEPS.length;n++)await f.process();
  assert.deepEqual(f.calls,[...ONBOARDING_STEPS]);
  const done=structuredClone(f.request());
  await requestInstrumentOnboarding(f.db,f.id,'fourth-user','US:NEW',start+4000);assert.deepEqual(f.request(),done);
  assert.equal((await f.process()).status,'SKIPPED');assert.equal(f.calls.length,ONBOARDING_STEPS.length);
  assert.equal([...f.rows.keys()].filter(path=>path.startsWith(prefix)).length,4);
});

test('another share class reuses issuer work but must finish its own price and action checkpoints',async()=>{
  const f=onboardingFixture();f.rows.set('companies/US:NEW',{...f.rows.get('companies/US:NEW'),onboarding:onboarding()});
  f.rows.set('companies/US:NEW.B',{name:'New B',status:'DIRECTORY',supersededByCompanyId:'US:NEW'});
  const second=instrumentId('US:NEW.B');await f.enqueue('US:NEW.B');
  for(const step of ONBOARDING_STEPS){
    await f.process(f.handlers,second);
    if(step==='corporateActions')assert.equal((f.rows.get('companies/US:NEW')!.onboarding as {status:string}).status,'SUPPORTED');
  }
  assert.deepEqual(f.calls,['identity','corporateActions','prices','verify']);
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
  assert.equal(f.request().requestedByUid,'requester-one');assert.equal(f.request().requestedAt,new Date(f.clock()).toISOString());
});

test('an active worker cannot be retried or overwritten by another worker',async()=>{
  const f=onboardingFixture();await f.enqueue();let release:()=>void=()=>{},entered:()=>void=()=>{};
  const started=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const running=f.process({...f.handlers,identity:async()=>{entered();await hold;}});await started;
  const active=structuredClone(f.request());
  await requestInstrumentOnboarding(f.db,f.id,'another-requester','US:NEW',f.clock()+1000);
  assert.deepEqual(f.request(),active,'New requester must not change a running lease or checkpoint');
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
  const f=onboardingFixture();await f.enqueue();for(let i=0;i<ONBOARDING_STEPS.indexOf('verify');i++)await f.process();f.advance(86400_000);
  assert.equal((await f.process()).step,'corporateActions');assert.equal(f.request().targetThrough,'2026-10-25');
  assert.equal((f.rows.get('companies/US:NEW')!.onboarding as {status:string}).status,'SUPPORTED');
});

test('a request waiting in the queue uses the latest cutoff before doing any work',async()=>{
  const f=onboardingFixture();await f.enqueue();const originalTime=f.request().requestedAt;
  f.advance(7*86400_000);await f.process();
  assert.equal(f.request().targetThrough,'2026-10-31');assert.equal(f.request().requestedAt,originalTime);assert.deepEqual(f.calls,['identity']);
});

test('a cutoff change between actions and prices restarts both for one consistent range',async()=>{
  const f=onboardingFixture();await f.enqueue();for(let n=0;n<ONBOARDING_STEPS.indexOf('prices');n++)await f.process();
  assert.equal((f.request().steps as Record<string,unknown>).corporateActions,'COMPLETE');
  f.advance(86400_000);assert.equal((await f.process()).step,'corporateActions');assert.equal(f.request().targetThrough,'2026-10-25');
});

test('instrument onboarding completes with no fundamentals or market-cap work and ignores old maintenance checkpoints',async()=>{
  const f=onboardingFixture();await f.enqueue();
  const saved={outcome:'error',pending:false};f.rows.set('company_fundamentals/US:NEW',saved);
  f.request().steps={graph:'COMPLETE',fundamentals:'COMPLETE',metrics:'COMPLETE'};
  for(const step of ONBOARDING_STEPS)assert.equal((await f.process()).step,step);
  assert.equal(f.request().status,'SUPPORTED');assert.deepEqual(f.rows.get('company_fundamentals/US:NEW'),saved);
  assert.deepEqual(f.calls,['identity','themes','profile','events','corporateActions','prices','verify']);
});

test('concurrent theme edits or instrument reparenting cannot publish stale instrument readiness',async()=>{
  const f=onboardingFixture();await f.enqueue();for(let i=0;i<ONBOARDING_STEPS.indexOf('verify');i++)await f.process();
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
  assert.deepEqual(instrumentMigrationScope(['ORG:OPENAI','US:OLD','XSHG:600000','ORG:ANTHROPIC','XSHE:000001','XBSE:830001']),['US:OLD','XSHG:600000','XSHE:000001']);
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
