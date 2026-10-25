import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchEodhdMarketPrices} from '../../src/lib/predictions/eod-prices';

test('existing token-only A-share configuration retains dated single-symbol acquisition',async t=>{
  const keys=['EODHD_API_TOKEN','EODHD_BULK_EOD_BUCKET','NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET'] as const;
  const previous=keys.map(key=>process.env[key]);
  t.after(()=>keys.forEach((key,i)=>{if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];}));
  process.env.EODHD_API_TOKEN='test-only';
  delete process.env.EODHD_BULK_EOD_BUCKET;delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const paths:string[]=[];
  t.mock.method(globalThis,'fetch',async(url:URL)=>{
    paths.push(url.pathname);assert.equal(url.searchParams.get('from'),'2026-09-11');assert.equal(url.searchParams.get('to'),'2026-09-11');
    return Response.json([{date:'2026-09-11',open:10,high:12,low:9,close:11,adjusted_close:11,volume:100}]);
  });
  const result=await fetchEodhdMarketPrices(['XSHG:600584'],'2026-09-11','2026-09-11T12:00:00Z','CN_A');
  assert.deepEqual(paths,['/api/eod/600584.SHG']);assert.equal(result.prices.length,1);assert.equal(result.failures.length,0);
});
