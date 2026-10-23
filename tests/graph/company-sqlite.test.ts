process.env.PRICE_SNAPSHOT_READY='1';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Timestamp,Firestore} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {entitySqliteBuilder,openEntitySqlite,loadEntitySqlite,inheritEntitySqliteIndex} from '../../src/lib/entity-snapshots/sqlite';
import {companySearchFields} from '../../src/lib/market-companies/search';
import {enableCompanyDirectory,refreshCompanyDirectoryIds,withLiveCompanyReads,companySourceSnapshot} from '../../src/lib/local-cache/company-directory';
import {loadSitemapPaths} from '../../src/lib/local-cache/sitemaps';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';

async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'sqlite-test-')),path=join(directory,'companies.sqlite');
 const rows=[
  {id:'US:NVDA',data:{name:'NVIDIA Corporation',symbol:'NVDA',symbolLower:'nvda',slug:'nvidia',slugAliases:['old-nvidia'],themeIds:['ai'],updatedAt:new Timestamp(10,123)}},
  {id:'XSHE:300750',data:{name:'宁德时代',symbol:'300750',names:{'zh-CN':'宁德时代',en:'Contemporary Amperex Technology'},themeIds:['robotics'],updatedAt:new Timestamp(11,456)}},
 ].map(row=>({...row,data:{...row.data,...companySearchFields(row.id,row.data)}}));
 const builder=entitySqliteBuilder(path);for(const row of rows)builder.add(row);
 builder.add({id:'US:DELETED',data:{name:'Deleted',isDeleted:true,searchPrefixes:['deleted']}});
 builder.finish(new Timestamp(12,789));
 return {directory,path,rows};
}
test('SQLite preserves fields, timestamps and every existing English, Chinese and pinyin search match',async()=>{
 const f=await fixture(),opened=openEntitySqlite(f.path);
 try{
  assert.equal(opened.rows.size,2);assert.equal(opened.watermark.nanoseconds,789);
  for(const row of f.rows){
   assert.deepEqual(opened.rows.get(row.id),row.data);
   for(const prefix of row.data.searchPrefixes)assert.ok(opened.rows.candidateIds!('searchPrefixes','array-contains',prefix)?.has(row.id),prefix);
  }
  assert.deepEqual([...opened.rows.candidateIds!('searchPrefixes','array-contains','not-present')!],[]);
  assert.deepEqual([...opened.rows.candidateIds!('slug','==','nvidia')!],['US:NVDA']);
  assert.deepEqual([...opened.rows.candidateIds!('themeIds','array-contains-any',['robotics','ai'])!].sort(),f.rows.map(r=>r.id).sort());
  assert.equal(opened.rows.candidateIds!('unknownField','==','x'),undefined);
 }finally{opened.close();await rm(f.directory,{recursive:true,force:true});}
});
test('normal company queries use SQLite candidates and local overrides remain visible',async()=>{
 const f=await fixture(),opened=openEntitySqlite(f.path);
 try{
  const rows=inheritEntitySqliteIndex(opened.rows,new Map(opened.rows),['US:NEW']);
  rows.set('US:NEW',{name:'New NVIDIA Supplier',searchPrefixes:['nvidia']});
  const sdk=new Firestore({projectId:'test-sqlite-directory'}),db=observeFirestore(sdk,()=>{});
  enableCompanyDirectory(db,{collection:()=>{throw Error('Unexpected Firestore');}} as unknown as Firestore,{sync:false,file:async()=>rows});
  const docs=(await db.collection('companies').where('searchPrefixes','array-contains','nvidia').select('name').get()).docs;
  assert.deepEqual(docs.map(d=>d.id),['US:NEW','US:NVDA']);
  assert.equal((await db.collection('companies').where('slugAliases','array-contains','old-nvidia').get()).docs[0].id,'US:NVDA');
 }finally{opened.close();await rm(f.directory,{recursive:true,force:true});}
});
test('file download logs separate download and open time; missing and corrupt files are distinguished',async()=>{
 const f=await fixture(),logs:Record<string,unknown>[]=[];
 let missing=true;
 const bucket={file:()=>({getMetadata:async()=>{if(missing)throw Object.assign(Error('missing'),{code:404});return [{generation:'123'}];},createReadStream:()=>createReadStream(f.path)})} as unknown as Bucket;
 try{
  assert.equal(await loadEntitySqlite(bucket,'cold',entry=>logs.push(entry)),undefined);
  assert.equal(logs.at(-1)?.status,'missing');missing=false;
  const rows=await loadEntitySqlite(bucket,'cold',entry=>logs.push(entry));assert.equal(rows?.size,2);
  const log=logs.at(-1)!;assert.equal(log.format,'sqlite');assert.equal(log.status,'success');assert.equal(log.timingsOverlap,false);
  assert.equal(log.bytesDownloaded,(await readFile(f.path)).length);
  assert.ok(Number(log.totalMs)>=Number(log.downloadMs));assert.ok(Number(log.processingMs)>=0);
  await writeFile(f.path,'not a sqlite database');
  await assert.rejects(loadEntitySqlite(bucket,'refresh',entry=>logs.push(entry)));
  assert.equal(logs.at(-1)?.status,'error');
 }finally{await rm(f.directory,{recursive:true,force:true});}
});

