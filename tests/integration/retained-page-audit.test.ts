import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Firestore} from '@google-cloud/firestore';
import {auditRetainedPage} from '../../scripts/lib/audit-retained-page';
import {flushBulkWrites} from '../../scripts/lib/flush-bulk-writes';
import {RETAINED_CONTROL,retainedPath} from '../../src/lib/market-store/retained-store';
const host=process.env.FIRESTORE_EMULATOR_HOST;
if(host&&!/^(localhost|127\.0\.0\.1):\d+$/.test(host))throw Error('Local emulator required');
(host?test:test.skip)('read-only audit checks a full page, detects wrong roots and ghosts, and never repairs data',async t=>{
    const raw=new Firestore({projectId:'demo-audit-'+randomUUID().slice(0,8)}),writer=raw.bulkWriter({throttling:false});
    t.after(async()=>{await writer.close();await raw.terminate();});
    await raw.doc(RETAINED_CONTROL).set({version:1,ready:false,cleanupAuthorized:false});
    const ids=Array.from({length:1000},(_,n)=>'US:'+String(n).padStart(4,'0'));
    const copies=await flushBulkWrites(writer,ids.flatMap(id=>[
        writer.create(raw.doc('companies/'+id),{onboarding:{status:'SUPPORTED'}}),
        writer.create(raw.doc(retainedPath('market_state','companies',id)),{onboarding:{status:'SUPPORTED'}}),
    ]));assert(copies.every(result=>result.status==='fulfilled'));
    assert.deepEqual(await auditRetainedPage(raw,'companies',ids),[]);
    await raw.doc('companies/'+ids[0]).update({reviewedBy:'user'});
    await raw.doc('companies/'+ids[1]).delete();
    const before=await raw.doc(retainedPath('market_state','companies',ids[0])).get();
    assert.deepEqual(await auditRetainedPage(raw,'companies',ids),ids.slice(0,2));
    assert((await before.ref.get()).updateTime!.isEqual(before.updateTime!));
    assert((await raw.doc(retainedPath('market_state','companies',ids[1])).get()).exists);
    await raw.doc(RETAINED_CONTROL).update({ready:true});
    await assert.rejects(auditRetainedPage(raw,'companies',ids),/mirror phase/);
    await assert.rejects(auditRetainedPage(raw,'events',ids),/Invalid/);
});
