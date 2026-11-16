import test from 'node:test';
import assert from 'node:assert/strict';
import {compactHead,pointerRetained} from '../../src/lib/market-store/head-pointer';
import type {MarketHead} from '../../src/lib/market-store/files';

test('compact pointers preserve exact Unicode identities and immutable metadata',()=>{
    const head:MarketHead={collection:'events',shard:'ab',file:'data.parquet',rows:5000,revision:'current',format:7,retained:Array.from({length:5000},(_,i)=>`US:公司-${i}-🧮`)};
    const packed=compactHead(head);
    assert.deepEqual({...packed,retained:pointerRetained(packed)},head);
    assert(JSON.stringify(packed).length<JSON.stringify(head).length/3);
    assert.equal(head.retained.length,5000,'packing must not mutate transactional catalogs');
    assert.deepEqual(pointerRetained(compactHead({...head,retained:[]})),[]);
});
test('corrupt compact catalogs fail closed instead of hiding operational records',()=>{
    const head:MarketHead={collection:'events',shard:'ab',rows:0,retained:['original-id']};
    assert.throws(()=>pointerRetained(head),/Invalid compact/);
    const packed=compactHead(head);packed.retained[0]+='!';
    assert.throws(()=>pointerRetained(packed),/Invalid compact/);
});
