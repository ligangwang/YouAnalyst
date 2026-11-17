import test from 'node:test';
import assert from 'node:assert/strict';
import {Timestamp,type Firestore} from 'firebase-admin/firestore';
import {MarketRepository} from '../../src/lib/market-store/repository';
import type {MarketFiles,MarketRow} from '../../src/lib/market-store/files';

function fixture(){
 const rows=new Map<string,Record<string,unknown>>();let native=0,queries=0,watches=0,transactionReads=0;
 const doc=(id:string)=>({id,path:`earnings_records/${id}`});
 const snapshots=(refs:ReturnType<typeof doc>[])=>refs.map(ref=>({id:ref.id,ref,exists:rows.has(ref.id),updateTime:Timestamp.fromMillis(100),data:()=>rows.get(ref.id),get:(key:string)=>rows.get(ref.id)?.[key]})).reverse();
 const source={doc,where:()=>source,onSnapshot:(next:(value:unknown)=>void)=>{watches++;queueMicrotask(()=>next({docs:[],readTime:Timestamp.now(),docChanges:()=>[]}));return()=>{};}};
 const raw={collection:()=>source,getAll:async(...refs:ReturnType<typeof doc>[])=>{native++;return snapshots(refs);}} as unknown as Firestore;
 let external:MarketRow[]=[];
 const files={query:async()=>{queries++;return external;},hydrate:async(row:MarketRow)=>row,close:async()=>{}} as unknown as MarketFiles;
 const repo=new MarketRepository(raw,files,undefined,true);
 const context=()=>repo.context({get:async()=>{throw Error('Unexpected transactional query');},getAll:async(...refs)=>{transactionReads++;return snapshots(refs as unknown as ReturnType<typeof doc>[]) as unknown as FirebaseFirestore.DocumentSnapshot[];}});
 return {rows,repo,context,external:(value:MarketRow[])=>{external=value;},counts:()=>({native,queries,watches,transactionReads})};
}

test('earnings heads read current pointers in caller order without immutable file work',async()=>{
 const f=fixture();f.rows.set('head_a',{recordType:'head',revisionId:'r1'});f.rows.set('head_b',{recordType:'head',revisionId:'r2'});
 try{
  const first=await f.repo.documents('earnings_records',['head_b','head_a']);
  assert.deepEqual(first.map(row=>[row.id,row.data.revisionId]),[['head_b','r2'],['head_a','r1']]);
  f.rows.set('head_a',{recordType:'head',revisionId:'r3'});
  assert.equal((await f.repo.documents('earnings_records',['head_a']))[0].data.revisionId,'r3');
  const context=f.context();assert.equal((await f.repo.documents('earnings_records',['head_a'],context))[0].data.revisionId,'r3');
  assert(context.documents.has('earnings_records/head_a'));
  assert.deepEqual(f.counts(),{native:2,queries:0,watches:0,transactionReads:1});
 }finally{await f.repo.close();}
});

test('missing or unexpected earnings head records retain the merged-file fallback',async()=>{
 for(const data of [undefined,{recordType:'revision',record:{revisionId:'native'}}]){
  const f=fixture();if(data)f.rows.set('head_legacy',data);
  f.external([{id:'head_legacy',version:Timestamp.now(),data:{recordType:'revision',record:{revisionId:'external'}}}]);
  try{
   const rows=await f.repo.documents('earnings_records',['head_legacy']);
   assert.deepEqual(rows[0].data,{recordType:'revision',record:{revisionId:'external'}});
   assert.deepEqual(f.counts(),{native:1,queries:1,watches:1,transactionReads:0});
  }finally{await f.repo.close();}
 }
});

test('projected earnings reads retain projection-aware storage behavior',async()=>{
 const f=fixture();f.external([{id:'head_a',version:Timestamp.now(),data:{revisionId:'selected'}}]);
 try{
  assert.deepEqual((await f.repo.documents('earnings_records',['head_a'],undefined,['revisionId']))[0].data,{revisionId:'selected'});
  assert.equal(f.counts().queries,1);assert.equal(f.counts().watches,1);
 }finally{await f.repo.close();}
});
