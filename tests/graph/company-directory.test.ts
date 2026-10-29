import {withThemeCatalog} from '../helpers/theme-catalog';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Firestore,FieldPath} from 'firebase-admin/firestore';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';
import {enableCompanyDirectory,withLiveCompanyReads,refreshCompanyDirectoryIds,withPageEntityReads,companyDirectoryEnabled} from '../../src/lib/local-cache/company-directory';
import {readCompanyLookup} from '../../src/lib/company-lookup-cache';
import {localDocuments,localQuery} from '../../src/lib/local-cache/entities';
import {loadSitemapPaths} from '../../src/lib/local-cache/sitemaps';

function fixture(file:()=>Promise<Map<string,Record<string,unknown>>|undefined>,now=()=>0){
 const sdk=withThemeCatalog(new Firestore({projectId:'test-company-directory'}));
 const db=observeFirestore(sdk,()=>{});
 let reads=0;
 const raw={collection:()=>{reads++;throw Error('unexpected Firestore fallback');}} as unknown as Firestore;
 enableCompanyDirectory(db,raw,{file,now});return {db,reads:()=>reads};
}
const records=()=>new Map([
 ['US:A',{name:'Alpha',slug:'alpha',slugAliases:['old-alpha'],themeIds:['ai'],symbolLower:'a',rank:1,names:{en:'Alpha'}}],
 ['US:B',{name:'Beta',slug:'beta',themeIds:['robotics'],symbolLower:'b',rank:2}],
 ['US:C',{name:'Charlie',themeIds:['ai'],symbolLower:'c',rank:3}],
 ['US:X',{name:'Deleted',isDeleted:true,themeIds:['ai'],symbolLower:'x',rank:4}],
]);

