import test from 'node:test';import assert from 'node:assert/strict';import type {Firestore} from 'firebase-admin/firestore';import {loadSitemapPaths} from '../../src/lib/local-cache/sitemaps';
test('Parquet sitemaps project the directory once across all cursor pages and buckets',async()=>{
 const prior={enabled:process.env.MARKET_PARQUET_ENABLED,probe:process.env.MARKET_READ_ONLY_PROBE,service:process.env.K_SERVICE,job:process.env.CLOUD_RUN_JOB};
 process.env.MARKET_PARQUET_ENABLED='1';process.env.MARKET_READ_ONLY_PROBE='1';delete process.env.K_SERVICE;delete process.env.CLOUD_RUN_JOB;
 let reads=0;const docs=Array.from({length:1201},(_,i)=>({id:'US:A'+i,data:()=>({name:'Company '+i,slug:'company-'+i})}));
 const query={select:(...fields:string[])=>{assert.deepEqual(fields,['name','slug','status','market','isDeleted','source','sourceLabel']);return query;},orderBy:()=>query,limit:()=>{throw Error('Parquet projection must not rescan cursor pages');},get:async()=>{reads++;return {docs,size:docs.length};}};
 try{const db={collection:()=>query} as unknown as Firestore;const [a,b]=await Promise.all([loadSitemapPaths(db,'US:A'),loadSitemapPaths(db,'ORG:')]);assert.equal(a.length,1201);assert.deepEqual(b,[]);assert.equal(reads,1);}
 finally{for(const [name,value]of Object.entries({MARKET_PARQUET_ENABLED:prior.enabled,MARKET_READ_ONLY_PROBE:prior.probe,K_SERVICE:prior.service,CLOUD_RUN_JOB:prior.job})){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
