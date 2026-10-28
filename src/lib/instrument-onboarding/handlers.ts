import {Timestamp,type Firestore} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {loadThemeCatalog} from '../company-themes/catalog';
import {catalogThemeIds} from '../company-themes/catalog-model';
import {catalogGraphSectors} from '../company-themes/catalog-graph';
import {activeThemeIds,type ThemedCompany} from '../company-themes/model';
import {planEnrollment,type EnrollmentBatch} from '../company-themes/enrollment';
import {isSupportedCompany} from '../company-support/model';
import type {Instrument} from '../instruments/model';
import {backfillPriceHistory,historyBars,historyProviderSymbol} from '../predictions/history-backfill';
import {saveLatestEodPrice} from '../predictions/latest-eod';
import type {MaintenanceLog} from '../maintenance-log';
import {ONBOARDING_START,OnboardingBlocked,instrumentOnboardingIdentity,validDay,type OnboardingRequest} from './model';
import type {OnboardingHandlers} from './queue';
import {backfillOnboardingActions,verifyOnboardingActions} from './actions';
import {themeFields,themeVersion,type ThemeClassification} from '../company-themes/classification';
import type {ThemeCatalog} from '../company-themes/catalog-model';
import {LEGACY_NO_THEME_MATCH} from './progress';

/** Adapters use existing provider workers and existing feature storage only. */
export function createOnboardingHandlers(options:{db:Firestore;bucket:Bucket;token:string;log:MaintenanceLog;themeBatches?:EnrollmentBatch[];classify?:(company:ThemedCompany,catalog:ThemeCatalog)=>Promise<ThemeClassification>;maintenanceReady:()=>Promise<boolean>}) :OnboardingHandlers{
  const {db,bucket,log}=options;
  const current=async(id:string)=>(await db.collection('companies').doc(id).get()).data()??{};
  const themes=async(id:string)=>{
    const company=await current(id),catalog=await loadThemeCatalog(db),allowed=catalogThemeIds(catalog);
    const ids=activeThemeIds(company).filter(id=>allowed.includes(id));
    for(const id of ids){
      const membership=company.themeMemberships[id];
      if(typeof membership.primarySector!=='string'||!validDay(membership.reviewedAt)||membership.reviewedAt>new Date().toISOString().slice(0,10)||!membership.sources?.length||membership.sources.some((source:{url:string;title:string;summary:string})=>!/^https:\/\//.test(source.url)||!source.title?.trim()||!source.summary?.trim()))throw new OnboardingBlocked('Published themes need reviewed classification evidence');
      const role=membership.primarySector.replace(new RegExp(`^${id}[.:]`),'');
      if(!catalogGraphSectors(catalog,id).some(sector=>sector.id===role||sector.stages.includes(role)||sector.stages.includes(membership.primarySector)))throw new OnboardingBlocked('Theme classification is not in the active catalog');
    }
    return ids;
  };
  const priceHistory=async(request:OnboardingRequest,record:Instrument)=>{
    const {instrument}=instrumentOnboardingIdentity(record,await current(request.companyId));
    const receipt=(await db.collection('collectors').doc(`eod-history_${instrument.market}_${instrument.ticker}_${ONBOARDING_START}_${request.targetThrough}`).get()).data();
    if(receipt?.status!=='completed'||receipt.from!==ONBOARDING_START||receipt.through!==request.targetThrough||!receipt.cachePath)throw Error('Historical price receipt is incomplete');
    const expected=`eod-history/${instrument.market}/${encodeURIComponent(instrument.ticker)}/${ONBOARDING_START}_${request.targetThrough}.json`;
    if(receipt.cachePath!==expected)throw Error('Historical price receipt identity mismatch');
    const bars=historyBars(JSON.parse((await bucket.file(expected).download())[0].toString('utf8')),ONBOARDING_START,request.targetThrough);
    return {instrument,bars};
  };
  const ready=async(request:OnboardingRequest,record:Instrument,guard:()=>Promise<void>)=>{
    if(!isSupportedCompany(await current(request.companyId)))throw Error('Company is not ready');
    if(!await options.maintenanceReady())throw new OnboardingBlocked('Regular supported-company maintenance is not enabled');
    const {instrument,bars}=await priceHistory(request,record);
    await verifyOnboardingActions({db,bucket,ticker:instrument.ticker,market:instrument.market,providerSymbol:historyProviderSymbol(instrument.ticker),through:request.targetThrough,guard});
    for(let i=0;i<bars.length;i+=100){
      await guard();const page=bars.slice(i,i+100),docs=await db.getAll(...page.map(bar=>db.collection('eod_prices').doc(`${instrument.market}_${instrument.ticker}_${bar.date}`)));
      for(let n=0;n<page.length;n++){
        const value=docs[n].data();
        if(!value||value.market!==instrument.market||value.ticker!==instrument.ticker||value.tradingDate!==page[n].date||!Number.isFinite(value.close)||value.close<=0)throw new OnboardingBlocked('Stored price history requires repair');
      }
    }
  };
  return {
    identity:async({instrument:record,company,guard})=>{instrumentOnboardingIdentity(record,company);await guard();},
    themes:async({request,guard})=>{
      if(isSupportedCompany(await current(request.companyId)))return;
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
      const before=await current(request.companyId);
      if(!activeThemeIds(before).length||!before.description){
        // Older queued no-match outcomes already spent their classification call.
        // Accept that outcome without making another paid request. Explicit
        // resumes also preserve the completed classification checkpoint.
        const priorNoMatch=!activeThemeIds(before).length&&request.lastError===LEGACY_NO_THEME_MATCH;
        if(!options.classify&&!priorNoMatch)throw new OnboardingBlocked('Automatic theme classification is unavailable');
        const beforeVersion=themeVersion(before);
        await guard();
        const result=priorNoMatch?{assignments:[],description:''}:await options.classify!({...before,id:request.companyId},catalog);
        await guard();
        const latestCatalog=await loadThemeCatalog(db);
        await db.runTransaction(async tx=>{
          const ref=db.collection('companies').doc(request.companyId),doc=await tx.get(ref),fresh=doc.data()??{};
          const lease=await tx.get(db.collection('instrument_onboarding_requests').doc(request.instrumentId));
          if(lease.get('leaseOwner')!==request.leaseOwner||Number(lease.get('leaseExpiresAt'))<=Date.now()||lease.get('status')!=='PROCESSING')throw Error('Onboarding lease lost during classification');
          if(themeVersion(fresh)!==beforeVersion)throw Error('Company changed during automatic theme classification; retry with current decisions');
          if(!priorNoMatch&&(typeof result.description!=='string'||!result.description.trim()||result.description.length>4000))throw Error('Official company description required');
          const fields=result.assignments.length?themeFields({...fresh,id:request.companyId},latestCatalog,result.assignments,result.description):result.description.trim()?{description:result.description.trim()}:{};
          if(Object.keys(fields).length)tx.update(ref,{...fields,updatedAt:Timestamp.now()});
        });
      }
      await themes(request.companyId);
    },
    profile:async({request})=>{const company=await current(request.companyId);if(typeof company.name!=='string'||!company.name.trim())throw new OnboardingBlocked('Company name is required');},
    corporateActions:async({request,instrument:record,guard})=>{
      const {instrument}=instrumentOnboardingIdentity(record,await current(request.companyId));
      // Share exclusion with the normal splits worker without advancing its checkpoint.
      const state=db.collection('collectors').doc(`split-history_${instrument.market}_${instrument.ticker}`),owner=log.runId;
      const acquired=await db.runTransaction(async tx=>{const doc=await tx.get(state);if(Number(doc.get('leaseUntil'))>Date.now())return false;tx.set(state,{leaseOwner:owner,leaseUntil:Date.now()+20*60_000},{merge:true});return true;});
      if(!acquired)throw Error('Corporate action synchronization is active');
      try{await backfillOnboardingActions({db,bucket,ticker:instrument.ticker,market:instrument.market,providerSymbol:historyProviderSymbol(instrument.ticker),through:request.targetThrough,token:options.token,guard});}
      finally{await db.runTransaction(async tx=>{if((await tx.get(state)).get('leaseOwner')===owner)tx.set(state,{leaseOwner:null,leaseUntil:0},{merge:true});});}
    },
    prices:async({request,instrument:record,guard})=>{
      const {instrument}=instrumentOnboardingIdentity(record,await current(request.companyId));
      await guard();
      const result=await backfillPriceHistory({db,bucket,token:options.token,tickers:[instrument.ticker],from:ONBOARDING_START,through:request.targetThrough,limit:1,writeBatchSize:1500,beforeBatch:guard,
        afterBatch:async()=>{await guard();await new Promise<void>(resolve=>setTimeout(resolve,1000));}});
      if(result.failures.length)throw Error('Historical price backfill incomplete');
      const {bars}=await priceHistory(request,record),last=bars.at(-1)!;
      await guard();await saveLatestEodPrice(db,{ticker:instrument.ticker,market:instrument.market,tradingDate:last.date,close:last.close,currency:instrument.currency,source:'eodhd-eod',loadedAt:new Date().toISOString()});
    },
    events:async({request})=>{
      if(isSupportedCompany(await current(request.companyId)))return;
      await themes(request.companyId);
      if(!await options.maintenanceReady())throw new OnboardingBlocked('Regular supported-company maintenance is not enabled');
    },
    verify:async({request,instrument:record,guard})=>ready(request,record,guard),
  };
}
