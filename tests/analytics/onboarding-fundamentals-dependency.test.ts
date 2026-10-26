import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import type {Firestore} from 'firebase-admin/firestore';
import {createOnboardingRequest} from '../../src/lib/instrument-onboarding/model';
import {instrumentFromCompany,instrumentId} from '../../src/lib/instruments/model';
import seed from '../../data/investment-themes/catalog-v1.json';
import {catalogGraphSectors} from '../../src/lib/company-themes/catalog-graph';
import {onboardingFixture} from '../helpers/instrument-onboarding';
import {LEGACY_NO_THEME_MATCH,NO_THEME_MATCH_REASON} from '../../src/lib/instrument-onboarding/progress';

async function handlersFixture(automatic=false){
  const bundle=await build({stdin:{contents:"export * from './src/lib/instrument-onboarding/handlers';export {processInstrumentOnboarding} from './src/lib/instrument-onboarding/queue';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'scheduled-financial-dependency',setup(builder){
    builder.onLoad({filter:/[\\/]intelligence[\\/]price-cache\.ts$/},()=>({loader:'js',contents:'export const writeCachedPrice=()=>{throw Error("Unexpected price write");};'}));
    builder.onLoad({filter:/[\\/]predictions[\\/]latest-eod\.ts$/},()=>({loader:'js',contents:'export const saveLatestEodPrice=()=>{throw Error("Unexpected latest-price write");};'}));
    builder.onLoad({filter:/[\\/]company-themes[\\/]catalog\.ts$/},()=>({loader:'js',contents:`export const loadThemeCatalog=async()=>${automatic?JSON.stringify(seed.nodes):'[]'};`}));
    if(!automatic){
    builder.onLoad({filter:/[\\/]company-themes[\\/]catalog-model\.ts$/},()=>({loader:'js',contents:'export const catalogThemeIds=()=>["ai"]; export const catalogThemes=()=>[{id:"ai"}];'}));
    builder.onLoad({filter:/[\\/]company-themes[\\/]catalog-graph\.ts$/},()=>({loader:'js',contents:'export const catalogGraphSectors=()=>[{id:"compute",stages:[]}];'}));
    }
  }}]});
  const fixture={exports:{} as typeof import('../../src/lib/instrument-onboarding/handlers')&Pick<typeof import('../../src/lib/instrument-onboarding/queue'),'processInstrumentOnboarding'>};
  new Function('require','module',bundle.outputFiles[0].text)(createRequire(import.meta.url),fixture);
  return fixture.exports;
}

test('automatic theme checkpoint publishes once and fences concurrent admin edits and expired ownership',async()=>{
 const api=await handlersFixture(true);
 for(const mode of ['success','admin-change','lease-change','no-match-admin-change']){
  const id='US:NEW',company:Record<string,unknown>={name:'New Company',status:'DIRECTORY',cik:'123'},instrument=instrumentFromCompany(id,company)!;
  const request={...createOnboardingRequest(instrumentId(id),instrument,company,'viewer'),status:'PROCESSING' as const,leaseOwner:'owned',leaseExpiresAt:Date.now()+60000};
  const records=new Map<string,Record<string,unknown>>([['companies/'+id,company],['instrument_onboarding_requests/'+request.instrumentId,{...request}]]);
  type Ref={path:string};
  const snapshot=(ref:Ref)=>({data:()=>records.get(ref.path),get:(key:string)=>records.get(ref.path)?.[key]});
  let writes=0,calls=0;
  const db={collection:(name:string)=>({doc:(key:string)=>({path:name+'/'+key,get:async()=>snapshot({path:name+'/'+key})})}),runTransaction:async(fn:(tx:{get:(ref:Ref)=>Promise<ReturnType<typeof snapshot>>;update:(ref:Ref,fields:Record<string,unknown>)=>void})=>Promise<unknown>)=>fn({get:async(ref:Ref)=>snapshot(ref),update:(ref:Ref,fields:Record<string,unknown>)=>{writes++;Object.assign(records.get(ref.path)!,fields);}})};
  const handlers=api.createOnboardingHandlers({db:db as never,bucket:{} as never,token:'unused',log:{runId:'test'} as never,maintenanceReady:async()=>true,classify:async()=>{
    calls++;if(mode.includes('admin-change'))company.description='Administrator correction';if(mode==='lease-change')records.get('instrument_onboarding_requests/'+request.instrumentId)!.leaseOwner='different-worker';
    return {companyId:id,description:'Builds industrial robots.',assignments:mode==='no-match-admin-change'?[]:[{theme:'robotics',primarySector:catalogGraphSectors(seed.nodes,'robotics')[0].id,sources:[{url:'https://example.com/official',title:'Official business description',summary:'Manufactures industrial robots.'}]}]};
  }});
  const context={request,instrument,company,guard:async()=>{}};
  if(mode==='success'){await handlers.themes(context);assert.deepEqual(company.themeIds,['robotics']);assert.equal(company.description,'Builds industrial robots.');await handlers.themes(context);assert.equal(calls,1);assert.equal(writes,1);}
  else{await assert.rejects(handlers.themes(context),mode.includes('admin-change')?/Company changed/:/lease lost/);assert.equal(writes,0);assert.equal(company.themeMemberships,undefined);}
 }
});

