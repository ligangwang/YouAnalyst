import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { loadIncrementalSitemap } from '../../src/lib/central-cache/sitemap';

test('sitemap loads once, queries deltas, applies deletes/recreation and retries failures without losing checkpoint',async()=>{
 let tick=1,version='one',fail=false;let rows=[{id:'ORG:A',data:{name:'A',status:'PUBLISHED'}}];let deleted:string[]=[];
 const queries:{collection:string;filters:[string,string,unknown][]}[]=[];
 const snap=(row:typeof rows[number])=>({id:row.id,exists:true,data:()=>row.data,get:(key:string)=>(row.data as Record<string,unknown>)[key]});
 const db={collection:(collection:string)=>{
  const query=(filters:[string,string,unknown][]=[]):unknown=>({
   where:(field:unknown,op:string,value:unknown)=>query([...filters,[String(field),op,value]]),orderBy:()=>query(filters),select:()=>query(filters),limit:()=>query(filters),
   get:async()=>{queries.push({collection,filters});if(fail)throw Error('offline');const docs=collection==='companies'?rows.map(snap):deleted.map((id,i)=>({id:`deleted${i}`,exists:true,data:()=>({sourceId:id}),get:()=>id}));return {docs,size:docs.length};},
   doc:()=>({get:async()=>({readTime:new Timestamp(tick,0),get:(key:string)=>key==='enabled'?true:{companies:version}})})
  });return query();
 },getAll:async(...refs:unknown[])=>refs.slice(0,-1).map(()=>rows[0]?snap(rows[0]):({id:'ORG:A',exists:false}))} as unknown as Firestore;
 const first=await loadIncrementalSitemap(db,'ORG:');assert.equal(first.length,1);assert.equal(queries.length,1);assert.ok(!queries[0].filters.some(([f])=>f==='cacheUpdatedAt'));
 await loadIncrementalSitemap(db,'ORG:');assert.equal(queries.length,1);
 tick=2;version='two';rows=[{id:'ORG:A',data:{name:'A',status:'DRAFT'}}];fail=true;await assert.rejects(loadIncrementalSitemap(db,'ORG:'),/offline/);fail=false;
 assert.deepEqual(await loadIncrementalSitemap(db,'ORG:'),[]);
 const delta=queries.filter(q=>q.collection==='companies').at(-1)!;assert.equal((delta.filters.find(([f,op])=>f==='cacheUpdatedAt'&&op==='>=')![2] as Timestamp).seconds,1);
 tick=3;version='three';rows=[{id:'ORG:A',data:{name:'A',status:'PUBLISHED'}}];deleted=['ORG:A'];assert.equal((await loadIncrementalSitemap(db,'ORG:')).length,1,'recreated document survives old deletion marker');
 tick=4;version='four';rows=[];assert.deepEqual(await loadIncrementalSitemap(db,'ORG:'),[],'hard deletion removes URL');
});


test('incremental sitemap pagination retains the timestamp required by snapshot cursors',async()=>{
 let version='one',page=0;const selected:string[][]=[];
 const db={collection:(collection:string)=>{
  const query=(fields:string[]=[],incremental=false,cursor=false):unknown=>({
   where:(field:unknown)=>query(fields,incremental||String(field)==='cacheUpdatedAt',cursor),
   orderBy:()=>query(fields,incremental,cursor),select:(...next:string[])=>{selected.push(next);return query(next,incremental,cursor);},
   limit:()=>query(fields,incremental,cursor),
   startAfter:(doc:{get:(key:string)=>unknown})=>{assert.ok(doc.get('cacheUpdatedAt'),'Firestore requires the ordered field in the cursor snapshot');return query(fields,incremental,true);},
   get:async()=>{
    if(collection!=='companies'||!incremental||cursor)return {docs:[],size:0};
    page++;
    const docs=Array.from({length:200},(_,i)=>({id:`ORG:A${i}`,exists:true,data:()=>({name:`A${i}`,status:'PUBLISHED'}),get:(key:string)=>fields.includes(key)&&key==='cacheUpdatedAt'?new Timestamp(1,0):undefined}));
    return {docs,size:docs.length};
   },
   doc:()=>({get:async()=>({readTime:new Timestamp(2,0),get:(key:string)=>key==='enabled'?true:{companies:version}})})
  });return query();
 }} as unknown as Firestore;
 await loadIncrementalSitemap(db,'ORG:');version='two';
 assert.equal((await loadIncrementalSitemap(db,'ORG:')).length,200);assert.equal(page,1);
 assert.ok(selected.at(-1)!.includes('cacheUpdatedAt'));
});
