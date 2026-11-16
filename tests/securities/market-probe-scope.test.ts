import test from 'node:test';
import assert from 'node:assert/strict';
import {marketReadOnlyProbe} from '../../src/lib/market-store/runtime';

test('Parquet read-only verification cannot override the serving website or workers',()=>{
 const keys=['MARKET_READ_ONLY_PROBE','K_SERVICE','CLOUD_RUN_JOB'] as const;
 const before=keys.map(key=>process.env[key]);
 try{
  process.env.MARKET_READ_ONLY_PROBE='1';delete process.env.K_SERVICE;delete process.env.CLOUD_RUN_JOB;
  assert.equal(marketReadOnlyProbe(),true);
  process.env.K_SERVICE='ifindata-web';assert.equal(marketReadOnlyProbe(),false);
  process.env.K_SERVICE='market-parquet-ui-probe';assert.equal(marketReadOnlyProbe(),true);
  process.env.CLOUD_RUN_JOB='market-parquet-ui-probe';assert.equal(marketReadOnlyProbe(),false);
  delete process.env.CLOUD_RUN_JOB;delete process.env.MARKET_READ_ONLY_PROBE;assert.equal(marketReadOnlyProbe(),false);
 }finally{keys.forEach((key,i)=>{if(before[i]===undefined)delete process.env[key];else process.env[key]=before[i];});}
});