test('no new match does not withdraw an existing evidenced theme while filling a missing description',async()=>{
 const api=await handlersFixture(true),f=onboardingFixture(Date.now());await f.enqueue();await f.process();
 const company=f.rows.get('companies/US:NEW')!,membership={status:'PUBLISHED',primarySector:catalogGraphSectors(seed.nodes,'robotics')[0].id,reviewedAt:'2026-10-25',sources:[{url:'https://example.com/official',title:'Official company business',summary:'Manufactures industrial robots.'}]};
 company.themeMemberships={robotics:membership};let calls=0;
 const handlers=api.createOnboardingHandlers({db:f.db,bucket:{} as never,token:'unused',log:{runId:'test'} as never,maintenanceReady:async()=>true,classify:async()=>{calls++;return {companyId:'US:NEW',description:'Official company description.',assignments:[]};}});
 const result=await api.processInstrumentOnboarding(f.db,f.id,{...f.handlers,themes:handlers.themes},f.clock);
 assert.equal(result.status,'CHECKPOINTED');assert.equal(f.request().status,'QUEUED');assert.equal(calls,1);assert.deepEqual(f.rows.get('companies/US:NEW')!.themeMemberships,{robotics:membership});assert.equal(f.rows.get('companies/US:NEW')!.description,'Official company description.');
});

test('no-match and provider errors block once; legacy queued failures never make another call',async()=>{
 const api=await handlersFixture(true);
 for(const mode of ['no-match','legacy','provider-error']){
  const f=onboardingFixture(Date.now());await f.enqueue();await f.process();
  if(mode==='legacy'){f.request().lastError=LEGACY_NO_THEME_MATCH;f.request().attemptCount=3;}
  let calls=0;
  const handlers=api.createOnboardingHandlers({db:f.db,bucket:{} as never,token:'unused',log:{runId:'test'} as never,maintenanceReady:async()=>true,classify:async()=>{
   calls++;if(mode==='provider-error')throw Error('Provider returned 503');return {companyId:'US:NEW',description:'Official business description.',assignments:[]};
  }});
  const process=()=>api.processInstrumentOnboarding(f.db,f.id,{...f.handlers,themes:handlers.themes},f.clock);
  assert.equal((await process()).status,mode==='legacy'?'SKIPPED':'INCOMPLETE');
  assert.equal(f.request().status,'BLOCKED');assert.equal(f.request().nextAttemptAt,0);
  if(mode==='no-match')assert.equal(f.request().lastError,`themes: ${NO_THEME_MATCH_REASON}`);
  if(mode==='legacy')assert.equal(f.request().lastError,LEGACY_NO_THEME_MATCH);
  if(mode==='provider-error')assert.match(String(f.request().lastError),/Provider returned 503/);
  assert.equal((f.rows.get('companies/US:NEW')!.onboarding as {status:string}).status,'BLOCKED');
  assert.equal((f.rows.get(`instruments/${f.id}`)!.onboarding as {status:string}).status,'BLOCKED');
  f.advance(86400_000);assert.equal((await process()).status,'SKIPPED');assert.equal(calls,mode==='legacy'?0:1);assert.deepEqual(f.request().steps,{identity:'COMPLETE'});
 }
});

