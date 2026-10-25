import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import type {Firestore} from 'firebase-admin/firestore';
import {createOnboardingRequest} from '../../src/lib/instrument-onboarding/model';
import {instrumentFromCompany,instrumentId} from '../../src/lib/instruments/model';

async function handlersFixture(){
  const bundle=await build({entryPoints:['src/lib/instrument-onboarding/handlers.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',plugins:[{name:'scheduled-financial-dependency',setup(builder){
    builder.onLoad({filter:/[\\/]fundamentals[\\/](market-cap|cn-refresh|cn-sources)\.ts$/},()=>({loader:'js',contents:'const forbidden=()=>{throw Error("Provider work must wait for fundamentals");};export const refreshCompanyMarketCaps=forbidden,refreshCnFundamentals=forbidden,createCnRequester=forbidden,createCnSources=forbidden;'}));
    builder.onLoad({filter:/[\\/]predictions[\\/](history-backfill|latest-eod)\.ts$/},()=>({loader:'js',contents:'const forbidden=()=>{throw Error("Unexpected price work");};export const backfillPriceHistory=forbidden,historyBars=forbidden,historyProviderSymbol=forbidden,saveLatestEodPrice=forbidden;'}));
    builder.onLoad({filter:/[\\/]company-themes[\\/]catalog\.ts$/},()=>({loader:'js',contents:'export const loadThemeCatalog=async()=>[];'}));
    builder.onLoad({filter:/[\\/]company-themes[\\/]catalog-model\.ts$/},()=>({loader:'js',contents:'export const catalogThemeIds=()=>["ai"];'}));
    builder.onLoad({filter:/[\\/]company-themes[\\/]catalog-graph\.ts$/},()=>({loader:'js',contents:'export const catalogGraphSectors=()=>[{id:"compute",stages:[]}];'}));
  }}]});
  const fixture={exports:{} as typeof import('../../src/lib/instrument-onboarding/handlers')};
  new Function('require','module',bundle.outputFiles[0].text)(createRequire(import.meta.url),fixture);
  return fixture.exports;
}

test('company events admission ignores missing fundamentals; instrument dependency only reads scheduled results in both markets',async()=>{
  const api=await handlersFixture();
  for(const id of ['US:NEW','XSHE:000001']){
    const company={name:'New',status:'DIRECTORY',cik:'123',description:'Reviewed profile',themeMemberships:{ai:{status:'PUBLISHED',primarySector:'compute',reviewedAt:'2026-10-01',sources:[{url:'https://example.com/evidence',title:'Evidence',summary:'Reviewed classification'}]}}};
    const instrument=instrumentFromCompany(id,company)!;
    const request=createOnboardingRequest(instrumentId(id),instrument,company,'viewer');
    const reads:string[]=[];let financial:Record<string,unknown>|undefined;
    const db={collection:(name:string)=>({doc:()=>({get:async()=>{reads.push(name);return {data:()=>name==='companies'?company:financial};}})})} as unknown as Firestore;
    const handlers=api.createOnboardingHandlers({db,bucket:{} as never,token:'unused',log:{runId:'test'} as never,maintenanceReady:async()=>true});
    const context={request,instrument,company,guard:async()=>{}};
    await handlers.events(context);assert(!reads.includes('company_fundamentals'));
    await assert.rejects(()=>handlers.fundamentals(context),/Waiting for scheduled company fundamentals/);
    await assert.rejects(()=>handlers.metrics(context),/Waiting for scheduled company fundamentals/);
    financial={outcome:'pending'};await assert.rejects(()=>handlers.fundamentals(context),/Waiting for scheduled company fundamentals/);
    financial=id.startsWith('US:')?{value:{report:{cik:'123'},metrics:[{value:100}]}}:{cnAnnual:{companyId:id,metrics:[{value:100}]}};
    await handlers.fundamentals(context);
    financial=id.startsWith('US:')?{value:{report:{cik:'999'},metrics:[{value:100}]}}:{cnAnnual:{companyId:'XSHE:000002',metrics:[{value:100}]}};
    await assert.rejects(()=>handlers.fundamentals(context),/issuer does not match/);
  }
});
