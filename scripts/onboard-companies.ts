import {readFile} from 'node:fs/promises';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getAdminFirestore,getAdminStorageBucket} from '../src/lib/firebase/admin';
import {closeLocalCaches} from '../src/lib/local-cache/watch';
import {createMaintenanceLog} from '../src/lib/maintenance-log';
import {createOnboardingHandlers} from '../src/lib/company-onboarding/handlers';
import {processCompanyOnboarding,requestCompanyOnboarding,resumeCompanyOnboarding} from '../src/lib/company-onboarding/queue';
import {ONBOARDING_COLLECTION,parseOnboardingRequest} from '../src/lib/company-onboarding/model';
import type {EnrollmentBatch} from './enroll-theme-companies';

async function main(){
  const projectId=process.env.GCP_PROJECT_ID;if(!projectId)throw Error('GCP_PROJECT_ID is required');
  initializeApp({credential:applicationDefault(),projectId});
  const db=getAdminFirestore(),args=process.argv.slice(2),companyId=args.find(arg=>arg.startsWith('--company='))?.slice(10);
  const enqueue=args.includes('--enqueue'),processQueue=args.includes('--process');
  if(args.includes('--resume')){if(!companyId||enqueue||processQueue)throw Error('Resume requires only --company=<canonical ID> and --resume');console.log(JSON.stringify(await resumeCompanyOnboarding(db,companyId)));return;}
  if(enqueue&&processQueue)throw Error('Enqueue and processing are separate actions');
  if(enqueue){if(!companyId)throw Error('--company=<canonical ID> is required');console.log(JSON.stringify(await requestCompanyOnboarding(db,companyId)));return;}
  const limit=Number(args.find(arg=>arg.startsWith('--limit='))?.slice(8)??1);
  if(!Number.isInteger(limit)||limit<1||limit>5)throw Error('Limit must be between 1 and 5');
  const ids:string[]=[];
  if(companyId)ids.push(companyId);
  else {
    let cursor:FirebaseFirestore.QueryDocumentSnapshot|undefined,scanned=0;
    for(;;){
      let query=db.collection(ONBOARDING_COLLECTION).where('status','in',['QUEUED','PROCESSING']).limit(100);
      if(cursor)query=query.startAfter(cursor);
      const page=await query.get();scanned+=page.docs.length;
      for(const doc of page.docs){const row=parseOnboardingRequest(doc.data());if(row.companyId!==doc.id)throw Error('Request identity mismatch');if(row.leaseExpiresAt<=Date.now()&&row.nextAttemptAt<=Date.now())ids.push(doc.id);if(ids.length>=limit)break;}
      if(ids.length>=limit||page.docs.length<100||scanned>=1000)break;
      cursor=page.docs.at(-1);
    }
  }
  if(!processQueue){console.log(JSON.stringify({mode:'preview',companies:ids,providerCalls:0}));return;}
  const bucketName=process.env.EODHD_BULK_EOD_BUCKET,token=process.env.EODHD_API_TOKEN;
  if(!bucketName||!token)throw Error('Existing EODHD bucket and token are required');
  const file=args.find(arg=>arg.startsWith('--theme-batches='))?.slice(16);
  const themeBatches=file?JSON.parse(await readFile(file,'utf8')) as EnrollmentBatch[]:[];
  if(!Array.isArray(themeBatches))throw Error('Theme review file must contain an array of enrollment batches');
  const log=createMaintenanceLog('company-onboarding');
  const handlers=createOnboardingHandlers({db,bucket:getAdminStorageBucket(bucketName),token,log,themeBatches,
    maintenanceReady:async()=>process.env.COMPANY_ONBOARDING_MAINTENANCE_READY==='1'});
  for(const id of ids){
    const result=await processCompanyOnboarding(db,id,handlers);
    log.emit('INFO','checkpoint',{companyId:id,...result});
    if(result.status==='INCOMPLETE')process.exitCode=1;
  }
}
main().finally(closeLocalCaches).catch(()=>{console.error('Company onboarding job failed; inspect its request checkpoint');process.exitCode=1;});
