import {createHash} from 'node:crypto';
import type {Firestore} from 'firebase-admin/firestore';
import {collectNewsSources,type NewsCursor,type NewsStore} from './collector';
import {fetchNews} from './news';
import {approvedCompanyNewsSources,type NewsSource} from './sources';
import {firestoreNewsStore,NEWS_COLLECTORS_COLLECTION} from './store';

export const NEWS_REQUEST_TOPIC='news-source-requests';
export const NEWS_SUBSCRIPTION='news-source-worker';
export type NewsRequest={version:1;type:'news.source.collect.requested';batchId:string;sourceId:string;companyId:string;requestedAt:string};

export function parseNewsRequest(input:unknown):NewsRequest{
  const row=input as Partial<NewsRequest>|null;
  if(!row||row.version!==1||row.type!=='news.source.collect.requested'
    ||typeof row.batchId!=='string'||!/^news_[a-f0-9]{64}$/.test(row.batchId)
    ||typeof row.sourceId!=='string'||! /^[a-z0-9][a-z0-9-]{1,79}$/.test(row.sourceId)
    ||typeof row.companyId!=='string'||! /^[A-Za-z0-9][A-Za-z0-9:._-]{0,99}$/.test(row.companyId)
    ||typeof row.requestedAt!=='string'||!Number.isFinite(Date.parse(row.requestedAt)))throw new Error('Invalid news source request');
  return {version:1,type:row.type,batchId:row.batchId,sourceId:row.sourceId,companyId:row.companyId,requestedAt:row.requestedAt};
}

/** Read-only publisher: only the worker takes a source lease or advances its cursor. */
export async function publishNewsRequests(sources:readonly NewsSource[],publish:(request:NewsRequest)=>Promise<unknown>,options:{
  execution:string;now?:()=>number;deadline?:number;readCursor:(sourceId:string)=>Promise<Partial<NewsCursor>|undefined>;
}){
  const requestedAt=new Date((options.now??Date.now)()).toISOString();
  const result={requested:0,skipped:0,deferred:0,failed:0,errors:[] as Array<{sourceId:string;error:string}>,mode:'pubsub' as const};
  let next=0;
  await Promise.all(Array.from({length:Math.min(8,sources.length)},async()=>{while(next<sources.length){
    const source=sources[next++];
    if(options.deadline!==undefined&&(options.now??Date.now)()+30_000>=options.deadline){result.deferred++;continue;}
    try{
      const cursor=await options.readCursor(source.id),now=(options.now??Date.now)();
      if(cursor&&(Date.parse(cursor.nextPollAt??'')>now||Date.parse(cursor.leaseUntil??'')>now)){result.skipped++;continue;}
      const batchId='news_'+createHash('sha256').update(JSON.stringify([options.execution,source.id])).digest('hex');
      await publish(parseNewsRequest({version:1,type:'news.source.collect.requested',batchId,sourceId:source.id,companyId:source.companyId,requestedAt}));
      result.requested++;
    }catch(error){result.failed++;if(result.errors.length<20)result.errors.push({sourceId:source.id,error:(error instanceof Error?error.message:'Publication failed').slice(0,300)});}
  }}));
  return result;
}

export function readNewsCursor(db:Firestore,sourceId:string){
  return db.collection(NEWS_COLLECTORS_COLLECTION).doc(sourceId).get().then(doc=>doc.data() as NewsCursor|undefined);
}

export async function loadRequestedNewsSource(db:Firestore,request:NewsRequest){
  const doc=await db.collection('companies').doc(request.companyId).get();
  return approvedCompanyNewsSources(doc.exists?[{...doc.data(),id:doc.id}]:[]).find(source=>source.id===request.sourceId);
}

/** At-least-once delivery reuses the source's existing success marker and lease. */
export async function processNewsRequest(input:unknown,db:Firestore,options:{
  enabled:boolean;now?:()=>number;source?:(request:NewsRequest)=>Promise<NewsSource|undefined>;
  readCursor?:(sourceId:string)=>Promise<Partial<NewsCursor>|undefined>;store?:NewsStore;read?:typeof fetchNews;
}){
  const request=parseNewsRequest(input);
  if(!options.enabled)throw new Error('News worker disabled; retain request for retry');
  const source=await (options.source??(request=>loadRequestedNewsSource(db,request)))(request);
  if(!source)return {status:'ineligible',sourceId:request.sourceId};
  if(source.companyId!==request.companyId||source.id!==request.sourceId)throw new Error('News source identity mismatch');
  const cursor=await (options.readCursor??(id=>readNewsCursor(db,id)))(source.id);
  if(cursor&&Date.parse(cursor.lastSuccessAt??'')>=Date.parse(request.requestedAt))return {sourceId:source.id,duplicate:true};
  const now=options.now??Date.now;
  if(cursor&&Date.parse(cursor.leaseUntil??'')>now())throw new Error('News source busy; retry');
  if(cursor&&Date.parse(cursor.nextPollAt??'')>now()){
    if(cursor.lastError)throw new Error('News source cooling down; retry');
    return {sourceId:source.id,notDue:true};
  }
  const [result]=await collectNewsSources([source],options.store??firestoreNewsStore(db),options.read??fetchNews,()=>new Date(now()));
  // A concurrent delivery may win the lease between the read and acquisition.
  if(result.status!=='ok')throw new Error(result.error??'News source busy; retry');
  return {...result,status:'verified' as const};
}
