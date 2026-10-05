import type {Firestore} from 'firebase-admin/firestore';
import type {SecRawSubmissionsObserver} from '../sec-filings/source';
import {secDisclosureRows,type Disclosure} from './disclosures';
import {saveDisclosures,DISCLOSURE_HISTORY_START} from './disclosure-store';

export const SEC_LINK_COVERAGE_VERSION=2;
type LinkScan={version:number;from:string;through:string;startedAt:string;baseline:boolean;recentComplete:boolean;recentAfter:string;completedArchives:string[];archiveAfter:{name:string;after:string}|null;documents:number;created:number};
const day=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const archiveName=(value:unknown,cik:string):value is string=>typeof value==='string'&&new RegExp(`^CIK${cik}-submissions-\\d+\\.json$`).test(value);
function pendingScan(value:unknown,cik:string):LinkScan|null {
  const scan=value as Partial<LinkScan>|null;
  if(scan?.version!==SEC_LINK_COVERAGE_VERSION||!day(scan.from)||!day(scan.through)||scan.from>scan.through)return null;
  if(typeof scan.startedAt!=='string'||!Number.isFinite(Date.parse(scan.startedAt))||new Date(scan.startedAt).toISOString()!==scan.startedAt||scan.startedAt.slice(0,10)!==scan.through)return null;
  const cursor=(value:unknown)=>typeof value==='string'&&(value===''||/^\d{4}-\d{2}-\d{2}\|\d{10}-\d{2}-\d{6}$/.test(value)&&day(value.slice(0,10))&&value.slice(0,10)>=scan.from!&&value.slice(0,10)<=scan.through!);
  return typeof scan.baseline==='boolean'&&typeof scan.recentComplete==='boolean'&&cursor(scan.recentAfter)
    &&Array.isArray(scan.completedArchives)&&scan.completedArchives.every(name=>archiveName(name,cik))
    &&(scan.archiveAfter===null||archiveName(scan.archiveAfter?.name,cik)&&cursor(scan.archiveAfter?.after))
    &&Number.isSafeInteger(scan.documents)&&scan.documents!>=0&&Number.isSafeInteger(scan.created)&&scan.created!>=0?scan as LinkScan:null;
}

/** Observes the existing SEC transport and cache; never creates a second poller. */
export function createMapSecObserver(db:Firestore,companiesByCik:Map<string,string[]>,options:{deadline:number;now?:()=>number;maxRowsPerCompany?:number;maxArchivesPerCompany?:number}){
  const now=options.now??Date.now,observed=new Set<string>(),completedCompanies=new Set<string>(),failed=new Set<string>();
  const maxRows=options.maxRowsPerCompany??1000,maxArchives=options.maxArchivesPerCompany??5;
  if(!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>10000||!Number.isSafeInteger(maxArchives)||maxArchives<1||maxArchives>20)throw new Error('Invalid SEC disclosure budget');
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
        const scan=(state?.cik===cik?pendingScan(state?.linkScan,cik):null)??{version:SEC_LINK_COVERAGE_VERSION,
          from:!upgrading&&state?.lastCompleteAt?new Date(Math.max(Date.parse(DISCLOSURE_HISTORY_START),Date.parse(state.lastCompleteAt)-7*86400000)).toISOString().slice(0,10):DISCLOSURE_HISTORY_START,
          through:at.slice(0,10),startedAt:at,baseline:upgrading||!state?.lastCompleteAt,recentComplete:false,recentAfter:'',completedArchives:[],archiveAfter:null,documents:0,created:0};
        const raw=payload as {cik:unknown;filings:{files:Array<{name:string;filingFrom:string;filingTo:string}>}};
        if(Number(raw?.cik)!==Number(cik))throw new Error('SEC disclosure issuer mismatch');
        if(!Array.isArray(raw.filings?.files)||raw.filings.files.some(file=>!archiveName(file.name,cik)||!day(file.filingFrom)||!day(file.filingTo)||file.filingFrom>file.filingTo))throw new Error('Invalid SEC disclosure archives');
        const files=raw.filings.files.filter(file=>file.filingTo>=scan.from&&file.filingFrom<=scan.through);
        let processed=0;
        const progress=()=>ref.set({companyId,cik,sourceType:'sec',status:'partial',linkScan:scan,lastAttemptAt:at},{merge:true});
        const canWork=()=>now()+30_000<options.deadline;
        const persist=async(rows:Disclosure[],after:string,checkpoint:(key:string)=>void)=>{
          const key=(row:Disclosure)=>`${row.publication_date}|${row.accession}`;
          const candidates=rows.filter(row=>row.publication_date!>=scan.from&&row.publication_date!<=scan.through&&key(row)>after)
            .sort((a,b)=>key(a).localeCompare(key(b)));
          for(let start=0;start<candidates.length;){
            if(!canWork())throw new Error('SEC disclosure persistence deadline reached');
            if(processed>=maxRows)throw new Error('SEC disclosure row budget reached; scan will resume');
            const batch=candidates.slice(start,start+Math.min(100,maxRows-processed));
            const created=await saveDisclosures(db,batch,at,scan.baseline);
            processed+=batch.length;start+=batch.length;scan.documents+=batch.length;scan.created+=created;
            checkpoint(key(batch.at(-1)!));
            // Save progress only after the event batch commits. Replaying a failed checkpoint is idempotent.
            await progress();
          }
        };
        if(!scan.recentComplete){
          await persist(secDisclosureRows(companyId,cik,payload),scan.recentAfter,key=>{scan.recentAfter=key;});
          scan.recentComplete=true;await progress();
        }
        let fetched=0;
        for(const file of files){
          if(scan.completedArchives.includes(file.name))continue;
          if(!canWork())throw new Error('SEC disclosure archive deadline reached');
          if(fetched>=maxArchives)throw new Error('SEC disclosure archive budget reached; scan will resume');
          fetched++;
          const after=scan.archiveAfter?.name===file.name?scan.archiveAfter.after:'';
          await persist(secDisclosureRows(companyId,cik,{cik,filings:{recent:await archive(file.name)}}),after,key=>{scan.archiveAfter={name:file.name,after:key};});
          scan.completedArchives.push(file.name);scan.archiveAfter=null;await progress();
        }
        // Resumed scans only establish coverage through their original start, not the eventual completion time.
        await ref.set({companyId,cik,sourceType:'sec',status:'complete',linkCoverageVersion:SEC_LINK_COVERAGE_VERSION,linkScan:null,lastCompleteAt:scan.startedAt,lastSuccessAt:at,documents:scan.documents,created:scan.created,from:scan.from,lastError:null,revision:process.env.GIT_SHA??'local'},{merge:true});
        failed.delete(companyId);completedCompanies.add(companyId);
      }catch(error){failed.add(companyId);await ref.set({companyId,cik,sourceType:'sec',status:'partial',lastAttemptAt:at,lastError:error instanceof Error?error.message:'SEC disclosure scan failed'},{merge:true});}
    }
    observed.add(cik);
  };
  return {observe,observed,failed};
}
