import {Timestamp,type Firestore} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {loadThemeCatalog} from '../company-themes/catalog';
import {catalogThemeIds} from '../company-themes/catalog-model';
import {catalogGraphSectors} from '../company-themes/catalog-graph';
import {activeThemeIds,type ThemedCompany} from '../company-themes/model';
import {planEnrollment,type EnrollmentBatch} from '../company-themes/enrollment';
import {syncCompanyInstrument} from '../instruments/service';
import {backfillPriceHistory,historyBars,historyProviderSymbol} from '../predictions/history-backfill';
import {saveLatestEodPrice} from '../predictions/latest-eod';
import {refreshCompanyFundamentals} from '../fundamentals/worker';
import {refreshCnAnnual} from '../fundamentals/cn-annual-worker';
import {refreshCompanyMarketCaps} from '../fundamentals/market-cap';
import {refreshCnFundamentals} from '../fundamentals/cn-refresh';
import {createCnRequester,createCnSources} from '../fundamentals/cn-sources';
import type {MaintenanceLog} from '../maintenance-log';
import {acquireMaintenanceLease,releaseMaintenanceLease} from '../maintenance-lease';
import {ONBOARDING_START,OnboardingBlocked,onboardingIdentity,validDay,type OnboardingRequest} from './model';
import type {OnboardingHandlers} from './queue';
import {backfillOnboardingActions} from './actions';

