import type {Firestore} from 'firebase-admin/firestore';
import type {SecRawSubmissionsObserver} from '../sec-filings/source';
import {secDisclosureRows} from './disclosures';
import {saveDisclosures,DISCLOSURE_HISTORY_START} from './disclosure-store';

/** Observes the existing SEC transport and cache; never creates a second poller. */
export function createMapSecObserver(db:Firestore,companiesByCik:Map<string,string[]>,options:{deadline:number;now?:()=>number}){
  const now=options.now??Date.now,observed=new Set<string>(),completedCompanies=new Set<string>(),failed=new Set<string>();
  const observe:SecRawSubmissionsObserver=async(cik,payload,archive)=>{
    if(!companiesByCik.has(cik))return;
    for(const companyId of companiesByCik.get(cik)!){
      if(completedCompanies.has(companyId))continue;
      failed.add(companyId);
      const ref=db.collection('collectors').doc(`sec-${companyId}`),at=new Date(now()).toISOString();
      try{
        const state=(await ref.get()).data();
        const from=state?.lastCompleteAt?new Date(Date.parse(state.lastCompleteAt)-7*86400000).toISOString().slice(0,10):DISCLOSURE_HISTORY_START;
        const rows=secDisclosureRows(companyId,cik,payload);
        const raw=payload as {filings:{files:Array<{name:string;filingFrom:string;filingTo:string}>}};
        const files=raw.filings.files.filter(file=>file.filingTo>=from);
        if(files.length>5)throw new Error('SEC disclosure archive budget exceeded');
        for(const file of files){
          if(now()+30_000>=options.deadline)throw new Error('SEC disclosure archive deadline reached');
          if(!new RegExp(`^CIK${cik}-submissions-\\d+\\.json$`).test(file.name))throw new Error('Unsafe SEC archive');
          rows.push(...secDisclosureRows(companyId,cik,{cik,filings:{recent:await archive(file.name)}}));
        }
        const candidates=rows.filter(row=>row.publication_date!>=from&&row.publication_date!<=at.slice(0,10));
        if(candidates.length>1000)throw new Error('SEC disclosure event budget exceeded');
        const created=await saveDisclosures(db,candidates,at,!state?.lastCompleteAt);
        await ref.set({companyId,cik,sourceType:'sec',status:'complete',lastCompleteAt:at,lastSuccessAt:at,documents:candidates.length,created,from,lastError:null,revision:process.env.GIT_SHA??'local'},{merge:true});
        failed.delete(companyId);
        completedCompanies.add(companyId);
      }catch(error){failed.add(companyId);await ref.set({companyId,cik,sourceType:'sec',status:'partial',lastAttemptAt:at,lastError:error instanceof Error?error.message:'SEC disclosure scan failed'},{merge:true});}
    }
    observed.add(cik);
  };
  return {observe,observed,failed};
}
