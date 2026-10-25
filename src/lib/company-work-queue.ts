import type {DocumentReference, Firestore} from 'firebase-admin/firestore';
import {digest} from './fundamentals/pubsub';
import {acquireMaintenanceLease, releaseMaintenanceLease} from './maintenance-lease';

export type CompanyWorkKind = 'eod' | 'us-market-cap' | 'us-fundamentals-seed' | 'directory' | 'instrument-sync';
export type CompanyWorkRequest = {version:1;type:'company.work.requested';kind:CompanyWorkKind;batchId:string;parentBatchId:string;companyId:string;requestedAt:string};
export type RunMessage = {batchId:string;requestedAt:string};
export type CompanyRun<R extends RunMessage> = {
  request:R; companyIds?:string[]; phase?:'companies'|'waiting'|'finalizing'|'completed';
  dispatchCursor?:number; completedCompanies?:number; finalizeCursor?:string|null; completed?:boolean;
};
type Child = {request:CompanyWorkRequest;result:Record<string,unknown>;cursor?:string|null;completed?:boolean};
export function companyWorkRequest(kind:CompanyWorkKind,parent:RunMessage,companyId:string):CompanyWorkRequest {
  return {version:1,type:'company.work.requested',kind,batchId:digest({kind,parentBatchId:parent.batchId,companyId}),parentBatchId:parent.batchId,companyId,requestedAt:parent.requestedAt};
}
export function parseCompanyWorkRequest(value:unknown,kind:CompanyWorkKind):CompanyWorkRequest {
  const v=value as CompanyWorkRequest;
  if(!v||v.version!==1||v.type!=='company.work.requested'||v.kind!==kind||typeof v.parentBatchId!=='string'||!/^[\w-]{1,100}$/.test(v.parentBatchId)
    ||typeof v.companyId!=='string'||!/^(US:[A-Z0-9.-]+|ORG:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5})$/.test(v.companyId)
    ||typeof v.requestedAt!=='string'||!Number.isFinite(Date.parse(v.requestedAt))||v.batchId!==companyWorkRequest(kind,{batchId:v.parentBatchId,requestedAt:v.requestedAt},v.companyId).batchId) throw Error('Invalid company work request');
  return companyWorkRequest(kind,{batchId:v.parentBatchId,requestedAt:v.requestedAt},v.companyId);
}
export const companyWorkRef=(db:Firestore,collection:string,id:string)=>db.collection(collection).doc(`_company_${id}`);
function assertOwner(snapshot:FirebaseFirestore.DocumentSnapshot,owner:string){
  if(snapshot.get('leaseOwner')!==owner||Number(snapshot.get('leaseExpiresAtMs'))<=Date.now())throw Error('Company work lease expired');
}

