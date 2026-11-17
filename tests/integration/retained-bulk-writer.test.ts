import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Firestore} from '@google-cloud/firestore';
import {flushBulkWrites} from '../../scripts/lib/flush-bulk-writes';
import {boundedOperatorWork} from '../../scripts/lib/bounded-operator-work';
const host=process.env.FIRESTORE_EMULATOR_HOST;
if(host&&!/^(localhost|127\.0\.0\.1):\d+$/.test(host))throw Error('Local emulator required');
(host?test:test.skip)('partial BulkWriter pages finish copying and deleting, including existing IDs',async t=>{
    const db=new Firestore({projectId:'demo-bulk-'+randomUUID().slice(0,8)}),writer=db.bulkWriter({throttling:false});
    t.after(async()=>{await writer.close();await db.terminate();});
    const refs=Array.from({length:93},(_,n)=>db.doc('records/id'+n));
    const pages=Array.from({length:5},(_,n)=>refs.slice(n*23,n*23+23));
    await boundedOperatorWork(pages,4,async page=>{
        const copied=await flushBulkWrites(writer,page.map(ref=>writer.create(ref,{name:ref.id})));
        assert(copied.every(result=>result.status==='fulfilled'));
    });
    assert.equal((await db.collection('records').get()).size,93);
    const duplicate=await flushBulkWrites(writer,[writer.create(refs[0],{name:'duplicate'})]);
    assert.equal(duplicate[0].status,'rejected');assert.equal((await refs[0].get()).get('name'),'id0');
    const deleted=await flushBulkWrites(writer,refs.map(ref=>writer.delete(ref)));
    assert(deleted.every(result=>result.status==='fulfilled'));assert.equal((await db.collection('records').get()).size,0);
});
