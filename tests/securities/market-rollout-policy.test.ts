import test from 'node:test';
import assert from 'node:assert/strict';
import {MARKET_COLLECTIONS,PARQUET_MARKET_COLLECTIONS,DEFERRED_MARKET_COLLECTIONS,isParquetMarketCollection} from '../../src/lib/market-store/policy';
import {marketStoreReady} from '../../src/lib/market-store/runtime';

test('partial cutover excludes native events and fundamentals from routing and cleanup scope',()=>{
    assert.equal(MARKET_COLLECTIONS.length,19);
    assert.equal(PARQUET_MARKET_COLLECTIONS.length,17);
    assert.deepEqual([...DEFERRED_MARKET_COLLECTIONS],['events','company_fundamentals']);
    const names=['MARKET_PARQUET_ENABLED','MARKET_PARQUET_READ_READY','K_SERVICE','CLOUD_RUN_JOB'] as const;
    const previous=names.map(name=>process.env[name]);
    try{
        process.env.MARKET_PARQUET_ENABLED='1';process.env.MARKET_PARQUET_READ_READY='1';process.env.K_SERVICE='ifindata-web';delete process.env.CLOUD_RUN_JOB;
        assert.equal(marketStoreReady(),true);
        for(const name of DEFERRED_MARKET_COLLECTIONS){assert.equal(isParquetMarketCollection(name),false);assert.equal(marketStoreReady(name),false);}
        assert.equal(marketStoreReady('tickers'),true);
    }finally{names.forEach((name,i)=>{if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i];});}
});
