import test from 'node:test';
import assert from 'node:assert/strict';
import {readEarningsScheduleCompanies} from '../../src/lib/earnings/scheduler-scope';
import {readCollectionCompanies} from '../../src/lib/company-support/collection-reader';
import {companySnapshotFixture} from '../helpers/company-snapshot';
const supported={name:'Issuer',status:'DIRECTORY',onboarding:{status:'SUPPORTED'}};

test('earnings scheduling shares company memory and applies file-watermark changes before selecting CN scope',async()=>{
 const f=companySnapshotFixture(new Map(['XSHG:600001','XSHG:600002','XSHG:600003','US:A'].map(id=>[id,supported])),[
  {id:'XSHG:600001',data:{...supported,onboarding:{status:'BLOCKED'}}},
  {id:'XSHG:600002',data:{isDeleted:true}},{id:'XSHE:000001',data:supported}]);
 try{
  assert.deepEqual((await readEarningsScheduleCompanies(f.db)).map(c=>c.id),['XSHE:000001','XSHG:600003']);
  await readCollectionCompanies(f.db,[],'US');await readEarningsScheduleCompanies(f.db);
  assert.equal(f.loads,1);assert.equal(f.reads,0);assert.deepEqual(f.boundaries,[f.watermark]);
  f.change([{id:'XSHE:000001',data:{isDeleted:true}}]);
  assert.deepEqual((await readEarningsScheduleCompanies(f.db)).map(c=>c.id),['XSHG:600003']);
 }finally{f.close();}
});
