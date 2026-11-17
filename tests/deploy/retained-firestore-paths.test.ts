import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedReadReady,eodLeasePath,companyQueryParents} from '../../scripts/lib/retained-firestore-paths.mjs';
import {verifyExchangeRegion} from '../../scripts/firestore/verify-exchange-region.mjs';
const control=(ready:boolean)=>({fields:{version:{integerValue:'1'},ready:{booleanValue:ready},cleanupAuthorized:{booleanValue:ready}}});
test('deployment checks switch physical paths only at read cutover and fail closed',async()=>{
    for(const ready of [false,true]){
        assert.equal(await retainedReadReady('project','token',async()=>Response.json(control(ready))),ready);
        assert.equal(eodLeasePath('US',ready),ready?'market_state/eod_runs/records/_queue_US':'eod_runs/_queue_US');
        assert.deepEqual(companyQueryParents(ready),ready?['market_state/companies','market_ugc/companies']:['']);
    }
    assert.equal(await retainedReadReady('project','token',async()=>new Response('',{status:404})),false);
    await assert.rejects(retainedReadReady('project','token',async()=>new Response('',{status:503})),/unavailable/);
    await assert.rejects(retainedReadReady('project','token',async()=>Response.json({fields:{}})),/Invalid/);
});
test('company release validation reads both approved roots in one snapshot after retirement',async()=>{
    const queries:string[]=[];let rollback=false;
    const request:typeof fetch=async(input,options)=>{
        const url=String(input);
        if(url.endsWith('_market_parquet_retained_control'))return Response.json(control(true));
        const body=JSON.parse(String(options?.body));
        if(url.endsWith(':beginTransaction'))return Response.json({transaction:'snapshot'});
        assert.equal(body.transaction,'snapshot');
        if(url.endsWith(':rollback')){rollback=true;return Response.json({});}
        assert.equal(body.structuredQuery.from[0].collectionId,'records');queries.push(url);
        const id=url.includes('/market_state/')?'US:AMD':'US:NVDA';
        return Response.json([{document:{name:url.replace(':runQuery','/records/'+id)}}]);
    };
    const result=await verifyExchangeRegion({project:'project',token:'token',request});
    assert.equal(result.usCompanies,2);assert.equal(queries.length,4);assert(rollback);
    assert(queries.every(url=>/\/market_(state|ugc)\/companies:runQuery$/.test(url)));
});