/** Adapters use existing provider workers and existing feature storage only. */
export function createOnboardingHandlers(options:{db:Firestore;bucket:Bucket;token:string;log:MaintenanceLog;themeBatches?:EnrollmentBatch[];maintenanceReady:()=>Promise<boolean>}) :OnboardingHandlers{
  const {db,bucket,log}=options;
  const withFinancialLease=async(market:string,work:()=>Promise<void>)=>{
    const lease=db.collection('company_fundamentals').doc(market==='US'?'_worker':'_cn_worker');
    if(!await acquireMaintenanceLease(lease,log.runId))throw Error('Financial maintenance is active');
    try{await work();}finally{await releaseMaintenanceLease(lease,log.runId);}
  };
  const current=async(id:string)=>(await db.collection('companies').doc(id).get()).data()??{};
  const themes=async(id:string)=>{
    const company=await current(id),catalog=await loadThemeCatalog(db),allowed=catalogThemeIds(catalog);
    const ids=activeThemeIds(company).filter(id=>allowed.includes(id));
    if(!ids.length)throw new OnboardingBlocked('Reviewed theme assignment is required');
    for(const id of ids){
      const membership=company.themeMemberships[id];
      if(typeof membership.primarySector!=='string'||!validDay(membership.reviewedAt)||membership.reviewedAt>new Date().toISOString().slice(0,10)||!membership.sources?.length||membership.sources.some((source:{url:string;title:string;summary:string})=>!/^https:\/\//.test(source.url)||!source.title?.trim()||!source.summary?.trim()))throw new OnboardingBlocked('Published themes need reviewed classification evidence');
      const role=membership.primarySector.replace(new RegExp(`^${id}[.:]`),'');
      if(!catalogGraphSectors(catalog,id).some(sector=>sector.id===role||sector.stages.includes(role)||sector.stages.includes(membership.primarySector)))throw new OnboardingBlocked('Theme classification is not in the active catalog');
    }
    return ids;
  };
  const financials=async(request:OnboardingRequest)=>{
    const company=await current(request.companyId),{instrument,cik}=onboardingIdentity(request.companyId,company);
    const data=(await db.collection('company_fundamentals').doc(request.companyId).get()).data();
    const annual=instrument.market==='US'?data?.value:data?.cnAnnual;
    if(!annual||!Array.isArray(annual.metrics)||!annual.metrics.some((metric:{value:unknown})=>typeof metric.value==='number'&&Number.isFinite(metric.value))){
      if(data?.outcome==='unavailable')throw new OnboardingBlocked('Required financial metrics are unavailable');
      throw Error('Required financial metrics are not ready');
    }
    if(cik&&String(annual.report?.cik).padStart(10,'0')!==cik)throw new OnboardingBlocked('Financial report issuer does not match the company');
    if(instrument.market==='CN_A'&&annual.companyId!==request.companyId)throw new OnboardingBlocked('Financial report issuer does not match the company');
    return data!;
  };
  const priceHistory=async(request:OnboardingRequest)=>{
    const {instrument}=onboardingIdentity(request.companyId,await current(request.companyId));
    const receipt=(await db.collection('collectors').doc(`eod-history_${instrument.market}_${instrument.ticker}_${ONBOARDING_START}_${request.targetThrough}`).get()).data();
    if(receipt?.status!=='completed'||receipt.from!==ONBOARDING_START||receipt.through!==request.targetThrough||!receipt.cachePath)throw Error('Historical price receipt is incomplete');
    const expected=`eod-history/${instrument.market}/${encodeURIComponent(instrument.ticker)}/${ONBOARDING_START}_${request.targetThrough}.json`;
    if(receipt.cachePath!==expected)throw Error('Historical price receipt identity mismatch');
    const bars=historyBars(JSON.parse((await bucket.file(expected).download())[0].toString('utf8')),ONBOARDING_START,request.targetThrough);
    return {instrument,bars};
  };
  const ready=async(request:OnboardingRequest,guard:()=>Promise<void>)=>{
    await themes(request.companyId);const financial=await financials(request);
    if(!financial.marketCap||!['estimated','unavailable'].includes(financial.marketCap.status))throw Error('Derived metrics are not ready');
    if(!await options.maintenanceReady())throw new OnboardingBlocked('Regular supported-company maintenance is not enabled');
    const {instrument,bars}=await priceHistory(request);
    for(let i=0;i<bars.length;i+=100){
      await guard();const page=bars.slice(i,i+100),docs=await db.getAll(...page.map(bar=>db.collection('eod_prices').doc(`${instrument.market}_${instrument.ticker}_${bar.date}`)));
      for(let n=0;n<page.length;n++){
        const value=docs[n].data();
        if(!value||value.market!==instrument.market||value.ticker!==instrument.ticker||value.tradingDate!==page[n].date||!Number.isFinite(value.close)||value.close<=0)throw new OnboardingBlocked('Stored price history requires repair');
      }
    }
  };
  return {
    identity:async({request,company,guard})=>{onboardingIdentity(request.companyId,company);await guard();await syncCompanyInstrument(db,request.companyId,company);},
    themes:async({request,guard})=>{
      const catalog=await loadThemeCatalog(db);
      for(const batch of options.themeBatches??[]){
        const companies=batch.companies.filter(row=>row.id===request.companyId);if(!companies.length)continue;
        await guard();
        await db.runTransaction(async tx=>{
          const ref=db.collection('companies').doc(request.companyId),doc=await tx.get(ref);
          const patches=planEnrollment([{...doc.data(),id:doc.id} as ThemedCompany],{...batch,companies},catalog);
          if(patches.length)tx.update(ref,{...patches[0].fields,updatedAt:Timestamp.now()});
        });
      }
      await themes(request.companyId);
    },
    profile:async({request})=>{const company=await current(request.companyId);if(typeof company.description!=='string'||!company.description.trim())throw new OnboardingBlocked('Reviewed company description is required');},
    corporateActions:async({request,guard})=>{
      const {instrument}=onboardingIdentity(request.companyId,await current(request.companyId));
      // Share exclusion with the normal splits worker without advancing its checkpoint.
      const state=db.collection('collectors').doc(`split-history_${instrument.market}_${instrument.ticker}`),owner=log.runId;
      const acquired=await db.runTransaction(async tx=>{const doc=await tx.get(state);if(Number(doc.get('leaseUntil'))>Date.now())return false;tx.set(state,{leaseOwner:owner,leaseUntil:Date.now()+20*60_000},{merge:true});return true;});
      if(!acquired)throw Error('Corporate action synchronization is active');
      try{await backfillOnboardingActions({db,bucket,ticker:instrument.ticker,market:instrument.market,providerSymbol:historyProviderSymbol(instrument.ticker),through:request.targetThrough,token:options.token,guard});}
      finally{await db.runTransaction(async tx=>{if((await tx.get(state)).get('leaseOwner')===owner)tx.set(state,{leaseOwner:null,leaseUntil:0},{merge:true});});}
    },
    prices:async({request,guard})=>{
      const {instrument}=onboardingIdentity(request.companyId,await current(request.companyId));
      await guard();
      const result=await backfillPriceHistory({db,bucket,token:options.token,tickers:[instrument.ticker],from:ONBOARDING_START,through:request.targetThrough,limit:1,writeBatchSize:5,beforeBatch:guard,
        afterBatch:async()=>{await guard();await new Promise<void>(resolve=>setTimeout(resolve,1000));}});
      if(result.failures.length)throw Error('Historical price backfill incomplete');
      const {bars}=await priceHistory(request),last=bars.at(-1)!;
      await guard();await saveLatestEodPrice(db,{ticker:instrument.ticker,market:instrument.market,tradingDate:last.date,close:last.close,currency:instrument.currency,source:'eodhd-eod',loadedAt:new Date().toISOString()});
    },
    fundamentals:async({request,guard})=>{
      await guard();const {instrument,cik}=onboardingIdentity(request.companyId,await current(request.companyId));
      await withFinancialLease(instrument.market,async()=>{
        if(instrument.market==='US')await refreshCompanyFundamentals(instrument.ticker,{db,identify:async()=>cik,log});
        else{const result=await refreshCnAnnual({db,companies:[request.companyId],deadline:Date.now()+120_000,log});if(result.failed||result.deferred)throw Error('A-share annual refresh incomplete');}
      });
      await financials(request);
    },
    metrics:async({request,guard})=>{
      await guard();const {instrument}=onboardingIdentity(request.companyId,await current(request.companyId));
      await withFinancialLease(instrument.market,async()=>{if(instrument.market==='US'){
        const result=await refreshCompanyMarketCaps(db,log,[instrument.ticker]);if(result.failed)throw Error('Market cap calculation failed');
      }else{
        const sources=createCnSources(createCnRequester({context:{runId:log.runId,job:'onboarding',company:request.companyId}}));
        const result=await refreshCnFundamentals({db,companies:[request.companyId],sources,log,deadline:Date.now()+180_000});
        const stored=(await db.collection('company_fundamentals').doc(request.companyId).get()).data();
        if(result.failed||result.sourcesIncomplete||result.actions.failed||result.actions.skipped||result.shares.failed||result.shares.skipped||result.marketCaps.failed||(result.shares.deferred&&stored?.cnShareStatus?.outcome!=='unavailable'))throw Error('A-share metrics incomplete');
      }});
      await financials(request);
    },
    // Published, evidenced theme memberships supply graph entry points. Zero
    // commercial edges is valid; the worker never invents relationships.
    graph:async({request})=>{await themes(request.companyId);},
    events:async({request})=>{await themes(request.companyId);if(!await options.maintenanceReady())throw new OnboardingBlocked('Regular supported-company maintenance is not enabled');},
    verify:async({request,guard})=>ready(request,guard),
  };
}