test('parallel page scopes share broad company selectors without leaking into targeted reads',async()=>{
 let loads=0;const f=fixture(async()=>{loads++;return records();});
 await Promise.all(Array.from({length:8},()=>withPageEntityReads(async()=>{
  assert.equal(companyDirectoryEnabled(f.db),false);
  const query=f.db.collection('companies').where('themeIds','array-contains-any',['ai']);
  const [themes,supported]=await Promise.all([
   localQuery(f.db,'companies:themes:ai',query),
   localQuery(f.db,'companies:supported',f.db.collection('companies').where('rank','>=',2)),
  ]);
  assert.deepEqual([...themes.keys()],['US:A','US:C']);
  assert.deepEqual([...supported.keys()],['US:B','US:C']);
  assert.equal(companyDirectoryEnabled(f.db),false,'the caller still uses targeted page reads');
 })));
 assert.equal(loads,1);assert.equal(f.reads(),0);
});
test('company page, aliases, search, themes, batches and sitemap share one file load',async()=>{
 let loads=0;const f=fixture(async()=>{loads++;return records();});
 const collection=f.db.collection('companies');
 const [doc,alias,search,themes,batch,paths]=await Promise.all([
  readCompanyLookup(f.db,collection.doc('US:A')),
  readCompanyLookup(f.db,collection.where('slugAliases','array-contains','old-alpha').limit(2)),
  collection.where('symbolLower','>=','b').where('symbolLower','<=','c').select('name').get(),
  localDocuments(f.db,'companies'),
  f.db.getAll(collection.doc('US:B'),collection.doc('US:X'),collection.doc('US:MISSING')),
  loadSitemapPaths(f.db,'US:A'),
 ]);
 assert.equal(doc.get('name'),'Alpha');assert.deepEqual(alias.docs.map(d=>d.id),['US:A']);
 assert.deepEqual(search.docs.map(d=>d.data()),[{name:'Beta'},{name:'Charlie'}]);
 assert.deepEqual(themes?.map(d=>d.id),['US:A','US:B','US:C']);
 assert.deepEqual(batch.map(d=>d.exists),[true,false,false]);assert.ok(paths.length);
 assert.equal(loads,1);assert.equal(f.reads(),0);
 const mutable=doc.data()!;mutable.name='Wrong';mutable.names.en='Wrong';
 assert.equal((await collection.doc('US:A').get()).get('names.en'),'Alpha');
});
test('ordering, cursor, document-ID filter, projection and limit preserve query selection',async()=>{
 const {db}=fixture(async()=>records());const c=db.collection('companies');
 const first=await c.orderBy('rank','desc').limit(1).get();assert.equal(first.docs[0].id,'US:C');
 const next=await c.orderBy('rank','desc').startAfter(first.docs[0]).limit(1).get();assert.equal(next.docs[0].id,'US:B');
 assert.deepEqual((await c.where(FieldPath.documentId(),'in',['US:A','US:C']).get()).docs.map(d=>d.id),['US:A','US:C']);
 assert.deepEqual((await c.select('names.en').where('slug','==','alpha').get()).docs[0].data(),{names:{en:'Alpha'}});
 assert.deepEqual((await c.orderBy('rank').startAt(2).endBefore(3).get()).docs.map(d=>d.id),['US:B']);
});
test('empty files and file errors never trigger a directory scan',async()=>{
 const empty=fixture(async()=>new Map());assert.equal((await empty.db.collection('companies').get()).size,0);assert.equal(empty.reads(),0);
 const failure=fixture(async()=>{throw Error('permission denied');});await assert.rejects(failure.db.collection('companies').get(),/permission denied/);assert.equal(failure.reads(),0);
});
test('missing file loads Firestore once; daily refresh is coalesced and retains last good data on error',async()=>{
 let time=0,loads=0,reads=0;
 const sdk=new Firestore({projectId:'test-fallback'}),db=observeFirestore(sdk,()=>{});
 const query={orderBy:()=>query,limit:()=>query,get:async()=>{reads++;return {size:1,docs:[{id:'US:A',data:()=>({name:'Alpha'})}]};}};
 enableCompanyDirectory(db,{collection:()=>query} as unknown as Firestore,{now:()=>time,file:async()=>{loads++;if(loads>1)throw Error('storage unavailable');return undefined;}});
 await Promise.all(Array.from({length:10},()=>db.collection('companies').doc('US:A').get()));
 assert.equal(reads,1);assert.equal(loads,1);
 time=86_400_001;assert.equal((await db.collection('companies').doc('US:A').get()).get('name'),'Alpha');
 assert.equal(reads,1);assert.equal(loads,2);
});
test('explicit live reads bypass file cache',async()=>{
 let reads=0;
 const raw={collection:()=>({path:'companies',doc:()=>({path:'companies/US:A',id:'US:A',get:async()=>{reads++;return {exists:true,data:()=>({name:'Live'})};}})})} as unknown as Firestore;
 const db=observeFirestore(raw,()=>{});enableCompanyDirectory(db,raw,{file:async()=>records()});
 assert.equal((await db.collection('companies').doc('US:A').get()).get('name'),'Alpha');
 assert.equal((await withLiveCompanyReads(()=>db.collection('companies').doc('US:A').get())).data()?.name,'Live');assert.equal(reads,1);
});
test('committed company updates replace memory and survive an older daily file',async()=>{
 let time=0;const sdk=new Firestore({projectId:'test-write-refresh'}),db=observeFirestore(sdk,()=>{});
 let live={name:'New',isDeleted:false,searchPrefixes:Array.from({length:150},(_,i)=>String(i))};
 const raw={collection:()=>({doc:(id:string)=>({id})}),getAll:async(...refs:{id:string}[])=>refs.map(ref=>({id:ref.id,exists:true,data:()=>({...live})}))} as unknown as Firestore;
 enableCompanyDirectory(db,raw,{file:async()=>records(),now:()=>time});
 const ref=db.collection('companies').doc('US:A');assert.equal((await ref.get()).get('name'),'Alpha');
 await refreshCompanyDirectoryIds(db,['US:A']);assert.equal((await ref.get()).get('name'),'New');
 time=86_400_001;assert.equal((await ref.get()).get('name'),'New');
 live={...live,isDeleted:true};await refreshCompanyDirectoryIds(db,['US:A']);assert.equal((await ref.get()).exists,false);
});
test('transactions bypass the directory even after a cached read',async()=>{
 let reads=0;
 const ref={id:'US:A',path:'companies/US:A'};
 const raw={collection:()=>({path:'companies',doc:()=>ref}),runTransaction:async(work:(tx:unknown)=>Promise<unknown>)=>work({get:async()=>{reads++;return {ref,exists:true,data:()=>({name:'Live'})};}})} as unknown as Firestore;
 const db=observeFirestore(raw,()=>{});enableCompanyDirectory(db,raw,{file:async()=>records()});
 assert.equal((await readCompanyLookup(db,db.collection('companies').doc('US:A'))).get('name'),'Alpha');
 const name=await db.runTransaction(async tx=>(await tx.get(db.collection('companies').doc('US:A'))).data()?.name);
 assert.equal(name,'Live');assert.equal(reads,1);
});
