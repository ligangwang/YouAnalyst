import type {Firestore} from 'firebase-admin/firestore';
import type {SecRawSubmissionsObserver} from '../sec-filings/source';
import {secDisclosureRows} from './disclosures';
import {saveDisclosures,DISCLOSURE_HISTORY_START} from './disclosure-store';

export const SEC_LINK_COVERAGE_VERSION=2;
type LinkScan={version:number;from:string;through:string;after:string;baseline:boolean};
const day=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function pendingScan(value:unknown):LinkScan|null {
  const scan=value as Partial<LinkScan>|null;
  return scan?.version===SEC_LINK_COVERAGE_VERSION&&day(scan.from)&&day(scan.through)&&scan.from<=scan.through
    &&typeof scan.after==='string'&&(scan.after===''||/^\d{4}-\d{2}-\d{2}\|\d{10}-\d{2}-\d{6}$/.test(scan.after)&&day(scan.after.slice(0,10))&&scan.after.slice(0,10)>=scan.from&&scan.after.slice(0,10)<=scan.through)
    &&typeof scan.baseline==='boolean'?scan as LinkScan:null;
}

/** Observes the existing SEC transport and cache; never creates a second poller. */
export function createMapSecObserver(db:Firestore,companiesByCik:Map<string,string[]>,options:{deadline:number;now?:()=>number;maxRowsPerCompany?:number}){
  const now=options.now??Date.now,observed=new Set<string>(),completedCompanies=new Set<string>(),failed=new Set<string>();
  const maxRows=options.maxRowsPerCompany??1000;
  if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>10000)throw new Error('Invalid SEC disclosure row budget');
  const observe:SecRawSubmissionsObserver=async(cik,payload,archive)=>{
    if(!companiesByCik.has(cik))return;
    for(const companyId of companiesByCik.get(cik)!){
      if(completedCompanies.has(companyId))continue;
      failed.add(companyId);
      const ref=db.collection('collectors').doc(`sec-${companyId}`),at=new Date(now()).toISOString();
      try{
        const state=(await ref.get()).data();
        // Widened form coverage must revisit history even for already-initialized issuers.
        const upgrading=state?.linkCoverageVersion!==SEC_LINK_COVERAGE_VERSION||state?.cik!==cik;
        const scan=(state?.cik===cik?pendingScan(state?.linkScan):null)??{version:SEC_LINK_COVERAGE_VERSION,
          from:!upgrading&&state?.lastCompleteAt?new Date(Math.max(Date.parse(DISCLOSURE_HISTORY_START),Date.parse(state.lastCompleteAt)-7*86400000)).toISOString().slice(0,10):DISCLOSURE_HISTORY_START,
          through:at.slice(0,10),after:'',baseline:upgrading||!state?.lastCompleteAt};
        const from=scan.after?scan.after.slice(0,10):scan.from;
        const rows=secDisclosureRows(companyId,cik,payload);
        const raw=payload as {filings:{files:Array<{name:string;filingFrom:string;filingTo:string}>}};
        if(!Array.isArray(raw.filings.files)||raw.filings.files.some(file=>!day(file.filingFrom)||!day(file.filingTo)||file.filingFrom>file.filingTo))throw new Error('Invalid SEC disclosure archives');
        const files=raw.filings.files.filter(file=>file.filingTo>=from&&file.filingFrom<=scan.through);
        if(files.length>20)throw new Error('SEC disclosure archive budget exceeded');
        for(const file of files){
          if(now()+30_000>=options.deadline)throw new Error('SEC disclosure archive deadline reached');
          if(!new RegExp(`^CIK${cik}-submissions-\\d+\\.json$`).test(file.name))throw new Error('Unsafe SEC archive');
          rows.push(...secDisclosureRows(companyId,cik,{cik,filings:{recent:await archive(file.name)}}));
        }
        const key=(row:typeof rows[number])=>`${row.publication_date}|${row.accession}`;
        const unique=new Map<string,typeof rows[number]>();
        for(const row of rows){
          const previous=unique.get(row.id);
          if(previous&&JSON.stringify(previous)!==JSON.stringify(row))throw new Error('Conflicting SEC disclosure accession across archives');
          unique.set(row.id,row);
        }
        const candidates=[...unique.values()]
          .filter(row=>row.publication_date!>=scan.from&&row.publication_date!<=scan.through&&key(row)>scan.after)
          .sort((a,b)=>key(a).localeCompare(key(b)));
        let created=0,processed=0;
        for(let start=0;start<candidates.length&&processed<maxRows;start+=100){
          if(now()+30_000>=options.deadline)throw new Error('SEC disclosure persistence deadline reached');
          const batch=candidates.slice(start,Math.min(start+100,maxRows));
          created+=await saveDisclosures(db,batch,at,scan.baseline);processed+=batch.length;
          scan.after=key(batch.at(-1)!);
          // Save progress only after the event batch commits. Replaying a failed checkpoint is idempotent.
          await ref.set({companyId,cik,sourceType:'sec',status:'partial',linkScan:scan,lastAttemptAt:at},{merge:true});
        }
        if(processed<candidates.length)throw new Error('SEC disclosure row budget reached; scan will resume');
        // A resumed scan only establishes coverage through its original boundary.
        const completeAt=scan.through===at.slice(0,10)?at:`${scan.through}T23:59:59.999Z`;
        await ref.set({companyId,cik,sourceType:'sec',status:'complete',linkCoverageVersion:SEC_LINK_COVERAGE_VERSION,linkScan:null,lastCompleteAt:completeAt,lastSuccessAt:at,documents:processed,created,from:scan.from,lastError:null,revision:process.env.GIT_SHA??'local'},{merge:true});
        failed.delete(companyId);
        completedCompanies.add(companyId);
      }catch(error){failed.add(companyId);await ref.set({companyId,cik,sourceType:'sec',status:'partial',lastAttemptAt:at,lastError:error instanceof Error?error.message:'SEC disclosure scan failed'},{merge:true});}
    }
    observed.add(cik);
  };
  return {observe,observed,failed};
}
