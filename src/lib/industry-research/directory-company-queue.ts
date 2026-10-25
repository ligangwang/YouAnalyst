import type {Firestore} from 'firebase-admin/firestore';
import type {MaintenanceLog} from '../maintenance-log';
import {parseCompanyWorkRequest,processCompanyRun,processCompanyWork,type CompanyWorkRequest} from '../company-work-queue';
import {acquireMaintenanceLease,releaseMaintenanceLease} from '../maintenance-lease';
import {digest} from '../fundamentals/pubsub';
import {publishJobMessage} from '../job-pubsub';
import {downloadDirectory,parseDirectoryRequest,processDirectoryRequest,type DirectoryRequest} from './directory-pubsub';
import {validateCniDirectory,writeCniCompany} from './directory-sync';

export type DirectoryCompanyRun=Omit<DirectoryRequest,'version'|'type'>&{version:2;type:'directory.company-run.requested'};
export type DirectoryMessage=DirectoryRequest|DirectoryCompanyRun|CompanyWorkRequest;
export function parseDirectoryMessage(value:unknown):DirectoryMessage{
  if((value as {type?:string})?.type==='company.work.requested')return parseCompanyWorkRequest(value,'directory');
  if((value as {type?:string})?.type==='directory.company-run.requested'){
    if((value as {version?:number}).version!==2)throw Error('Invalid directory protocol');
    return {...parseDirectoryRequest({...value as DirectoryCompanyRun,version:1,type:'directory.cni.sync.requested'}),version:2,type:'directory.company-run.requested'};
  }return parseDirectoryRequest(value);
}
export async function processDirectoryCompanyMessage(value:DirectoryMessage,db:Firestore,log:MaintenanceLog,
  publish:(message:DirectoryMessage)=>Promise<unknown>=message=>publishJobMessage('cni-directory-requests',message),
  download=downloadDirectory){
  const request=parseDirectoryMessage(value),meta=db.collection('directory_syncs').doc('CN_A_CNI'),state=db.collection('directory_syncs').doc('_company_pipeline');
  const parent=(id:string)=>db.collection('directory_syncs').doc(`_cni_${id}`);
  if(request.type==='company.work.requested')return processCompanyWork<DirectoryCompanyRun>(request,{
    db,parent:parent(request.parentBatchId),state,collection:'directory_syncs',owner:log.runId,publish,
    work:async(_parent,prepared)=>{
      const row=prepared.company as Record<string,unknown>,metadata=prepared.metadata as Record<string,unknown>;
      if(!row||row.id!==request.companyId||!metadata)throw Error('Missing directory company input');
      await db.runTransaction(async tx=>{
        const profile=await tx.get(db.collection('companies').doc(request.companyId));
        writeCniCompany(tx,db,row,profile.data()??{},metadata,new Date().toISOString());
      });return null;
    },
  });
  const ref=parent(request.batchId);
  if(request.type==='directory.cni.sync.requested'){
    if(!await acquireMaintenanceLease(meta,log.runId))throw Error('Legacy directory worker active');
    let upgraded:DirectoryCompanyRun|null;
    try{upgraded=await db.runTransaction(async tx=>{
      const saved=(await tx.get(ref)).data();
      if(saved?.request?.type==='directory.company-run.requested')return parseDirectoryMessage(saved.request) as DirectoryCompanyRun;
      if(!saved?.request||digest(saved.request)!==digest(request))throw Error('Unknown directory run');
      if(saved.prepared||saved.completed)return null;
      const next:DirectoryCompanyRun={...request,version:2,type:'directory.company-run.requested'};
      tx.set(ref,{request:next},{merge:true});return next;
    });}finally{await releaseMaintenanceLease(meta,log.runId);}
    if(!upgraded)return processDirectoryRequest(request,db,log);
    await publish(upgraded);return {upgraded:true,batchId:request.batchId};
  }
  return processCompanyRun(request,{
    db,ref,state,collection:'directory_syncs',kind:'directory',owner:log.runId,publish,
    plan:async()=>{
      const saved=(await ref.get()).data();
      if(saved?.prepared)return Object.keys(saved.result.index);
      const {payload,rows}=validateCniDirectory(await download()),prior=(await meta.get()).data();
      const dateKey=(s:string)=>{const [y,m]=s.split('-').map(Number);return y*12+m;};
      if(prior?.snapshot&&dateKey(String(payload.snapshot))<dateKey(prior.snapshot))throw Error('Refusing an older directory snapshot');
      const index:Record<string,number>={},deadline=Date.now()+6*60_000;
      const industries=[...new Map(rows.map(row=>{const c=(row.classification as {code:string;name:string}[])[2];return [c.code,c];})).values()].sort((a,b)=>a.code.localeCompare(b.code));
      const metadata={source:payload.source,snapshot:payload.snapshot,sha256:payload.sha256};
      if(prior?.sha256===payload.sha256){await ref.set({prepared:true,metadata,result:{index,industries,count:rows.length}},{merge:true});return [];}
      for(let i=0;i<rows.length;i+=100){
        if(Date.now()>deadline)throw Error('Directory preparation requires retry');
        const group=rows.slice(i,i+100);group.forEach(row=>{index[String(row.id)]=i/100;});
        if(Buffer.byteLength(JSON.stringify(group))>700_000)throw Error('Directory page too large');
        await db.collection('directory_syncs').doc(`_cni_${request.batchId}_page_${i/100}`).set({companies:group});
      }
      await ref.set({prepared:true,metadata,result:{index,industries,count:rows.length}},{merge:true});return Object.keys(index);
    },
    prepare:async ids=>{
      const saved=(await ref.get()).data()!,index=saved.result.index as Record<string,number>,pages=new Map<number,Record<string,unknown>[]>();
      for(const page of new Set(ids.map(id=>index[id]))){
        const data=(await db.collection('directory_syncs').doc(`_cni_${request.batchId}_page_${page}`).get()).data();
        if(!Array.isArray(data?.companies))throw Error('Directory page unavailable');pages.set(page,data.companies);
      }
      return Object.fromEntries(ids.map(id=>{const company=pages.get(index[id])!.find(row=>row.id===id);if(!company)throw Error('Directory company unavailable');return [id,{company,metadata:saved.metadata}];}));
    },
    finalize:async()=>{
      const saved=(await ref.get()).data()!;
      await meta.set({...saved.metadata,industries:saved.result.industries,count:saved.result.count,completedAt:new Date().toISOString(),activeRequest:null},{merge:true});return null;
    },
  });
}
