import {readFile} from 'node:fs/promises';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getAdminFirestore,getAdminStorageBucket} from '../src/lib/firebase/admin';
import {closeLocalCaches} from '../src/lib/local-cache/watch';
import {createMaintenanceLog} from '../src/lib/maintenance-log';
import {createOnboardingHandlers} from '../src/lib/instrument-onboarding/handlers';
import {processInstrumentOnboarding,requestInstrumentOnboarding,retryInstrumentOnboarding} from '../src/lib/instrument-onboarding/queue';
import {ONBOARDING_COLLECTION,ONBOARDING_STEPS,parseOnboardingRequest} from '../src/lib/instrument-onboarding/model';
import type {EnrollmentBatch} from './enroll-theme-companies';

async function main(){
  const projectId=process.env.GCP_PROJECT_ID;if(!projectId)throw Error('GCP_PROJECT_ID is required');
  initializeApp({credential:applicationDefault(),projectId});
  const db=getAdminFirestore(),args=process.argv.slice(2),instrumentId=args.find(arg=>arg.startsWith('--instrument='))?.slice(13),listingId=args.find(arg=>arg.startsWith('--listing='))?.slice(10);
  const enqueue=args.includes('--enqueue'),processQueue=args.includes('--process');
  if(args.includes('--retry')){if(!instrumentId||enqueue||processQueue)throw Error('Retry requires only --instrument=<ID> and --retry');const request=parseOnboardingRequest((await db.collection(ONBOARDING_COLLECTION).doc(instrumentId).get()).data());const step=ONBOARDING_STEPS.find(key=>request.steps[key]!=='COMPLETE');if(!step)throw Error('No incomplete step');console.log(JSON.stringify(await retryInstrumentOnboarding(db,instrumentId,{step,updatedAt:request.updatedAt})));return;}
  if(enqueue&&processQueue)throw Error('Enqueue and processing are separate actions');
  if(enqueue){if(!instrumentId)throw Error('--instrument=<ID> is required');console.log(JSON.stringify(await requestInstrumentOnboarding(db,instrumentId,listingId)));return;}
  const limit=Number(args.find(arg=>arg.startsWith('--limit='))?.slice(8)??1);
  if(!Number.isInteger(limit)||limit<1||limit>5)throw Error('Limit must be between 1 and 5');
  const ids:string[]=[];
  if(instrumentId)ids.push(instrumentId);
  else {
    let cursor:FirebaseFirestore.QueryDocumentSnapshot|undefined,scanned=0;
    for(;;){
      let query=db.collection(ONBOARDING_COLLECTION).where('status','in',['QUEUED','PROCESSING']).limit(100);
      if(cursor)query=query.startAfter(cursor);
      const page=await query.get();scanned+=page.docs.length;
      for(const doc of page.docs){const row=parseOnboardingRequest(doc.data());if(row.instrumentId!==doc.id)throw Error('Request identity mismatch');if(row.leaseExpiresAt<=Date.now()&&row.nextAttemptAt<=Date.now())ids.push(doc.id);if(ids.length>=limit)break;}
      if(ids.length>=limit||page.docs.length<100||scanned>=1000)break;
      cursor=page.docs.at(-1);
    }
  }
  if(!processQueue){console.log(JSON.stringify({mode:'preview',instruments:ids,providerCalls:0}));return;}
  const bucketName=process.env.EODHD_BULK_EOD_BUCKET,token=process.env.EODHD_API_TOKEN;
  if(!bucketName||!token)throw Error('Existing EODHD bucket and token are required');
  const file=args.find(arg=>arg.startsWith('--theme-batches='))?.slice(16);
  const themeBatches=file?JSON.parse(await readFile(file,'utf8')) as EnrollmentBatch[]:[];
  if(!Array.isArray(themeBatches))throw Error('Theme review file must contain an array of enrollment batches');
  const log=createMaintenanceLog('instrument-onboarding');
  const handlers=createOnboardingHandlers({db,bucket:getAdminStorageBucket(bucketName),token,log,themeBatches,
    maintenanceReady:async()=>process.env.INSTRUMENT_ONBOARDING_MAINTENANCE_READY==='1'});
  for(const id of ids){
    const result=await processInstrumentOnboarding(db,id,handlers);
    log.emit('INFO','checkpoint',{instrumentId:id,...result});
    if(result.status==='INCOMPLETE')process.exitCode=1;
  }
}
main().finally(closeLocalCaches).catch(()=>{console.error('Instrument onboarding job failed; inspect its request checkpoint');process.exitCode=1;});
