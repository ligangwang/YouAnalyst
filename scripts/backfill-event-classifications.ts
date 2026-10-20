import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getFirestore} from '../src/lib/firebase/firestore';
import {backfillEventClassifications} from '../src/lib/events/classification-worker';
import {EVENT_CLASSIFICATION_VERSION} from '../src/lib/events/classification';
async function main(){
 const args=process.argv.slice(2);
 if(args.some(arg=>!['--apply','--enrich-insiders','--resume'].includes(arg)))throw new Error('Usage: backfill-event-classifications [--apply] [--enrich-insiders] [--resume]');
 const projectId=process.env.GCP_PROJECT_ID??process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
 if(!projectId)throw new Error('GCP_PROJECT_ID required');
 initializeApp({credential:applicationDefault(),projectId});const db=getFirestore();
 const state=args.includes('--resume')?(await db.collection('collectors').doc('event-classification-v1').get()).data():undefined;
 if(state?.migrationVersion===EVENT_CLASSIFICATION_VERSION){console.log(JSON.stringify({job:'event-classification-backfill',complete:true,alreadyCompleted:true}));return;}
 // Preserve the old scheduled bootstrap's progress on the first explicit migration run.
 const after=String(state?.migrationAfterEventId??state?.bootstrapAfterEventId??state?.afterEventId??'');
 const result=await backfillEventClassifications(db,{apply:args.includes('--apply'),enrichInsiders:args.includes('--enrich-insiders'),after,maxPages:5,deadline:Date.now()+90_000,onProgress:r=>console.log(JSON.stringify({job:'event-classification-backfill',apply:args.includes('--apply'),...r}))});
 console.log(JSON.stringify({job:'event-classification-backfill',apply:args.includes('--apply'),...result}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Event classification failed');process.exitCode=1;});
