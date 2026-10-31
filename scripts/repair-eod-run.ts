import type {Firestore} from 'firebase-admin/firestore';
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
  const db=restFirestore(projectId,accessToken);
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
  }finally{/* The supplied token is held only in memory. */}
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});

// Minimal REST adapter for this operator transaction, using the caller's existing
// gcloud credential. No ADC refresh files or secrets are written to disk.
function restFirestore(projectId:string,accessToken:string):Firestore {
  const root=`projects/${projectId}/databases/(default)/documents`;
  type Value={nullValue?:null;stringValue?:string;booleanValue?:boolean;integerValue?:string;doubleValue?:number;arrayValue?:{values?:Value[]};mapValue?:{fields?:Record<string,Value>}};
  const decode=(v:Value):unknown=>v.mapValue?Object.fromEntries(Object.entries(v.mapValue.fields??{}).map(([k,x])=>[k,decode(x)])):v.arrayValue?(v.arrayValue.values??[]).map(decode):v.stringValue??v.booleanValue??(v.integerValue!==undefined?Number(v.integerValue):v.doubleValue??null);
  const encode=(v:unknown):Value=>v===null?{nullValue:null}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?(Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v}):Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:{mapValue:{fields:Object.fromEntries(Object.entries(v as Record<string,unknown>).map(([k,x])=>[k,encode(x)]))}};
  async function call(suffix:string,body:unknown){
    const response=await fetch(`https://firestore.googleapis.com/v1/${root}${suffix}`,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw Error(`Firestore operator request failed HTTP ${response.status}`);
    return response.json();
  }
  type Ref={name:string};
  async function getAll(refs:Ref[],transaction?:string){
    const results=await call(':batchGet',{documents:refs.map(r=>r.name),...(transaction?{transaction}:{})}) as {found?:{name:string;fields:Record<string,Value>};missing?:string}[];
    return refs.map(ref=>{const row=results.find(r=>(r.found?.name??r.missing)===ref.name);if(!row)throw Error('Incomplete receipt response');const data=row.found?Object.fromEntries(Object.entries(row.found.fields??{}).map(([k,v])=>[k,decode(v)])):undefined;return {exists:!!row.found,data:()=>data,get:(key:string)=>data?.[key]};});
  }
  return {
    collection:(collection:string)=>({doc:(id:string)=>({name:`${root}/${collection}/${id}`})}),
    getAll:(...refs:Ref[])=>getAll(refs),
    runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{
      const {transaction}=await call(':beginTransaction',{options:{readWrite:{}}}) as {transaction:string};
      const writes:unknown[]=[];
      try{
        const result=await fn({get:async(ref:Ref)=>(await getAll([ref],transaction))[0],getAll:(...refs:Ref[])=>getAll(refs,transaction),set:(ref:Ref,data:Record<string,unknown>,options:{merge:boolean})=>{if(!options.merge)throw Error('Operator only supports merged updates');writes.push({update:{name:ref.name,fields:(encode(data).mapValue!).fields},updateMask:{fieldPaths:Object.keys(data)}});}});
        await call(':commit',{transaction,writes});return result;
      }catch(error){await call(':rollback',{transaction}).catch(()=>{});throw error;}
    },
  } as unknown as Firestore;
}
