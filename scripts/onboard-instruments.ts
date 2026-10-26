import {onboardingRuntime} from '../src/lib/instrument-onboarding/runtime';
import {drainInstrumentOnboarding} from '../src/lib/instrument-onboarding/worker';
import {GoogleAuth} from 'google-auth-library';
import {verifyOnboardingDelivery} from '../src/lib/instrument-onboarding/delivery-check';
import {readFile} from 'node:fs/promises';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getAdminFirestore} from '../src/lib/firebase/admin';
import {closeLocalCaches} from '../src/lib/local-cache/watch';
import {withLiveCompanyReads} from '../src/lib/local-cache/company-directory';
import {requestInstrumentOnboarding,retryInstrumentOnboarding,wakeInstrumentOnboarding} from '../src/lib/instrument-onboarding/queue';
import {ONBOARDING_COLLECTION,ONBOARDING_STEPS,parseOnboardingRequest} from '../src/lib/instrument-onboarding/model';
import type {EnrollmentBatch} from './enroll-theme-companies';

async function main(){
  const projectId=process.env.GCP_PROJECT_ID;if(!projectId)throw Error('GCP_PROJECT_ID is required');
  initializeApp({credential:applicationDefault(),projectId});
  const db=getAdminFirestore(),args=process.argv.slice(2),instrumentId=args.find(arg=>arg.startsWith('--instrument='))?.slice(13),listingId=args.find(arg=>arg.startsWith('--listing='))?.slice(10);
  const enqueue=args.includes('--enqueue'),processQueue=args.includes('--process');
  if(args.includes('--verify-delivery')){
    if(enqueue||processQueue||instrumentId||args.includes('--retry')||args.includes('--wake'))throw Error('Verification must run alone');
    const url=process.env.ONBOARDING_SUBSCRIBER_URL;if(!url)throw Error('Subscriber URL is required');
    const client=await new GoogleAuth().getIdTokenClient(url);
    console.log(JSON.stringify(await verifyOnboardingDelivery({url,project:projectId,sha:process.env.GIT_SHA??'',exists:async id=>(await db.collection(ONBOARDING_COLLECTION).doc(id).get()).exists,
      send:async(target,headers)=>{const r=await client.request({url:target,method:headers?'POST':'GET',headers,...(headers?{data:Buffer.alloc(0)}:{}),timeout:60000,retry:false});return {status:r.status,data:r.data};}})));return;
  }
  if(args.includes('--wake')){if(!instrumentId||enqueue||processQueue||args.includes('--retry'))throw Error('Wake requires only --instrument=<ID> and --wake');console.log(JSON.stringify({instrumentId,woken:await wakeInstrumentOnboarding(db,instrumentId)}));return;}
  if(args.includes('--retry')){if(!instrumentId||enqueue||processQueue)throw Error('Retry requires only --instrument=<ID> and --retry');const request=parseOnboardingRequest((await db.collection(ONBOARDING_COLLECTION).doc(instrumentId).get()).data());const step=ONBOARDING_STEPS.find(key=>request.steps[key]!=='COMPLETE');if(!step)throw Error('No incomplete step');console.log(JSON.stringify(await retryInstrumentOnboarding(db,instrumentId,{step,updatedAt:request.updatedAt})));return;}
  if(enqueue&&processQueue)throw Error('Enqueue and processing are separate actions');
  if(enqueue){const requester=args.find(arg=>arg.startsWith('--requester='))?.slice('--requester='.length);if(!instrumentId||!requester)throw Error('--instrument=<ID> and --requester=<Firebase UID> are required');console.log(JSON.stringify(await requestInstrumentOnboarding(db,instrumentId,requester,listingId)));return;}
  const limit=Number(args.find(arg=>arg.startsWith('--limit='))?.slice(8)??1);
  if(!Number.isInteger(limit)||limit<1||limit>5)throw Error('Limit must be between 1 and 5');
  const ids:string[]=[];
  if(instrumentId)ids.push(instrumentId);
  else {
    let cursor:FirebaseFirestore.QueryDocumentSnapshot|undefined,scanned=0;
    for(;;){
      if(ids.length>=limit)break;
      let query=db.collection(ONBOARDING_COLLECTION).where('status','in',['QUEUED','PROCESSING']).limit(100);
      if(cursor)query=query.startAfter(cursor);
      const page=await query.get();scanned+=page.docs.length;
      for(const doc of page.docs){const row=parseOnboardingRequest(doc.data());if(row.instrumentId!==doc.id)throw Error('Request identity mismatch');if(!row.lastError&&row.status==='QUEUED'&&row.leaseExpiresAt<=Date.now()&&row.nextAttemptAt<=Date.now()&&!ids.includes(doc.id))ids.push(doc.id);if(ids.length>=limit)break;}
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
  const {handlers,log}=onboardingRuntime(db,themeBatches);
  for(const id of ids){
    const result=await drainInstrumentOnboarding(db,id,handlers);
    log.emit('INFO','checkpoint',{instrumentId:id,...result});
    if(result.status==='INCOMPLETE')process.exitCode=1;
  }
}
withLiveCompanyReads(main).finally(closeLocalCaches).catch(()=>{console.error('Instrument onboarding job failed; inspect its request checkpoint');process.exitCode=1;});
