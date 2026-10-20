import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {FieldPath,getFirestore} from 'firebase-admin/firestore';
import {calendarCandidate,calendarQueueFields} from '../src/lib/calendar/queue';
import {newsAnalysisQueueFields} from '../src/lib/intelligence/collectors/news-analysis-queue';

// Release-only additive migration; no provider calls, deletions, or queue resets.
async function main(){
  const args=process.argv.slice(2),apply=args.includes('--apply'),finalize=args.includes('--finalize');
  assert(args.every(arg=>['--apply','--finalize'].includes(arg)),'Unknown argument');
  const project=process.env.GCP_PROJECT_ID;assert(project,'GCP_PROJECT_ID required');
  const command=process.platform==='win32'?'gcloud.cmd':'gcloud';
  const token=()=>execFileSync(command,['auth','print-access-token'],{encoding:'utf8',shell:process.platform==='win32'}).trim();
  initializeApp({projectId:project,credential:applicationDefault()});
  const db=getFirestore(),marker=db.collection('collectors').doc('_read_optimization_migration_v1');
  if((await marker.get()).get('complete')===true){console.log('Read optimization migration already complete');return;}
  const started=new Date().toISOString();let scanned=0,writes=0;
  async function guard(){
    const response=await fetch('https://logging.googleapis.com/v2/entries:list',{method:'POST',headers:{Authorization:`Bearer ${token()}`,'Content-Type':'application/json'},body:JSON.stringify({resourceNames:[`projects/${project}`],filter:`resource.type="cloud_run_revision" AND resource.labels.service_name="ifindata-web" AND timestamp>="${started}" AND (httpRequest.status>=500 OR textPayload:"Memory limit" OR textPayload:"RESOURCE_EXHAUSTED")`,pageSize:1}),signal:AbortSignal.timeout(30000)});
    assert(response.ok,`Unable to check migration safety (${response.status})`);
    assert(!(await response.json()).entries?.length,'Website errors detected; stopped migration before next batch');
  }
  async function scan(collection:string,projectFields:(id:string,row:Record<string,unknown>)=>{path:string;fields:Record<string,unknown>}|null){
    let after='';
    for(let page=0;page<1000;page++){
      if(apply)await guard();
      let query=db.collection(collection).orderBy(FieldPath.documentId()).limit(100);
      if(after)query=query.startAfter(after);
      const docs=await query.get();
      for(const doc of docs.docs){
        scanned++;const change=projectFields(doc.id,doc.data());if(!change)continue;
        if(apply){
          const written=await db.runTransaction(async tx=>{
            const fresh=await tx.get(doc.ref);if(!fresh.exists)return false;
            const current=projectFields(doc.id,fresh.data()!);if(!current)return false;
            const target=db.doc(current.path);
            if(target.path!==doc.ref.path&&(await tx.get(target)).exists)return false;
            tx.set(target,current.fields,{merge:true});return true;
          });
          if(written){writes++;await delay(250);}
        }else writes++;
      }
      after=docs.docs.at(-1)?.id??after;
      console.log(JSON.stringify({collection,scanned,writes,apply,after}));
      if(docs.size<100)return;
    }
    throw Error('Migration scan bound reached; do not enable consumers');
  }
  await scan('events',(id,row)=>{
    const fields:Record<string,unknown>={};
    if(calendarCandidate(row)&&!Number.isFinite(row.calendarNextCheckAtMs))Object.assign(fields,calendarQueueFields(row));
    if(row.type==='company_news'&&row.sourceType==='company_ir'&&!Number.isFinite(row.newsAnalysisNextCheckAtMs))Object.assign(fields,newsAnalysisQueueFields(row));
    return Object.keys(fields).length?{path:`events/${id}`,fields}:null;
  });
  await scan('collectors',(id,row)=>{
    if(id.startsWith('sec-US:')&&typeof row.cik==='string')return {path:`collectors/sec-identity-${id.slice(4)}`,fields:{companyId:id.slice(4),cik:row.cik}};
    if(row.sourceId===id&&row.version===1)return {path:`collectors/news-health-${id}`,fields:{lastSuccessAt:row.lastSuccessAt??null,failures:row.failures??0,partial:row.partial??false}};
    return null;
  });
  await scan('sec_collector_state',(id,row)=>{
    if(id!=='_sec_filings_collector')return null;
    const result=(row.result??{}) as Record<string,unknown>;
    return {path:'sec_collector_state/_website_freshness',fields:{lastRunAt:row.lastRunAt??null,result:{failed:result.failed??0,partial:result.partial??false,remaining:result.remaining??0,outboxIncomplete:result.outboxIncomplete??false}}};
  });
  for(const field of ['calendarNextCheckAtMs','newsAnalysisNextCheckAtMs'])await db.collection('events').where(field,'<=',Date.now()).orderBy(field).limit(1).get();
  if(apply){await guard();if(finalize)await marker.set({complete:true,completedAt:new Date().toISOString()});}
  console.log(JSON.stringify({complete:true,finalize,apply,scanned,writes}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
