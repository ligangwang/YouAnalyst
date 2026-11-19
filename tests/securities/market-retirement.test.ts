import test from 'node:test';
import assert from 'node:assert/strict';
import {assertReadControl} from '../../src/lib/market-store/read-control';
import {eventsMode} from '../../src/lib/market-store/events-control';
import {fundamentalsMode} from '../../src/lib/market-store/fundamentals-control';
import type {DocumentSnapshot} from 'firebase-admin/firestore';

test('retired sources cannot be re-enabled by lowering a migration read gate',()=>{
    const retired={version:1,ready:false,cleanupAuthorized:true,cleanedCollections:['tickers']};
    assert.throws(()=>assertReadControl(retired),/fallback is retired/);
    for(const mode of [eventsMode,fundamentalsMode]){
        assert.throws(()=>mode({data:()=>retired} as unknown as DocumentSnapshot),/fallback is retired/);
        assert.equal(mode({data:()=>({...retired,ready:true})} as unknown as DocumentSnapshot).ready,true);
    }
});
test('unmigrated events and retained operational state still have a native read gate',()=>{
    assert.equal(eventsMode({data:()=>({version:1,ready:false})} as unknown as DocumentSnapshot).ready,false);
    assert.doesNotThrow(()=>assertReadControl({version:1,ready:false,cleanedCollections:[]}));
    assert.doesNotThrow(()=>assertReadControl({version:1,ready:true,cleanedCollections:['companies']}));
    assert.throws(()=>assertReadControl(undefined),/missing or invalid/);
});
import {splitRecord} from '../../src/lib/market-store/policy';
test('CNI source pages use Parquet while leases and authored records retain their data',()=>{
    const id='_cni_batch_page_0',companies=[{id:'XSHE:000001'}];
    assert.deepEqual(splitRecord('directory_syncs',id,{companies}),{external:{companies},retained:{}});
    for(const doc of [{companies,leaseOwner:'worker'},{companies:[{createdBy:'editor'}]}]){
        assert.deepEqual(splitRecord('directory_syncs',id,doc),{external:{},retained:doc});
    }
    assert.deepEqual(splitRecord('directory_syncs','_cni_batch',{offset:7}).retained,{offset:7});
});
test('graph source identities use Parquet and graph processing state stays transactional',()=>{
    const id='_graph_source_sec_123',source={company:{ticker:'A'},filing:{accessionNumber:'123'},createdAt:'2026-11-18'};
    assert.deepEqual(splitRecord('company_research_runs',id,source),{external:source,retained:{}});
    for(const doc of [{...source,leaseOwner:'worker'},{...source,company:{reviewedBy:'editor'}}]){
        assert.deepEqual(splitRecord('company_research_runs',id,doc),{external:{},retained:doc});
    }
});

test('published financials on an authored company keep editorial data separate',async()=>{
    const {splitRecord}=await import('../../src/lib/market-store/policy');
    const financials={value:{revenue:123},marketCap:{value:345},version:1,isDeleted:false};
    const editorial={createdBy:'editor',pending:true};
    assert.deepEqual(splitRecord('company_fundamentals','US:AMD',{...financials,...editorial}),{external:financials,retained:editorial});
});
