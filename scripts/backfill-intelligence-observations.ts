import { FieldPath } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../src/lib/firebase/admin';
import { SEC_FILINGS_COLLECTION, firstIntelligenceObservation, secCollectorMetadata, type SecFilingDiscoveryRecord } from '../src/lib/sec-filings/store';

// Reuse existing SEC documents. Dry-run by default; never manufacture timestamps.
async function main(){
const apply=process.argv.includes('--apply');
const db=getAdminFirestore();
const metadata=secCollectorMetadata(db);
const saved=await metadata.get();
const ready=saved.get('intelligenceIndexReadyAt');
if(ready){console.log(JSON.stringify({status:'already-indexed',completedAt:ready}));}
else{
  let cursor:unknown=saved.get('intelligenceBackfillCursor');
  let inspected=0,updated=0,complete=false;
  for(let page=0;page<10;page++){
    let query=db.collection(SEC_FILINGS_COLLECTION).orderBy(FieldPath.documentId()).limit(200);
    if(typeof cursor==='string'&&cursor)query=query.startAfter(cursor);
    const snapshot=await query.get();
    const batch=db.batch();
    for(const document of snapshot.docs){
      inspected++;cursor=document.id;
      const records=document.get('discoveryEvents') as Record<string,SecFilingDiscoveryRecord>|undefined;
      if(!records)continue;
      const observedAt=firstIntelligenceObservation(records);
      if(observedAt&&document.get('intelligenceObservedAt')!==observedAt){updated++;batch.set(document.ref,{intelligenceObservedAt:observedAt},{merge:true});}
    }
    complete=snapshot.size<200;
    if(apply){
      batch.set(metadata,complete?{intelligenceIndexReadyAt:new Date().toISOString(),intelligenceBackfillCursor:null}:{intelligenceBackfillCursor:cursor},{merge:true});
      await batch.commit();
    }
    if(complete)break;
  }
  console.log(JSON.stringify({apply,inspected,updated,complete,cursor:complete?null:cursor}));
}

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
