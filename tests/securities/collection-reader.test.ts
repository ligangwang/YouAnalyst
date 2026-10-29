import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';
import {enableCompanyDirectory} from '../../src/lib/local-cache/company-directory';
import {withCacheReadScope} from '../../src/lib/change-cache';
import {loadNewsCollectionContext} from '../../src/lib/intelligence/collectors/source-service';

function fixture(count:number){
  const records=new Map(Array.from({length:count},(_,i)=>['US:C'+String(i).padStart(5,'0'),{
    name:'Company '+i,status:'DIRECTORY',country:'US',onboarding:{status:'SUPPORTED'},
  } as Record<string,unknown>]));
  let reads=0,directoryLoads=0;
  const pages:number[]=[];
  function query(fields:string[]=[],cursor='',limit=0):unknown{return {
    path:'companies',
    where:(field:string,op:string,value:string)=>{assert.deepEqual([field,op,value],['onboarding.status','==','SUPPORTED']);return query(fields,cursor,limit);},
    orderBy:()=>query(fields,cursor,limit),select:(...selected:string[])=>query(selected,cursor,limit),
    startAfter:(id:string)=>query(fields,id,limit),limit:(size:number)=>query(fields,cursor,size),
    onSnapshot:()=>{throw Error('Scheduled reads must not open listeners');},
    get:async()=>{
      reads++;assert.equal(limit,250);assert(fields.includes('onboarding.status'));assert(fields.includes('newsSources'));
      assert(!fields.includes('searchPrefixes'));assert(!fields.includes('searchTerms'));
      const selected=[...records].filter(([id])=>id>cursor).slice(0,limit);pages.push(selected.length);
      return {size:selected.length,docs:selected.map(([id,row])=>({id,exists:true,data:()=>Object.fromEntries(fields.flatMap(field=>{
        if(field==='onboarding.status')return [['onboarding',row.onboarding]];
        return field in row?[[field,row[field]]]:[];
      }))}))};
    },
  };}
  const raw={collection:(name:string)=>{assert.equal(name,'companies');return query();}} as unknown as Firestore;
  const db=observeFirestore(raw,()=>{});
  enableCompanyDirectory(db,raw,{file:async()=>{directoryLoads++;throw Error('Unexpected snapshot directory');}});
  return {db,records,pages,get reads(){return reads;},get directoryLoads(){return directoryLoads;}};
}
const source={id:'company-news',companyId:'US:C00000',name:'Company news',url:'https://example.com/news.rss',allowedHosts:['example.com'],pollMs:60000,status:'PUBLISHED',reviewedAt:'2025-01-01'};

test('news startup pages a shared projected scope without hydrating snapshots or opening listeners',async()=>{
  const f=fixture(501);f.records.get('US:C00000')!.newsSources=[source];
  Object.defineProperty(f.records.get('US:C00000')!,'searchPrefixes',{get:()=>{throw Error('Search index must not load');}});
  const result=await withCacheReadScope(()=>loadNewsCollectionContext(f.db));
  assert.equal(result.graph.nodes.length,501);assert.equal(result.graph.nodes[0].country,'US');
  assert.deepEqual(result.sources.map(s=>s.id),['company-news']);
  assert.deepEqual(f.pages,[250,250,1]);assert.equal(f.reads,3);assert.equal(f.directoryLoads,0);
});

test('fresh scheduled scopes exclude removals and unpublished sources without stale cache reuse',async()=>{
  const f=fixture(3);f.records.get('US:C00000')!.newsSources=[source];
  assert.equal((await loadNewsCollectionContext(f.db)).sources.length,1);
  f.records.get('US:C00000')!.newsSources=[{...source,status:'WITHDRAWN'}];
  f.records.get('US:C00001')!.isDeleted=true;
  f.records.get('US:C00002')!.onboarding={status:'BLOCKED'};
  const current=await loadNewsCollectionContext(f.db);
  assert.equal(current.sources.length,0);assert.deepEqual(current.graph.nodes.map(n=>n.id),['US:C00000']);
  f.records.get('US:C00000')!.supersededByCompanyId='US:OTHER';
  assert.equal((await loadNewsCollectionContext(f.db)).graph.nodes.length,0);
});

test('projection still rejects unapproved publisher configuration',async()=>{
  const f=fixture(1);f.records.get('US:C00000')!.newsSources=[{...source,url:'https://evil.org/feed'}];
  await assert.rejects(loadNewsCollectionContext(f.db),/Unapproved feed/);
});
