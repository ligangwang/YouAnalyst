import test from 'node:test';
import assert from 'node:assert/strict';
import {marketReadOnlyProbe,marketStagedReads} from '../../src/lib/market-store/runtime';

test('staged Parquet reads opt in only a production website revision',()=>{
 const keys=['MARKET_PARQUET_READ_READY','K_SERVICE','CLOUD_RUN_JOB'] as const,before=keys.map(key=>process.env[key]);
 try{
  process.env.MARKET_PARQUET_READ_READY='1';process.env.K_SERVICE='ifindata-web';delete process.env.CLOUD_RUN_JOB;
  assert.equal(marketStagedReads(),true);
  process.env.CLOUD_RUN_JOB='worker';assert.equal(marketStagedReads(),false);delete process.env.CLOUD_RUN_JOB;
  for(const service of ['market-parquet-ui-probe','ifindata-web-staging','sec-fundamentals-subscriber','']){process.env.K_SERVICE=service;assert.equal(marketStagedReads(),false);}
  process.env.K_SERVICE='ifindata-web';delete process.env.MARKET_PARQUET_READ_READY;assert.equal(marketStagedReads(),false);
 }finally{keys.forEach((key,i)=>{if(before[i]===undefined)delete process.env[key];else process.env[key]=before[i];});}
});

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
