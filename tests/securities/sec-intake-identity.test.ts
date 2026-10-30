import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Firestore} from 'firebase-admin/firestore';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';
import {enableCompanyDirectory} from '../../src/lib/local-cache/company-directory';
import {readSecIntakeIdentity} from '../../src/lib/sec-filings/download-worker';
import {earningsCompany} from '../../src/lib/earnings/issuers';

function fixture(){
  const rows=new Map<string,Record<string,unknown>>();
  let reads=0;
  const db={collection:(collection:string)=>({doc:(id:string)=>({path:`${collection}/${id}`})}),
    getAll:async(...args:Array<{path:string}|{fieldMask:string[]}>)=>{
      const options=args.pop() as {fieldMask:string[]};assert(options.fieldMask.includes('onboarding.status'));
      const refs=args as Array<{path:string}>;
      assert.equal(refs.length,2,'No universe scans or bulk identity loads');reads+=refs.length;
      return refs.map(ref=>({data:()=>rows.get(ref.path)}));
    }} as unknown as Firestore;
  const put=(id:string,cik:string)=>{
    rows.set(`companies/${id}`,{name:id,status:'DIRECTORY',onboarding:{status:'SUPPORTED'}});
    rows.set(`collectors/sec-identity-${id}`,{companyId:id,cik});
  };
  return {db,rows,put,get reads(){return reads;}};
}

test('production Firestore adapter bypasses company snapshots and listeners for intake validation',async()=>{
  const raw=new Firestore({projectId:'sec-intake-projection-test'});
  let calls=0,directoryLoads=0,cik='0000001234';
  raw.getAll=(async(...args:unknown[])=>{
    calls++;
    assert.deepEqual(args.slice(0,2).map(ref=>(ref as {path:string}).path),['companies/US:AAA','collectors/sec-identity-US:AAA']);
    assert.deepEqual(args[2],{fieldMask:['name','status','isDeleted','supersededByCompanyId','onboarding.status','companyId','cik']});
    return [{exists:true,data:()=>({name:'AAA',status:'DIRECTORY',onboarding:{status:'SUPPORTED'}})},
      {exists:true,data:()=>({companyId:'US:AAA',cik})}];
  }) as unknown as typeof raw.getAll;
  const db=observeFirestore(raw,()=>{});
  enableCompanyDirectory(db,raw,{file:async()=>{directoryLoads++;throw Error('Intake must not hydrate company directory');}});
  assert.equal((await readSecIntakeIdentity(db,'US:AAA')).cik,'0000001234');
  cik='0000005678';
  assert.equal((await readSecIntakeIdentity(db,'US:AAA')).cik,'0000005678');
  assert.equal(calls,2);assert.equal(directoryLoads,0);
});

test('repeated and concurrent deliveries read only their two issuer documents without listeners or global map replacement',async()=>{
  const f=fixture();f.put('US:AAA','0000001234');f.put('US:BBB','0000005678');
  const before=earningsCompany('US:AMD');
  for(let batch=0;batch<20;batch++){
    const identities=await Promise.all(Array.from({length:20},(_,i)=>readSecIntakeIdentity(f.db,i%2?'US:AAA':'US:BBB')));
    identities.forEach((identity,i)=>assert.equal(identity.issuerId,i%2?'sec:0000001234':'sec:0000005678'));
  }
  assert.equal(f.reads,800);assert.equal(earningsCompany('US:AMD'),before);
});

test('each delivery observes identity corrections, removal and support changes',async()=>{
  const f=fixture();f.put('US:AAA','0000001234');
  assert.equal((await readSecIntakeIdentity(f.db,'US:AAA')).cik,'0000001234');
  f.put('US:AAA','0000005678');
  assert.equal((await readSecIntakeIdentity(f.db,'US:AAA')).cik,'0000005678');
  f.rows.delete('collectors/sec-identity-US:AAA');
  await assert.rejects(readSecIntakeIdentity(f.db,'US:AAA'),/Unverified/);
  f.put('US:AAA','0000005678');
  for(const patch of [{isDeleted:true},{supersededByCompanyId:'US:BBB'},{onboarding:{status:'PROCESSING'}},{status:'WITHDRAWN'}]){
    f.put('US:AAA','0000005678');Object.assign(f.rows.get('companies/US:AAA')!,patch);
    await assert.rejects(readSecIntakeIdentity(f.db,'US:AAA'),/not supported/);
  }
  f.rows.delete('companies/US:AAA');
  await assert.rejects(readSecIntakeIdentity(f.db,'US:AAA'),/not supported/);
});

test('intake rejects malformed and mismatched durable SEC identities and reviewed CIK changes',async()=>{
  const f=fixture();
  for(const id of ['XSHE:300308','US:../AAA','US:','ORG:AAA'])await assert.rejects(readSecIntakeIdentity(f.db,id),/Invalid SEC/);
  assert.equal(f.reads,0);
  f.put('US:AAA','0000001234');
  for(const identity of [{companyId:'US:BBB',cik:'0000001234'},{companyId:'US:AAA',cik:'0000000000'},{companyId:'US:AAA',cik:1234},{companyId:'US:AAA',cik:'1234'}]){
    f.rows.set('collectors/sec-identity-US:AAA',identity);
    await assert.rejects(readSecIntakeIdentity(f.db,'US:AAA'),/Unverified/);
  }
  f.put('US:AMD','0000001234');await assert.rejects(readSecIntakeIdentity(f.db,'US:AMD'),/Reviewed issuer CIK changed/);
});
