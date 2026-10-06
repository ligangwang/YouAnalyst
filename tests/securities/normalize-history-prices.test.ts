import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHistoryPrices} from '../../src/lib/predictions/normalize-history-prices';

test('cached history adds raw-close metadata once, preserving scoring prices and previewing without writes',async()=>{
  const docs=new Map<string,Record<string,unknown>>([
    ['collectors/eod-history_US_MU',{status:'completed',from:'2025-12-31',through:'2026-01-02'}],
    ['eod_prices/US_MU_2025-12-31',{ticker:'MU',market:'US',tradingDate:'2025-12-31',isFinal:true,close:99,source:'legacy'}],
    ['eod_prices/US_MU_2026-01-02',{ticker:'MU',market:'US',tradingDate:'2026-01-02',isFinal:true,close:110}],
  ]);
  let writes=0;
  const ref=(id:string)=>({get:async()=>({exists:docs.has(id),data:()=>docs.get(id),updateTime:'version'}),update:async(value:Record<string,unknown>,condition:unknown)=>{assert.deepEqual(condition,{lastUpdateTime:'version'});assert.deepEqual(Object.keys(value),['rawClose']);writes++;docs.set(id,{...docs.get(id),...value});}});
  const db={collection:(name:string)=>({doc:(id:string)=>ref(`${name}/${id}`)}),getAll:async(...refs:ReturnType<typeof ref>[])=>Promise.all(refs.map(r=>r.get()))};
  const bucket={file:(path:string)=>{assert.equal(path,'eod-history/US/MU/2025-12-31_2026-01-02.json');return {download:async()=>[Buffer.from(JSON.stringify(['2025-12-31','2026-01-02'].map((date,i)=>({date,open:100+i*10,high:101+i*10,low:99+i*10,close:100+i*10,adjusted_close:90+i*10,volume:100}))))]};}};
  const input={db:db as never,bucket:bucket as never,tickers:['MU','MU']};
  assert.deepEqual(await normalizeHistoryPrices(input),{stocks:1,updated:2,existing:0,missing:0});assert.equal(writes,0);
  await normalizeHistoryPrices({...input,write:true});assert.equal(writes,2);
  assert.equal(docs.get('eod_prices/US_MU_2025-12-31')?.close,99);assert.equal(docs.get('eod_prices/US_MU_2025-12-31')?.source,'legacy');assert.equal(docs.get('eod_prices/US_MU_2025-12-31')?.rawClose,100);
  assert.deepEqual(await normalizeHistoryPrices({...input,write:true}),{stocks:1,updated:0,existing:2,missing:0});assert.equal(writes,2);
});
