import test from 'node:test';
import assert from 'node:assert/strict';
import type {Bucket} from '@google-cloud/storage';
import {Timestamp} from 'firebase-admin/firestore';
import {MarketFiles,type MarketRow} from '../../src/lib/market-store/files';
import type {Step} from '../../src/lib/market-store/query';
import {withDuck} from '../../src/lib/price-store/parquet';

const rows:MarketRow[]=[
 ['z',{companyId:'US:AMD',value:3}],['é',{companyId:'US:AMD',value:4}],
 ['a',{companyId:'US:AMD',value:1}],['B',{companyId:'US:AMD',value:2}],
 ['other',{companyId:'US:NVDA'}],['missing',{}],['null',{companyId:null}],['array',{companyId:['US:AMD']}],
].map(([id,data])=>({id:id as string,data:data as Record<string,unknown>,version:Timestamp.fromMillis(123)}));
const where:Step={method:'where',args:['companyId','==','US:AMD']};

test('company merged filtering matches SQL ordering, paging and projection',async()=>{
 const files=new MarketFiles({} as Bucket);
 try{
  for(const tail of [[],[{method:'offset',args:[1]},{method:'limit',args:[2]}],[{method:'select',args:['value']}],[{method:'select',args:[]},{method:'offset',args:[2]},{method:'limit',args:[1]}]] as Step[][]){
   const actual=await files.filter(rows,[where,...tail]);
   const sql=await files.filter(rows,[where,{method:'orderBy',args:['__name__','asc']},...tail]);
   assert.deepEqual(actual,sql);
  }
  assert.deepEqual((await files.filter(rows,[where])).map(row=>row.id),['B','a','z','é']);
  assert.deepEqual(await files.filter(rows,[{method:'where',args:['companyId','==','US:ABSENT']}]),[]);
  assert.deepEqual((await files.filter(rows,[where,{method:'where',args:['value','>',2]}])).map(row=>row.id),['z','é']);
  assert.deepEqual((await files.filter(rows,[where,{method:'orderBy',args:['value','desc']}])).map(row=>row.id),['é','z','B','a']);
 }finally{await files.close();}
});

test('company equality merge completes while unrelated DuckDB work holds the queue',async()=>{
 const files=new MarketFiles({} as Bucket);
 let release!:()=>void,started!:()=>void;
 const hold=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>started=resolve);
 const blocker=withDuck(async()=>{started();await hold;});
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  await ready;
  const result=await Promise.race([files.filter(rows,[where]),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Company merge waited for unrelated scan')),1000);})]);
  assert.equal(result.length,4);
 }finally{clearTimeout(timer);release();await blocker;await files.close();}
});
