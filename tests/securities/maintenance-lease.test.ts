import test from 'node:test';
import assert from 'node:assert/strict';
import {earningsFirestore} from '../helpers/earnings-firestore';
import {acquireMaintenanceLease,acquireMaintenanceLeaseState,releaseMaintenanceLease} from '../../src/lib/maintenance-lease';

test('lease returns checkpoint once and excludes competing executions',async()=>{
  const fx=earningsFirestore(),ref=fx.db.collection('collectors').doc('exchange-map');
  fx.rows.set(ref.path,{afterCompanyId:'XSHE:000063'});
  const lease=await acquireMaintenanceLeaseState(ref,'first',fx.now());
  assert.equal(lease?.checkpoint?.afterCompanyId,'XSHE:000063');
  assert.equal(fx.reads.length,1);
  assert.equal(await acquireMaintenanceLease(ref,'second',fx.now()),false);
  await releaseMaintenanceLease(ref,'second');
  assert.equal(fx.rows.get(ref.path)?.leaseOwner,'first');
  await releaseMaintenanceLease(ref,'first');
  assert.equal(await acquireMaintenanceLease(ref,'second',fx.now()),true);
});
test('retry recovery gets current progress but cannot steal another task lease',async()=>{
  const fx=earningsFirestore(),ref=fx.db.collection('collectors').doc('exchange-map');
  await acquireMaintenanceLease(ref,'first',fx.now(),{execution:'run',index:0,attempt:0});
  await ref.set({afterCompanyId:'XSHG:600000'},{merge:true});
  assert.equal(await acquireMaintenanceLeaseState(ref,'other',fx.now(),{execution:'run',index:1,attempt:1}),null);
  const recovered=await acquireMaintenanceLeaseState(ref,'retry',fx.now(),{execution:'run',index:0,attempt:1});
  assert.equal(recovered?.checkpoint?.afterCompanyId,'XSHG:600000');
  await releaseMaintenanceLease(ref,'first');
  assert.equal(fx.rows.get(ref.path)?.leaseOwner,'retry');
});
test('failed lease commit never returns usable checkpoint state',async()=>{
  const fx=earningsFirestore(),ref=fx.db.collection('collectors').doc('exchange-map');
  fx.reject(()=>true);
  await assert.rejects(()=>acquireMaintenanceLeaseState(ref,'first',fx.now()),/commit failure/);
  assert.equal(fx.rows.has(ref.path),false);
});
