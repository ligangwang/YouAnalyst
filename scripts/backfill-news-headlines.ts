import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import type {Firestore,DocumentSnapshot} from 'firebase-admin/firestore';
import {headlineTargetLocale,translateCollectedHeadlines} from '../src/lib/intelligence/collectors/headline-translations';
import {company,encode,type Document} from './migrate-company-themes';
async function main(){
const project=process.env.GCP_PROJECT_ID;
assert(project&&/^[a-z][a-z0-9-]+$/.test(project)&&process.env.GOOGLE_OAUTH_ACCESS_TOKEN,'Explicit project and existing Google access token required');
assert(process.argv.includes('--apply'),'Use --apply');
// Reuse the confirmed deployed collector configuration in memory. Never print or persist it.
const config=process.platform==='win32'?spawnSync('powershell.exe',['-NoProfile','-Command',`gcloud run jobs describe collect-intelligence-news-production --project ${project} --region us-central1 --format=json`],{encoding:'utf8'}):spawnSync('gcloud',['run','jobs','describe','collect-intelligence-news-production','--project',project,'--region','us-central1','--format=json'],{encoding:'utf8'});
assert(config.status===0,'Cannot read collector configuration');
const env=JSON.parse(config.stdout).spec.template.spec.template.spec.containers[0].env as {name:string;value?:string}[];
const key=env.find(item=>item.name==='OPENAI_API_KEY')?.value;
assert(key,'Collector key is not available as an inline runtime value');process.env.OPENAI_API_KEY=key;
const root=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
async function request(url:string,method='GET',data?:unknown){
 const response=await fetch(url,{method,headers:{Authorization:`Bearer ${process.env.GOOGLE_OAUTH_ACCESS_TOKEN}`,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(30_000)});
 if(response.status===404)return null;assert(response.ok,`Firestore request failed (${response.status})`);return response.json();
}
const snapshots=await Promise.all(['ai','robotics','space'].map(async theme=>{const response=await fetch(`https://youanalyst.com/api/intelligence?theme=${theme}`);assert(response.ok,'Cannot read public event snapshot');return response.json();}));
const mapped=new Set<string>(snapshots.flatMap(snapshot=>snapshot.graph.nodes.filter((node:{kind:string})=>node.kind==='COMPANY').map((node:{id:string})=>node.id)));
const ids=[...new Set<string>(snapshots.flatMap(snapshot=>snapshot.events.filter((event:{id:string})=>event.id.startsWith('news-')||event.id.startsWith('disclosure-')).map((event:{id:string})=>event.id.replace(/^(news-|disclosure-)/,''))))];
const docRoot=root.replace('https://firestore.googleapis.com/v1/','');
type Ref={id:string;path:string};
const ref=(collection:string,id:string):Ref=>({id,path:`${docRoot}/${collection}/${id}`});
const documents=new Map<string,Document>();
async function getAll(refs:Ref[]){
 if(!refs.length)return [];
 const rows=await request(`${root}:batchGet`,'POST',{documents:refs.map(item=>item.path)}) as {found?:Document}[];
 const found=new Map(rows.flatMap(row=>row.found?[[row.found.name,row.found] as const]:[]));
 return refs.map(item=>{const document=found.get(item.path);if(document)documents.set(item.path,document);return {id:item.id,ref:item,exists:!!document,data:()=>document?company(document):undefined} as unknown as DocumentSnapshot;});
}
const records=await getAll(ids.map(id=>ref('events',id)));
const db={collection:(name:string)=>({doc:(id:string)=>ref(name,id)}),runTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{
 const writes:unknown[]=[];
 const result=await fn({getAll:(...refs:Ref[])=>getAll(refs),get:async(item:Ref)=>{const document=await request('https://firestore.googleapis.com/v1/'+item.path) as Document|null;if(document)documents.set(item.path,document);return {exists:!!document,data:()=>document?company(document):undefined};},update:(item:Ref,patch:Record<string,unknown>)=>{
  const fields:Record<string,unknown>={};for(const [path,value] of Object.entries(patch)){const parts=path.split('.');let parent=fields;for(const part of parts.slice(0,-1))parent=(parent[part]??={}) as Record<string,unknown>;parent[parts.at(-1)!]=value;}
  writes.push({update:{name:item.path,fields:Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,encode(value)]))},updateMask:{fieldPaths:Object.keys(patch).map(path=>path.split('.').map(key=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)?key:'`'+key+'`').join('.'))},currentDocument:{updateTime:documents.get(item.path)!.updateTime}});
 },create:(item:Ref,data:Record<string,unknown>)=>writes.push({update:{name:item.path,fields:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,encode(value)]))},currentDocument:{exists:false}})});
 if(writes.length)await request(`${root}:commit`,'POST',{writes});return result;
}} as unknown as Firestore;
console.log(JSON.stringify({events:records.length,...await translateCollectedHeadlines(db,mapped,{records,deadline:Date.now()+150_000})}));
const verified=await getAll(ids.map(id=>ref('events',id)));
console.log(JSON.stringify({stored:verified.filter(doc=>doc.data()?.titleTranslations?.[headlineTargetLocale(String(doc.data()?.title??''))]?.source===doc.data()?.title).length}));
console.log(JSON.stringify({review:verified.filter(doc=>doc.data()?.titleTranslationState?.status==='review_required').map(doc=>({id:doc.id,error:doc.data()?.titleTranslationState?.error??'Prior failure (reason not recorded)'}))}));
delete process.env.OPENAI_API_KEY;

}
main().catch(error=>{console.error(error instanceof Error?error.message:'Headline backfill failed');process.exitCode=1;});
