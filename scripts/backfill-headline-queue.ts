import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {FieldPath} from 'firebase-admin/firestore';
import {getFirestore} from '../src/lib/firebase/firestore';
import {headlineQueueFields} from '../src/lib/intelligence/collectors/headline-queue';
import {setTimeout as delay} from 'node:timers/promises';

// Bounded, resumable migration. No provider calls, and dry-run is the default.
async function main(){
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=='--apply'&&!arg.startsWith('--after=')))throw Error('Usage: backfill-headline-queue [--apply] [--after=document-id]');
  if(!process.env.GCP_PROJECT_ID)throw Error('GCP_PROJECT_ID required');
  initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
  const db=getFirestore(),apply=args.includes('--apply');
  let after=args.find(arg=>arg.startsWith('--after='))?.slice(8)??'',scanned=0,changed=0;
  for(let page=0;page<5;page++){
    let query=db.collection('events').orderBy(FieldPath.documentId()).limit(100);
    if(after)query=query.startAfter(after);
    const batch=await query.get();
    for(const doc of batch.docs){
      scanned++;
      const candidate=(row:Record<string,unknown>)=>row.type==='company_news'&&row.sourceType==='company_ir'||row.type==='company_disclosure'&&row.sourceType==='exchange';
      if(candidate(doc.data())){
        const update=async()=>db.runTransaction(async tx=>{
          const latest=await tx.get(doc.ref),row=latest.data();
          if(!row||!candidate(row))return false;
          const fields=headlineQueueFields(row);
          if(Object.entries(fields).every(([key,value])=>row[key]===value))return false;
          tx.update(doc.ref,fields);return true;
        });
        if(apply){if(await update())changed++;await delay(50);}
        else if(Object.entries(headlineQueueFields(doc.data())).some(([key,value])=>doc.get(key)!==value))changed++;
      }
      after=doc.id;
    }
    console.log(JSON.stringify({job:'backfill-headline-queue',apply,scanned,changed,after,complete:batch.size<100}));
    if(batch.size<100)break;
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
