import test from 'node:test';
import assert from 'node:assert/strict';
import {Firestore,Timestamp} from 'firebase-admin/firestore';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';
import {enableCompanyDirectory} from '../../src/lib/local-cache/company-directory';
import {EntitySync,type ChangeBatch} from '../../src/lib/local-cache/entity-sync';
import type {EntityRows} from '../../src/lib/entity-snapshots/sqlite';
import {loadSupportedCompanyUniverse} from '../../src/lib/company-support/service';
import {loadCnDiscoveryCompany} from '../../src/lib/events/cn-discovery-queue';

test('earnings scheduling awaits snapshot catch-up and workers still read live eligibility',async()=>{
  const supported={name:'Issuer',status:'DIRECTORY',onboarding:{status:'SUPPORTED'}};
  const rows:EntityRows=new Map([
    ['XSHG:600001',supported],['XSHG:600002',supported],['US:A',supported],
  ]);
  rows.watermark=new Timestamp(100,0);
  const sdk=new Firestore({projectId:'earnings-scheduler-test'});
  const db=observeFirestore(sdk,()=>{});
  let next!:(batch:ChangeBatch)=>void,sync!:EntitySync,loads=0;
  let connected!:()=>void;const connection=new Promise<void>(resolve=>{connected=resolve;});
  enableCompanyDirectory(db,{} as Firestore,{
    file:async(_collection,view)=>{loads++;assert.equal(view,true);return rows;},
    sync:(_db,_collection,since,apply)=>{
      assert.equal(since.seconds,100);
      sync=new EntitySync((_since,callback)=>{next=callback;connected();return()=>{};},since,apply);
      return sync;
    },
  });
  try{
    let returned=false;
    const scope=loadSupportedCompanyUniverse(db,'CN').then(value=>{returned=true;return value;});
    await connection;assert.equal(returned,false,'must await current changes before dispatch');
    next({readTime:new Timestamp(101,0),changes:[
      {id:'XSHG:600001',data:{...supported,onboarding:{status:'BLOCKED'}}},
      {id:'XSHG:600002',data:{isDeleted:true}},
      {id:'XSHE:000001',data:supported},
    ]});
    assert.deepEqual((await scope).nodes.map(n=>n.id),['XSHE:000001']);
    assert.equal(loads,1);
    let liveReads=0;
    const live={collection:()=>({doc:(id:string)=>({get:async()=>{
      liveReads++;return {id,exists:true,data:()=>({...supported,onboarding:{status:'BLOCKED'}})};
    }})})} as unknown as Firestore;
    assert.equal((await loadCnDiscoveryCompany(live,'XSHE:000001')).nodes.length,0);
    assert.equal(liveReads,1,'worker must not trust the scheduler snapshot');
  }finally{sync?.close();}
});