test('company and instrument admission validate backfills without financial data in either market',async()=>{
  const api=await handlersFixture();
  for(const id of ['US:NEW','XSHE:000001']){
    const company:Record<string,unknown>={name:'New',status:'DIRECTORY',cik:'123',description:'Reviewed profile',themeMemberships:{ai:{status:'PUBLISHED',primarySector:'compute',reviewedAt:'2026-10-01',sources:[{url:'https://example.com/evidence',title:'Evidence',summary:'Reviewed classification'}]}}};
    const instrument=instrumentFromCompany(id,company)!;
    const request=createOnboardingRequest(instrumentId(id),instrument,company,'viewer',new Date('2026-10-25T12:00:00Z'));
    const market=id.startsWith('US:')?'US':'CN_A',ticker=id.startsWith('US:')?'NEW':id,provider=id.startsWith('US:')?'NEW.US':'000001.SHE';
    const prefix=`eod-history/${market}/${encodeURIComponent(ticker)}/2020-12-30_${request.targetThrough}.json`;
    const actionPrefix=`eod-history/actions/${market}/${encodeURIComponent(ticker)}/2020-12-30_${request.targetThrough}`;
    const bar={date:'2026-10-23',open:1,high:1,low:1,close:1,adjusted_close:1,volume:100};
    const files=new Map<string,unknown>([[prefix,[bar]],[actionPrefix+'/split.json',[{date:'2026-10-22',split:'2/1'}]],[actionPrefix+'/dividend.json',[{date:'2026-10-21',value:0.5,currency:'USD'}]]]);
    const priceKey=`eod_prices/${market}_${ticker}_${bar.date}`,splitKey=`corporate_actions/${market}_${ticker}_split_2026-10-22`,dividendKey=`corporate_actions/${market}_${ticker}_dividend_2026-10-21`;
    const rows=new Map<string,Record<string,unknown>>([
      ['companies/'+id,company],
      [`collectors/eod-history_${market}_${ticker}_2020-12-30_${request.targetThrough}`,{status:'completed',from:'2020-12-30',through:request.targetThrough,cachePath:prefix}],
      [priceKey,{market,ticker,tradingDate:bar.date,close:1}],
      [splitKey,{market,ticker,providerSymbol:provider,type:'split',effectiveDate:'2026-10-22',status:'completed',source:'eodhd-splits',splitNumerator:2,splitDenominator:1,splitFactor:2}],
      [dividendKey,{market,ticker,providerSymbol:provider,type:'dividend',effectiveDate:'2026-10-21',status:'completed',source:'eodhd-dividends',sourcePayload:{value:0.5,currency:'USD'}}],
    ]);
    const snapshot=(path:string)=>({data:()=>rows.get(path)});
    const db={collection:(name:string)=>{assert.notEqual(name,'company_fundamentals','onboarding must not access financial storage');return {doc:(key:string)=>({path:name+'/'+key,get:async()=>snapshot(name+'/'+key)})};},getAll:async(...refs:{path:string}[])=>refs.map(ref=>snapshot(ref.path))} as unknown as Firestore;
    const bucket={file:(path:string)=>({download:async()=>{if(!files.has(path))throw Error('Missing backfill cache');return [Buffer.from(JSON.stringify(files.get(path)))];}})};
    const handlers=api.createOnboardingHandlers({db,bucket:bucket as never,token:'unused',log:{runId:'test'} as never,maintenanceReady:async()=>true});
    const context={request,instrument,company,guard:async()=>{}};
    await handlers.events(context);company.onboarding={status:'SUPPORTED'};
    await handlers.verify(context);
    const price=rows.get(priceKey)!;rows.delete(priceKey);await assert.rejects(()=>handlers.verify(context),/price history requires repair/);rows.set(priceKey,price);
    rows.get(splitKey)!.splitFactor=3;await assert.rejects(()=>handlers.verify(context),/split ratio requires repair/);rows.get(splitKey)!.splitFactor=2;
    rows.get(dividendKey)!.sourcePayload={value:9,currency:'USD'};await assert.rejects(()=>handlers.verify(context),/dividend requires repair/);rows.get(dividendKey)!.sourcePayload={value:0.5,currency:'USD'};
    files.delete(actionPrefix+'/dividend.json');await assert.rejects(()=>handlers.verify(context),/Missing backfill cache/);
  }
});
