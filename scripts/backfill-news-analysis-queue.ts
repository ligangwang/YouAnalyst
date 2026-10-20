import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {FieldPath} from 'firebase-admin/firestore';
import {getFirestore} from '../src/lib/firebase/firestore';
import {newsAnalysisQueueFields} from '../src/lib/intelligence/collectors/news-analysis-queue';
import {setTimeout as delay} from 'node:timers/promises';

// Explicit, bounded history migration. Does not fetch articles or call a model.
async function main(){
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=='--apply'&&!arg.startsWith('--after=')))throw Error('Usage: backfill-news-analysis-queue [--apply] [--after=document-id]');
  if(!process.env.GCP_PROJECT_ID)throw Error('GCP_PROJECT_ID required');
  initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
  const db=getFirestore(),apply=args.includes('--apply');
  let after=args.find(arg=>arg.startsWith('--after='))?.slice(8)??'',scanned=0,changed=0;
  const missing=(row:Record<string,unknown>)=>row.type==='company_news'&&row.sourceType==='company_ir'&&!Number.isFinite(row.newsAnalysisNextCheckAtMs);
  for(let page=0;page<5;page++){
    let query=db.collection('events').orderBy(FieldPath.documentId()).limit(100);
    if(after)query=query.startAfter(after);
    const batch=await query.get();
    for(const doc of batch.docs){
      scanned++;
      if(missing(doc.data())){
        if(apply){
          const written=await db.runTransaction(async tx=>{
            const latest=await tx.get(doc.ref),row=latest.data();
            if(!row||!missing(row))return false;
            tx.update(doc.ref,newsAnalysisQueueFields(row));return true;
          });
          if(written)changed++;
          await delay(50);
        }else changed++;
      }
      after=doc.id;
    }
    console.log(JSON.stringify({job:'backfill-news-analysis-queue',apply,scanned,changed,after,complete:batch.size<100}));
    if(batch.size<100)break;
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
