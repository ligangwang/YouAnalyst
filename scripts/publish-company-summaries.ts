import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getFirestore,type Firestore} from 'firebase-admin/firestore';
import {company,encode,type Document,type Request} from './migrate-company-themes';
export type SummaryBatch={asOf:string;summaries:{id:string;theme:'ai'|'robotics'|'space';source:string;text:string}[]};
export async function publishSummaries(db:Firestore,batch:SummaryBatch,write=false){
  assert(/^\d{4}-\d{2}-\d{2}$/.test(batch.asOf)&&batch.asOf<=new Date().toISOString().slice(0,10),'Invalid date');
  assert(batch.summaries.length>0&&batch.summaries.length<=500,'Invalid batch size');
  assert(new Set(batch.summaries.map(s=>`${s.id}:${s.theme}`)).size===batch.summaries.length,'Duplicate summary');
  for(const s of batch.summaries){
    assert(/^(US:[A-Z0-9.-]+|XSHG:6\d{5}|XSHE:[03]\d{5}|ORG:[A-Z0-9.-]+)$/.test(s.id),'Invalid company');
    assert(['ai','robotics','space'].includes(s.theme)&&typeof s.source==='string'&&s.source.trim()&&typeof s.text==='string'&&s.text.trim()&&s.text.length<=3000&&/[\u4e00-\u9fff]/.test(s.text),'Invalid translation');
  }
  return db.runTransaction(async tx=>{
    const ids=[...new Set(batch.summaries.map(s=>s.id))];
    const refs=ids.map(id=>db.collection('companies').doc(id));
    const docs=await tx.getAll(...refs);
    const updates=ids.map(()=>({} as Record<string,unknown>));
    let stored=0;
    for(const s of batch.summaries){
      const index=ids.indexOf(s.id),old=docs[index].data();
      assert(old&&['PUBLISHED','DIRECTORY'].includes(old.status),`${s.id}: missing or unpublished company`);
      const member=s.theme==='ai'?undefined:old.themeMemberships?.[s.theme];
      if(s.theme!=='ai')assert(member?.status==='PUBLISHED',`${s.id}: unpublished theme`);
      const source=s.theme==='ai'?String(old.description??''):(member.sources??[]).map((item:{summary?:string})=>item.summary).filter(Boolean).join(' ');
      assert(source===s.source,`${s.id} (${s.theme}): source summary changed`);
      const previous=s.theme==='ai'?old.descriptionTranslations?.['zh-CN']:member.summaryTranslations?.['zh-CN'];
      assert(!previous||(previous.source===s.source&&previous.text===s.text),`${s.id}: existing translation conflict`);
      if(previous)stored++;
      const field=s.theme==='ai'?'descriptionTranslations.zh-CN':`themeMemberships.${s.theme}.summaryTranslations.zh-CN`;
      updates[index][field]={source:s.source,text:s.text,translatedAt:batch.asOf};
    }
    if(write)updates.forEach((update,index)=>tx.update(refs[index],update));
    return {write,collection:'companies',companies:ids.length,summaries:batch.summaries.length,stored};
  },write?{readOnly:false}:{readOnly:true});
}
export async function publishSummariesRest(project:string,batch:SummaryBatch,request:Request,write=false){
  assert(/^[a-z][a-z0-9-]+$/.test(project),'Invalid project');
  const root='https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents';
  const documents=new Map<string,Document>();
  const writes:unknown[]=[];
  const adapter={collection:(name:string)=>{assert.equal(name,'companies');return {doc:(id:string)=>({id})};},runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{
    const result=await fn({getAll:async(...refs:{id:string}[])=>{
      const rows=await request(root+':batchGet','POST',{documents:refs.map(ref=>root.replace('https://firestore.googleapis.com/v1/','')+'/companies/'+ref.id)}) as {found?:Document}[];
      for(const row of rows)if(row.found)documents.set(row.found.name.split('/').at(-1)!,row.found);
      return refs.map(ref=>({data:()=>documents.has(ref.id)?company(documents.get(ref.id)!):undefined}));
    },update:(ref:{id:string},patch:Record<string,unknown>)=>{
      const fields:Record<string,unknown>={};
      for(const [path,value] of Object.entries(patch)){
        const keys=path.split('.');let parent=fields;
        for(const key of keys.slice(0,-1))parent=(parent[key]??={}) as Record<string,unknown>;
        parent[keys.at(-1)!]=value;
      }
      const doc=documents.get(ref.id)!;
      writes.push({update:{name:doc.name,fields:Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,encode(value)]))},updateMask:{fieldPaths:Object.keys(patch).map(path=>path.split('.').map(key=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)?key:'\x60'+key+'\x60').join('.'))},currentDocument:{updateTime:doc.updateTime}});
    }});
    if(write)await request(root+':commit','POST',{writes});
    return result;
  }} as unknown as Firestore;
  return publishSummaries(adapter,batch,write);
}
async function main(){
  const batch=JSON.parse((await readFile(new URL('../data/ai-supply-chain/company-summaries-zh.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''));
  assert(process.env.GCP_PROJECT_ID&&(process.argv.includes('--preview')||process.argv.includes('--write')),'Use --preview or --write with GCP_PROJECT_ID');
  if(process.env.GOOGLE_OAUTH_ACCESS_TOKEN){
    const request:Request=async(url,method='GET',data)=>{
      const response=await fetch(url,{method,headers:{Authorization:'Bearer '+process.env.GOOGLE_OAUTH_ACCESS_TOKEN,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(30_000)});
      assert(response.ok,'Firestore request failed ('+response.status+')');return response.json();
    };
    console.log(JSON.stringify(await publishSummariesRest(process.env.GCP_PROJECT_ID,batch,request,process.argv.includes('--write'))));return;
  }
  initializeApp({credential:applicationDefault(),projectId:process.env.GCP_PROJECT_ID});
  console.log(JSON.stringify(await publishSummaries(getFirestore(),batch,process.argv.includes('--write'))));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error instanceof Error?error.message:'Summary publication failed');process.exitCode=1;});
