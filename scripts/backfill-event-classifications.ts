import {applicationDefault,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {backfillEventClassifications} from '../src/lib/events/classification-worker';
async function main(){
 const args=process.argv.slice(2);
 if(args.some(arg=>!['--apply','--enrich-insiders','--resume'].includes(arg)))throw new Error('Usage: backfill-event-classifications [--apply] [--enrich-insiders] [--resume]');
 const projectId=process.env.GCP_PROJECT_ID??process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
 if(!projectId)throw new Error('GCP_PROJECT_ID required');
 initializeApp({credential:applicationDefault(),projectId});const db=getFirestore();
 const after=args.includes('--resume')?String((await db.collection('collectors').doc('event-classification-v1').get()).get('afterEventId')??''):'';
 const result=await backfillEventClassifications(db,{apply:args.includes('--apply'),enrichInsiders:args.includes('--enrich-insiders'),after,deadline:Date.now()+17*60_000,onProgress:r=>console.log(JSON.stringify({job:'event-classification-backfill',apply:args.includes('--apply'),...r}))});
 console.log(JSON.stringify({job:'event-classification-backfill',apply:args.includes('--apply'),...result}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Event classification failed');process.exitCode=1;});
