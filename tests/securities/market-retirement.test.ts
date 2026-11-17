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

