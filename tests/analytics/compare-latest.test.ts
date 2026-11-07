import assert from 'node:assert/strict';
import {test} from 'node:test';
import {latestSharedCompareDate} from '../../src/lib/compare-latest';

test('latest lookup caps reads at completed market dates and intersects real closes',async()=>{
 const limits:number[]=[],ends:string[]=[];
 const db={collection:()=>({doc:()=>({get:async()=>({get:(key:string)=>key==='status'?'COMPLETED':'2026-11-05'})}),
 where:(_field:unknown,op:string,value:string)=>{
  const symbol=value.includes('MSFT')?'MSFT':'AAPL';
  const query={where:(_f:unknown,_o:string,end:string)=>{ends.push(end);return query;},orderBy:()=>query,limit:(n:number)=>{limits.push(n);return query;},get:async()=>({docs:(symbol==='AAPL'?['2026-11-05','2026-11-04']:['2026-11-04','2026-11-03']).map(tradingDate=>({data:()=>({ticker:symbol,market:'US',tradingDate,close:100})}))})};return query;
 }})} as unknown as FirebaseFirestore.Firestore;
 assert.equal(await latestSharedCompareDate(db,['AAPL','MSFT']),'2026-11-04');
 assert.deepEqual(limits,[60,60]);assert.ok(ends.every(end=>end.endsWith('2026-11-05')));
});
