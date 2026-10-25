import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import type {Firestore} from 'firebase-admin/firestore';
import {createOnboardingRequest} from '../../src/lib/instrument-onboarding/model';
import {instrumentFromCompany,instrumentId} from '../../src/lib/instruments/model';

async function handlersFixture(){
  const bundle=await build({entryPoints:['src/lib/instrument-onboarding/handlers.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'scheduled-financial-dependency',setup(builder){
    builder.onLoad({filter:/[\\/]intelligence[\\/]price-cache\.ts$/},()=>({loader:'js',contents:'export const writeCachedPrice=()=>{throw Error("Unexpected price write");};'}));
    builder.onLoad({filter:/[\\/]predictions[\\/]latest-eod\.ts$/},()=>({loader:'js',contents:'export const saveLatestEodPrice=()=>{throw Error("Unexpected latest-price write");};'}));
    builder.onLoad({filter:/[\\/]company-themes[\\/]catalog\.ts$/},()=>({loader:'js',contents:'export const loadThemeCatalog=async()=>[];'}));
    builder.onLoad({filter:/[\\/]company-themes[\\/]catalog-model\.ts$/},()=>({loader:'js',contents:'export const catalogThemeIds=()=>["ai"];'}));
    builder.onLoad({filter:/[\\/]company-themes[\\/]catalog-graph\.ts$/},()=>({loader:'js',contents:'export const catalogGraphSectors=()=>[{id:"compute",stages:[]}];'}));
  }}]});
  const fixture={exports:{} as typeof import('../../src/lib/instrument-onboarding/handlers')};
  new Function('require','module',bundle.outputFiles[0].text)(createRequire(import.meta.url),fixture);
  return fixture.exports;
}

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
