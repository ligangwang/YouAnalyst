import {markFeedChanged} from '../intelligence/feed-cache-changes';
import {FieldPath,type Firestore} from 'firebase-admin/firestore';
import {EVENTS_COLLECTION} from './model';
import {EVENT_CLASSIFICATION_VERSION,classifyEvent} from './classification';
import {parseInsiderTransactions} from './insider-transactions';
import {secRequest} from '../sec-request';
export function ownershipXmlUrl(raw:unknown):string{
 if(typeof raw!=='string')throw new Error('Missing ownership URL');
 const url=new URL(raw);
 if(url.protocol!=='https:'||url.hostname!=='www.sec.gov'||url.username||url.password||url.port||url.search||url.hash||!/^\/Archives\/edgar\/data\/\d+\/\d{18}\/(?:xsl[A-Za-z0-9]+\/)?[\w.-]+\.xml$/.test(url.pathname))throw new Error('Invalid ownership URL');
 url.pathname=url.pathname.replace(/\/xsl[A-Za-z0-9]+\//,'/');return url.toString();
}
export async function fetchOwnershipXml(url:string){
 const agent=process.env.SEC_USER_AGENT;
 if(!agent)throw new Error('SEC_USER_AGENT is required');
 return secRequest(ownershipXmlUrl(url),{headers:{'User-Agent':agent,Accept:'application/xml,text/xml'},signal:AbortSignal.timeout(15_000)},async response=>{
  const reader=response.body?.getReader();if(!reader)throw new Error('Empty ownership response');
  const chunks:Uint8Array[]=[];let bytes=0;
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>2_000_000)throw new Error('Ownership XML too large');chunks.push(part.value);}}finally{await reader.cancel();}
  return Buffer.concat(chunks).toString('utf8');
 });
}
/** Add classification fields only to existing source documents. Dry-run has no writes. */
export async function backfillEventClassifications(db:Firestore,options:{apply:boolean;enrichInsiders?:boolean;deadline?:number;maxPages?:number;after?:string;pendingOnly?:boolean;scheduled?:boolean;download?:(url:string)=>Promise<string>;onProgress?:(result:Record<string,unknown>)=>void}){
 const result={scanned:0,eligible:0,updated:0,alreadyClassified:0,insiders:0,enriched:0,failed:0,complete:false,cursor:options.after??'',counts:{} as Record<string,number>};
 const checkpoint=db.collection('collectors').doc('event-classification-v1');
 for(let page=0;page<(options.maxPages??500);page++){
  if(Date.now()+20_000> (options.deadline??Infinity))break;
  const base=db.collection(EVENTS_COLLECTION);
  let query=(options.pendingOnly?base.where('insiderEnrichmentPending','==',true):base).orderBy(FieldPath.documentId()).limit(100);
  if(result.cursor)query=query.startAfter(result.cursor);
  const docs=await query.get();
  for(const doc of docs.docs){
   if(Date.now()+20_000>(options.deadline??Infinity))break;
   result.scanned++;
   const row=doc.data();
   if(!['company_news','company_disclosure'].includes(row.type)){result.cursor=doc.id;continue;}
   result.eligible++;
   if(Number(row.eventClassification?.version)>EVENT_CLASSIFICATION_VERSION){result.alreadyClassified++;result.cursor=doc.id;continue;}
   const current=row.eventClassification?.version===EVENT_CLASSIFICATION_VERSION;
   const classification=classifyEvent(row);
   result.counts[classification.eventType]=(result.counts[classification.eventType]??0)+1;
   let patch:Record<string,unknown>=current?{}:{...classification};
   if(current)result.alreadyClassified++;
   const insider=row.sourceType==='sec'&&/^(4|5)(\/A)?$/.test(String(row.form));
   if(insider){
    result.insiders++;
    const pending=row.insiderClassification?.version!==EVENT_CLASSIFICATION_VERSION;
    if(row.insiderEnrichmentPending!==pending)patch.insiderEnrichmentPending=pending;
   }
   if(options.enrichInsiders&&insider&&row.insiderClassification?.version!==EVENT_CLASSIFICATION_VERSION){
    try{
     const xml=await (options.download??fetchOwnershipXml)(ownershipXmlUrl(row.url));
     const groups=parseInsiderTransactions(xml,row.companyId);
     patch={...patch,insiderEventGroups:groups,insiderClassification:{version:EVENT_CLASSIFICATION_VERSION,status:'complete'}};
     if(groups.length){const types=new Set(groups.map(group=>group.eventSubtype));patch={...patch,...classification,eventSubtype:types.size===1?groups[0].eventSubtype:'insider_mixed',eventClassification:{version:1,method:'parser',rule:'sec.ownership.transaction_code',evidence:[...new Set(groups.flatMap(group=>group.eventClassification.evidence))].slice(0,3)}};}
     patch.insiderEnrichmentPending=false;
     result.enriched++;
    }catch{result.failed++; /* Keep broad ownership classification; never guess buy or sell. */}
   }
   if(Object.keys(patch).length){
    const written=!options.apply||await db.runTransaction(async tx=>{const latest=await tx.get(doc.ref);if(!latest.exists||Number(latest.get('eventClassification')?.version)>EVENT_CLASSIFICATION_VERSION||latest.get('url')!==row.url||latest.get('title')!==row.title||latest.get('form')!==row.form)return false;tx.update(doc.ref,patch);markFeedChanged(db,tx,doc.ref);return true;});
    if(written)result.updated++;
   }
   result.cursor=doc.id;
  }
  if(result.cursor===docs.docs.at(-1)?.id&&docs.size<100||docs.empty){result.complete=true;}
  if(options.apply)await checkpoint.set({version:EVENT_CLASSIFICATION_VERSION,afterEventId:result.complete?'':result.cursor,lastRunAt:new Date().toISOString(),result,...(options.scheduled?(options.pendingOnly?{pendingAfterEventId:result.complete?'':result.cursor}:{bootstrapAfterEventId:result.complete?'':result.cursor,...(result.complete?{bootstrapVersion:EVENT_CLASSIFICATION_VERSION}:{})}):{})},{merge:true});
  options.onProgress?.({...result});
  if(result.complete)break;
 }
 return result;
}

/** Complete the historical migration once; new disclosures enqueue enrichment at ingestion. */
export async function runScheduledClassifications(db:Firestore,options:{enrichInsiders:boolean;deadline:number;maxPages?:number;download?:(url:string)=>Promise<string>}){
 const state=(await db.collection('collectors').doc('event-classification-v1').get()).data();
 const pendingOnly=state?.bootstrapVersion===EVENT_CLASSIFICATION_VERSION;
 return backfillEventClassifications(db,{...options,apply:true,scheduled:true,pendingOnly,
  after:String((pendingOnly?state?.pendingAfterEventId:state?.bootstrapAfterEventId)??'')});
}
