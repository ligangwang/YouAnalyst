import {isDeepStrictEqual} from 'node:util';
import {FieldPath,Timestamp,type Firestore} from 'firebase-admin/firestore';
import {PriceStore,readHead,saveHead,ROOT,type Head,type PriceFile} from './storage';
import {readPriceParquet} from './parquet';
import type {Row} from '../entity-snapshots/sync';

/** Full ID scan remains authoritative even when prior snapshot coverage has gaps.
 * Every exported row is compared after uploading and reading the Parquet file. */
export async function exportPrices(db:Firestore,store:PriceStore,options={maxReads:1000000,maxDurationMs:1200000}){
 const deadline=Date.now()+options.maxDurationMs;let reads=0;
 let head=await readHead(store.bucket);
 if(head.manifest.ready)return {status:'complete',reads};
 if(!head.manifest.watermark){const time=(await db.collection('eod_prices').limit(1).get()).readTime;
  await saveHead(store.bucket,head,{...head.manifest,watermark:[time.seconds,time.nanoseconds]});head=await readHead(store.bucket);}
 while(reads<options.maxReads&&Date.now()<deadline){
  const rows:Row[]=[];let done=false,cursor=head.manifest.cursor;
  for(let page=0;page<10&&reads<options.maxReads&&Date.now()<deadline;page++){
   const limit=Math.min(5000,options.maxReads-reads);
   let query=db.collection('eod_prices').orderBy(FieldPath.documentId()).limit(limit);
   if(cursor)query=query.startAfter(cursor);
   const result=await query.get();reads+=Math.max(1,result.size);
   for(const doc of result.docs){if(doc.id.startsWith('_'))throw Error('Unexpected operational price document');rows.push({id:doc.id,data:doc.data()});}
   cursor=result.docs.at(-1)?.id??cursor;
   if(result.size<limit){done=true;break;}
  }
  let file:PriceFile|undefined;
  if(rows.length){
   file=await store.upload(rows);
   const restored=await store.local([file.name],paths=>readPriceParquet(paths[0]));
   if(!isDeepStrictEqual(restored,rows))throw Error('Export parity failed');
  }
  await saveHead(store.bucket,head,{...head.manifest,cursor,ready:done,files:[...head.manifest.files,...(file?[file]:[])]});
  head=await readHead(store.bucket);
  console.info(JSON.stringify({event:'price_parquet_export',reads,cursor,files:head.manifest.files.length,complete:done}));
  if(done)return {status:'complete',reads,rows:head.manifest.files.reduce((n,f)=>n+f.rows,0)};
 }
 return {status:'partial',reads};
}

/** Capture concurrent edits made during the full scan. Each fixed window advances
 * only after its complete query is saved; bounded runs reuse the last timestamp. */
export async function catchUpPrices(db:Firestore,store:PriceStore,maxReads=50000){
 const head=await readHead(store.bucket);if(!head.manifest.ready||!head.manifest.watermark)throw Error('Initial export required');
 const since=new Timestamp(...head.manifest.watermark),through=(await db.collection('eod_prices').limit(1).get()).readTime;
 const query=db.collection('eod_prices').where('updatedAt','>=',since).where('updatedAt','<=',through).orderBy('updatedAt').orderBy(FieldPath.documentId());
 let cursor:FirebaseFirestore.QueryDocumentSnapshot|undefined,reads=0;const rows:Row[]=[];
 while(reads<maxReads){
  const page=await (cursor?query.startAfter(cursor):query).limit(Math.min(5000,maxReads-reads)).get();
  reads+=Math.max(1,page.size);rows.push(...page.docs.map(doc=>({id:doc.id,data:doc.data()})));cursor=page.docs.at(-1);
  if(page.size<5000){
   const file=rows.length?await store.upload(rows):undefined;
   await saveHead(store.bucket,head,{...head.manifest,watermark:[through.seconds,through.nanoseconds],files:[...head.manifest.files,...(file?[file]:[])]});
   return {status:'complete',reads,changed:rows.length,through:through.toDate().toISOString()};
  }
 }
 // No partial checkpoint advance: callers can raise the bounded budget for an
 // unusually large edit window without losing documents sharing a timestamp.
 throw Error('Price catch-up exceeds read budget; checkpoint retained');
}

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
 const persist=async()=>{const value=JSON.stringify(journal);await file.save(value,{resumable:false,preconditionOpts:{ifGenerationMatch:generation}});const [meta]=await file.getMetadata();generation=String(meta.generation);const [saved]=await store.bucket.file(JOURNAL,{generation}).download();if(saved.toString()!==value)throw Error('Concurrent compaction changed journal');};
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
 await file.delete({ignoreNotFound:true});
 return {status:'complete',groups:journal.groups.length};
}
