import {PriceStore,readHead,saveHead,ROOT,type Head,type PriceFile} from './storage';

type Compaction={base:Head;groups:string[];completed:PriceFile[]};
const JOURNAL=`${ROOT}/compaction.json`;
export async function compactPrices(store:PriceStore,maxDurationMs=1200000){
 const deadline=Date.now()+maxDurationMs,file=store.bucket.file(JOURNAL);let journal:Compaction,generation='0';
 try{const [meta]=await file.getMetadata();generation=String(meta.generation);const [bytes]=await store.bucket.file(JOURNAL,{generation}).download();journal=JSON.parse(bytes.toString());}
 catch(error){if((error as {code?:number}).code!==404)throw error;
  const base=await readHead(store.bucket);if(!base.manifest.ready)throw Error('Initial export required');
  const groups=[...new Set(base.manifest.files.flatMap(f=>f.groups))].filter(g=>base.manifest.files.filter(f=>f.groups.includes(g)).length>1||base.manifest.files.some(f=>f.groups.includes(g)&&f.groups.length>1));
  journal={base,groups,completed:[]};
 }
 const persist=async()=>{const value=JSON.stringify(journal);for(let attempt=0;;attempt++)try{await file.save(value,{resumable:false,preconditionOpts:{ifGenerationMatch:generation}});break;}catch(error){if((error as {code?:number}).code!==429||attempt>=4)throw error;await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));}const [meta]=await file.getMetadata();generation=String(meta.generation);const [saved]=await store.bucket.file(JOURNAL,{generation}).download();if(saved.toString()!==value)throw Error('Concurrent compaction changed journal');};
 for(let i=journal.completed.length;i<journal.groups.length;i++){
  if(Date.now()>=deadline)return {status:'partial',groups:i,total:journal.groups.length};
  journal.completed.push(await store.compactGroup(journal.base,journal.groups[i]));await persist();
  console.info(JSON.stringify({event:'price_parquet_compaction',groups:i+1,total:journal.groups.length}));
 }
 for(let attempt=0;attempt<5;attempt++){
  const head=await readHead(store.bucket),prefix=journal.base.manifest.files;
  if(prefix.some((f,i)=>head.manifest.files[i]?.name!==f.name)){
   if(journal.completed.length===journal.groups.length&&journal.completed.every(f=>head.manifest.files.some(current=>current.name===f.name)))break;
   throw Error('Compaction base changed; preserve journal for inspection');
  }
  const groups=new Set(journal.groups),retained=prefix.filter(f=>!f.groups.every(g=>groups.has(g)));
  try{await saveHead(store.bucket,head,{...head.manifest,files:[...retained,...journal.completed,...head.manifest.files.slice(prefix.length)]});break;}
  catch(error){if((error as {code?:number}).code!==412||attempt===4)throw error;}
 }
 await file.delete({ignoreNotFound:true,ifGenerationMatch:generation});
 return {status:'complete',groups:journal.groups.length};
}