/** The parent publishes bounded pages, never occupies a worker waiting for children. */
export async function processCompanyRun<R extends RunMessage>(request:R,options:{
  db:Firestore;ref:DocumentReference;state:DocumentReference;collection:string;kind:CompanyWorkKind;owner:string;
  plan:()=>Promise<string[]>;prepare:(ids:string[])=>Promise<Record<string,Record<string,unknown>>>;
  publish:(message:R|CompanyWorkRequest)=>Promise<unknown>;
  finalize:(cursor:string|null)=>Promise<string|null>;
}){
  const {db,ref,state,owner}=options;
  if(!await acquireMaintenanceLease(ref,owner))throw Error('Company run is busy');
  try{
    let run=(await ref.get()).data() as CompanyRun<R>;
    if(!run?.request||digest(run.request)!==digest(request))throw Error('Unknown company run');
    if(run.completed)return {duplicate:true,batchId:request.batchId};
    await db.runTransaction(async tx=>{
      const active=(await tx.get(state)).get('activeRequest');
      if(active&&active.batchId!==request.batchId)throw Error('Previous company run is unfinished');
      tx.set(state,{activeRequest:request},{merge:true});
    });
    if(!run.companyIds){
      const companyIds=[...new Set(await options.plan())].sort();
      // A manifest is bounded below Firestore's document limit; never truncate coverage.
      if(Buffer.byteLength(JSON.stringify(companyIds))>500_000)throw Error('Company manifest exceeds supported size');
      run={...run,companyIds,phase:'companies',dispatchCursor:0,completedCompanies:0};
      await ref.set({companyIds,phase:run.phase,dispatchCursor:0,completedCompanies:0},{merge:true});
    }
    if(run.phase==='companies'){
      const ids=run.companyIds!.slice(run.dispatchCursor??0,(run.dispatchCursor??0)+25);
      const prepared=await options.prepare(ids);
      for(const companyId of ids){
        const child=companyWorkRequest(options.kind,request,companyId),childRef=companyWorkRef(db,options.collection,child.batchId);
        await db.runTransaction(async tx=>{
          if(!(await tx.get(childRef)).exists)tx.create(childRef,{request:child,result:prepared[companyId]??{},completed:false});
        });
        await options.publish(child);
      }
      const dispatchCursor=(run.dispatchCursor??0)+ids.length;
      const phase=dispatchCursor<run.companyIds!.length?'companies':'waiting';
      await db.runTransaction(async tx=>{
        assertOwner(await tx.get(ref),owner);
        tx.set(ref,{dispatchCursor,phase},{merge:true});
      });
      // Also wake after the final dispatch: children may finish before phase=waiting.
      await options.publish(request);
      return {batchId:request.batchId,phase,dispatched:dispatchCursor,required:run.companyIds!.length};
    }
    if(run.phase==='waiting'){
      if(run.completedCompanies!==run.companyIds!.length)return {batchId:request.batchId,phase:'waiting',completed:run.completedCompanies,required:run.companyIds!.length};
      // Independently verify every receipt, not just the completion counter.
      for(let i=0;i<run.companyIds!.length;i+=100){
        const tasks=run.companyIds!.slice(i,i+100).map(id=>companyWorkRequest(options.kind,request,id));
        const receipts=await db.getAll(...tasks.map(task=>companyWorkRef(db,options.collection,task.batchId)));
        if(receipts.some((receipt,index)=>receipt.get('completed')!==true||!receipt.get('request')||digest(receipt.get('request'))!==digest(tasks[index])))throw Error('Company completion barrier is incomplete');
      }
      await ref.set({phase:'finalizing'},{merge:true});
      run={...run,phase:'finalizing'};
    }
    if(run.phase!=='finalizing')throw Error('Unknown company run phase');
    const cursor=await options.finalize(run.finalizeCursor??null);
    await db.runTransaction(async tx=>{
      const saved=await tx.get(ref),active=(await tx.get(state)).get('activeRequest');
      assertOwner(saved,owner);
      if(active?.batchId!==request.batchId)throw Error('Company run ownership changed');
      tx.set(ref,{finalizeCursor:cursor,...(cursor===null?{completed:true,phase:'completed',completedAt:new Date().toISOString()}: {})},{merge:true});
      if(cursor===null)tx.set(state,{activeRequest:null},{merge:true});
    });
    if(cursor!==null)await options.publish(request);
    return {batchId:request.batchId,phase:cursor===null?'completed':'finalizing'};
  }finally{await releaseMaintenanceLease(ref,owner);}
}

export async function processCompanyWork<R extends RunMessage>(request:CompanyWorkRequest,options:{
  db:Firestore;parent:DocumentReference;state:DocumentReference;collection:string;owner:string;
  publish:(message:R|CompanyWorkRequest)=>Promise<unknown>;
  work:(parent:R,prepared:Record<string,unknown>,cursor:string|null)=>Promise<string|null>;
}){
  const {db,parent,state,owner}=options,ref=companyWorkRef(db,options.collection,request.batchId);
  if(!await acquireMaintenanceLease(ref,owner))throw Error('Company task is busy');
  try{
    const child=(await ref.get()).data() as Child,run=(await parent.get()).data() as CompanyRun<R>;
    if(!child?.request||digest(child.request)!==digest(request)||!run?.companyIds?.includes(request.companyId)||run.request.batchId!==request.parentBatchId)throw Error('Unknown company task');
    if(child.completed){
      if(!run.completed&&run.completedCompanies===run.companyIds.length)await options.publish(run.request);
      return {duplicate:true,batchId:request.batchId};
    }
    if(run.completed||!['companies','waiting'].includes(run.phase??'')||(await state.get()).get('activeRequest')?.batchId!==run.request.batchId)throw Error('Company run is not active');
    const cursor=await options.work(run.request,child.result,child.cursor??null);
    let last=false;
    await db.runTransaction(async tx=>{
      last=false;
      const saved=await tx.get(ref),p=await tx.get(parent),active=(await tx.get(state)).get('activeRequest');
      assertOwner(saved,owner);
      if(saved.get('completed'))return;
      if(p.get('completed')||active?.batchId!==request.parentBatchId)throw Error('Company run ownership changed');
      if(cursor!==null){tx.set(ref,{cursor},{merge:true});return;}
      const completedCompanies=Number(p.get('completedCompanies')??0)+1;
      if(completedCompanies>run.companyIds!.length)throw Error('Invalid company completion count');
      tx.set(ref,{cursor:null,completed:true,completedAt:new Date().toISOString()},{merge:true});
      tx.set(parent,{completedCompanies},{merge:true});
      last=completedCompanies===run.companyIds!.length;
    });
    if(cursor!==null)await options.publish(request);
    else if(last)await options.publish(run.request);
    return {batchId:request.batchId,companyId:request.companyId,completed:cursor===null};
  }finally{await releaseMaintenanceLease(ref,owner);}
}
