import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getFirestore} from '../src/lib/firebase/firestore';
import {reopenFailedEodRun} from '../src/lib/predictions/eod-recovery';

// Preview by default. Apply only after candidate validation, healthy delivery,
// and an idle pipeline. Reuses the frozen manifest and all existing receipts.
async function main(){
  const [batchId,...flags]=process.argv.slice(2);
  if(!batchId||!/^[\w-]{1,100}$/.test(batchId)||flags.some(x=>x!=='--apply'))throw Error('Usage: tsx scripts/repair-eod-run.ts BATCH_ID [--apply]');
  const projectId=process.env.GCP_PROJECT_ID;
  if(!projectId)throw Error('GCP_PROJECT_ID is required');
  const accessToken=process.env.EOD_REPAIR_ACCESS_TOKEN;
  if(!accessToken)throw Error('Provide a fresh gcloud token in EOD_REPAIR_ACCESS_TOKEN (never persist it)');
  initializeApp({projectId,credential:applicationDefault()});
  const db=getFirestore();
  try{
    const [state,run]=await db.getAll(db.collection('eod_runs').doc('_company_pipeline'),db.collection('eod_runs').doc(`_request_${batchId}`));
    const request=run.get('request');
    if(!request)throw Error('Unknown EOD run');
    console.log(JSON.stringify({projectId,batchId,date:request.input.runDate,market:request.input.market,status:run.get('status'),completed:run.get('completed'),done:run.get('completedCompanies'),required:run.get('companyIds')?.length,activeBatch:state.get('activeRequest')?.batchId??null,apply:flags.includes('--apply')}));
    if(flags.includes('--apply')){
      const reopened=await reopenFailedEodRun(db,batchId);
      // Reopening is durable. If publication fails, republish this exact saved
      // request through the normal queue; do not reopen or reset it again.
      const response=await fetch(`https://pubsub.googleapis.com/v1/projects/${projectId}/topics/eod-maintenance-requests:publish`,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({messages:[{data:Buffer.from(JSON.stringify(reopened)).toString('base64')}]})});
      if(!response.ok)throw Error(`Repair publication failed HTTP ${response.status}; republish saved request`);
      const {messageIds}=await response.json() as {messageIds?:string[]};
      if(!messageIds?.length)throw Error('Repair publication unconfirmed; republish saved request');
      const messageId=messageIds[0];
      console.log(JSON.stringify({reopened:batchId,messageId}));
    }
  }finally{await db.terminate();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