test('opening and sitemap decode zero companies; requested records are decoded once',async()=>{
 const f=await fixture(),opened=openEntitySqlite(f.path);
 try{
  assert.equal(opened.rows.decodedCount!(),0);
  const sdk=new Firestore({projectId:'test-lazy-sqlite'}),db=observeFirestore(sdk,()=>{});
  enableCompanyDirectory(db,{} as Firestore,{sync:false,file:async()=>opened.rows});
  assert.ok((await loadSitemapPaths(db,'US:N')).some(path=>path.includes('nvidia')));
  assert.equal(opened.rows.decodedCount!(),0);
  const query=db.collection('companies').where('symbolLower','>=','nv').where('symbolLower','<=','nv\uf8ff').orderBy('symbolLower').limit(50);
  assert.equal((await query.get()).docs[0].data().symbol,'NVDA');
  assert.equal(opened.rows.decodedCount!(),1);
  await query.get();assert.equal(opened.rows.decodedCount!(),1);
  const changed=inheritEntitySqliteIndex(opened.rows,new Map(opened.rows),['US:NVDA','US:NEW']);
  changed.set('US:NVDA',{isDeleted:true});changed.set('US:NEW',{name:'New Company',slug:'new-company'});
  const projections=new Map(changed.sitemapRows!());
  assert.equal(projections.get('US:NVDA')?.isDeleted,true);
  assert.equal(projections.get('US:NEW')?.slug,'new-company');
  assert.equal(opened.rows.decodedCount!(),1);
 }finally{opened.close();await rm(f.directory,{recursive:true,force:true});}
});

for(const collection of ['instruments','company_fundamentals','company_relationships'] as const){
 test(`${collection}: SQLite lazy reads, indexes, collection isolation and live bypass`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'entity-sqlite-test-')),path=join(directory,'entity.sqlite');
  const builder=entitySqliteBuilder(path,collection);
  builder.add({id:'one',data:{companyId:'US:NVDA',source:'US:NVDA',target:'US:AMD',value:42,updatedAt:new Timestamp(12,345)}});
  builder.add({id:'two',data:{companyId:'US:AMD',source:'US:AMD',value:99}});
  builder.add({id:'deleted',data:{isDeleted:true}});builder.finish(new Timestamp(13,0));
  const opened=openEntitySqlite(path,undefined,collection);
  try{
   assert.throws(()=>openEntitySqlite(path),/Wrong SQLite snapshot collection/);
   const sdk=new Firestore({projectId:'test-'+collection}),db=observeFirestore(sdk,()=>{});
   const loaded:string[]=[];
   const raw={collection:(name:string)=>({doc:(id:string)=>({id,name})}),getAll:async(...refs:{id:string;name:string}[])=>refs.map(ref=>({id:ref.id,exists:true,data:()=>({value:77,companyId:'US:AMD',isDeleted:false})}))} as unknown as Firestore;
   enableCompanyDirectory(db,raw,{sync:false,file:async name=>{loaded.push(name);return name===collection?opened.rows:new Map();}});
   assert.equal(opened.rows.decodedCount!(),0);
   const docs=await db.getAll(db.collection(collection).doc('one'));
   assert.equal(docs[0].get('value'),42);assert.equal(docs[0].ref.path,`${collection}/one`);
   assert.equal(opened.rows.decodedCount!(),1);
   assert.equal((await db.collection(collection).where('companyId','==','US:NVDA').get()).size,1);
   assert.equal(opened.rows.decodedCount!(),1);
   assert.equal((await db.collection('companies').doc('one').get()).exists,false);
   assert.deepEqual(loaded,[collection,'companies']);
   assert.equal((await db.collection(collection).doc('deleted').get()).exists,false);
   assert.equal(withLiveCompanyReads(()=>companySourceSnapshot(db,db.collection(collection).doc('one'))),undefined);
   await refreshCompanyDirectoryIds(db,['one'],collection);
   assert.equal((await db.collection(collection).doc('one').get()).get('value'),77);
   assert.equal((await db.collection(collection).where('companyId','==','US:NVDA').get()).size,0);
   assert.equal((await db.collection(collection).where('companyId','==','US:AMD').get()).size,2);
  }finally{opened.close();await rm(directory,{recursive:true,force:true});}
 });
}
