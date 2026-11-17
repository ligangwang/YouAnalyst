import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {earningsFirestore} from '../helpers/earnings-firestore';
import {createMapSecObserver} from '../../src/lib/events/sec-disclosures';
import {shardFor} from '../../src/lib/market-store/files';

test('SEC shard deadline preserves partial events and resumes without acknowledging unsaved disclosures',async()=>{
  const previous=process.env.MARKET_PARQUET_ENABLED;process.env.MARKET_PARQUET_ENABLED='1';
  try{
    const f=earningsFirestore(),count=100,cik='0000723125',company='US:MU';
    const payload={cik:723125,filings:{files:[],recent:{
      accessionNumber:Array.from({length:count},(_,i)=>`${cik}-26-${String(i+1).padStart(6,'0')}`),
      form:Array(count).fill('4'),filingDate:Array(count).fill('2026-01-02'),primaryDocument:Array(count).fill('filing.xml'),
    }}};
    const groups:string[][]=[],run=f.db.runTransaction.bind(f.db);let expire=true;
    f.db.runTransaction=((work:Parameters<Firestore['runTransaction']>[0])=>run(async tx=>{
      const ids:string[]=[],create=tx.create.bind(tx);
      tx.create=((ref,data)=>{ids.push(ref.id);return create(ref,data);}) as typeof tx.create;
      const result=await work(tx);
      if(ids.length){groups.push(ids);if(expire){expire=false;f.advance(40_000);}}
      return result;
    })) as typeof f.db.runTransaction;
    const observe=()=>createMapSecObserver(f.db,new Map([[cik,[company]]]),{deadline:f.now()+60_000,now:f.now});
    const archive=async()=>{throw Error('Unexpected archive');};
    const first=observe();await first.observe(cik,payload,archive);
    assert(first.failed.has(company));
    const partial=f.rows.get(`collectors/sec-${company}`)!;
    assert.equal(partial.status,'partial');assert.match(String(partial.lastError),/persistence deadline/);
    assert.equal(partial.lastCompleteAt,undefined);
    assert.equal(partial.confirmedDisclosures,undefined,'No receipts for an incomplete outer batch');
    const committed=new Map([...f.rows].filter(([path])=>path.startsWith('events/')));
    assert(committed.size>0&&committed.size<count);
    const retry=observe();await retry.observe(cik,payload,archive);
    assert.equal(retry.failed.size,0);
    const complete=f.rows.get(`collectors/sec-${company}`)!;
    assert.equal(complete.status,'complete');assert.equal(complete.linkScan,null);
    assert.equal((complete.confirmedDisclosures as unknown[]).length,count);
    assert.equal([...f.rows.keys()].filter(path=>path.startsWith('events/')).length,count);
    for(const [path,row] of committed)assert.deepEqual(f.rows.get(path),row,'Retry preserves original arrival metadata');
    assert(groups.length>1);assert(groups.every(ids=>ids.length<=100&&new Set(ids.map(shardFor)).size===1));
  }finally{if(previous===undefined)delete process.env.MARKET_PARQUET_ENABLED;else process.env.MARKET_PARQUET_ENABLED=previous;}
});
