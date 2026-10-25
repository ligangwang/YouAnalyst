import assert from 'node:assert/strict';
import {test} from 'node:test';
import {companyWorkRef,companyWorkRequest,parseCompanyWorkRequest,processCompanyRun,processCompanyWork,type CompanyWorkRequest} from '../../src/lib/company-work-queue';
import {pubsubFirestore} from '../helpers/pubsub-firestore';

function fixture(ids=['US:AMD','US:MSFT']){
  const f=pubsubFirestore(),root={batchId:'run-1',requestedAt:'2026-10-01T00:00:00Z'};
  Object.assign(f.db,{getAll:(...refs:FirebaseFirestore.DocumentReference[])=>Promise.all(refs.map(ref=>ref.get()))});
  const ref=f.db.collection('eod_runs').doc('_request_run-1'),state=f.db.collection('eod_runs').doc('_company_pipeline');
  f.rows.set(ref.path,{request:root});
  const published:(typeof root|CompanyWorkRequest)[]=[],work:string[]=[],scores:string[]=[];
  let fail='',more='',finalizeMore=false,publishFails=false;
  const publish=async(message:typeof root|CompanyWorkRequest)=>{if(publishFails)throw Error('publish failed');published.push(message);};
  const parent=()=>processCompanyRun(root,{
    db:f.db,ref,state,collection:'eod_runs',kind:'eod',owner:'parent',plan:async()=>ids,
    prepare:async selected=>Object.fromEntries(selected.map(id=>[id,{price:{ticker:id}}])),publish,
    finalize:async cursor=>{scores.push(cursor??'first');return finalizeMore?'next':null;},
  });
  const child=(id:string)=>{
    const request=companyWorkRequest('eod',root,id);
    return processCompanyWork(request,{
      db:f.db,parent:ref,state,collection:'eod_runs',owner:'child',publish,
      work:async(parent,prepared,cursor)=>{
        assert.deepEqual(parent,root);assert.equal((prepared.price as {ticker:string}).ticker,id);
        work.push(`${id}:${cursor??'first'}`);
        if(id===fail)throw Error('provider failed');
        return id===more&&cursor===null?'page-2':null;
      },
    });
  };
  return {...f,root,ref,state,published,work,scores,parent,child,fail:(id:string)=>{fail=id;},more:(id:string)=>{more=id;},finalizeMore:(v:boolean)=>{finalizeMore=v;},publishFails:(v:boolean)=>{publishFails=v;}};
}

test('bulk cleanup lease fences company planning before any preparation or dispatch',async()=>{
  const f=fixture();
  f.rows.set(f.state.path,{leaseOwner:'bulk-cleanup',leaseExpiresAtMs:Date.now()+60_000});
  await assert.rejects(f.parent(),/maintenance is active/);
  assert.deepEqual(f.published,[]);
  assert.equal(f.rows.get(f.ref.path)?.companyIds,undefined);
  assert.equal(f.rows.get(f.state.path)?.leaseOwner,'bulk-cleanup');
  f.rows.set(f.state.path,{leaseExpiresAtMs:Date.now()-1});
  await f.parent();assert.equal(f.published.filter(m=>'companyId'in m).length,2);
});

test('scores wait for every company and every prediction page; failed tasks and duplicates preserve the barrier',async()=>{
  const f=fixture();
  await f.parent();
  f.fail('US:AMD');
  await assert.rejects(f.child('US:AMD'),/provider failed/);
  await f.child('US:MSFT');
  await f.parent();
  assert.deepEqual(f.scores,[]);
  assert.equal(f.rows.get(f.ref.path)?.completedCompanies,1);
  await f.child('US:MSFT');
  assert.equal(f.rows.get(f.ref.path)?.completedCompanies,1,'duplicate must not increment the counter');
  f.fail('');f.more('US:AMD');
  await f.child('US:AMD');
  await f.parent();assert.deepEqual(f.scores,[],'first prediction page is not company completion');
  await f.child('US:AMD');
  f.finalizeMore(true);await f.parent();
  assert.deepEqual(f.scores,['first']);
  assert.equal(f.rows.get(f.ref.path)?.completed,undefined);
  f.finalizeMore(false);await f.parent();
  assert.deepEqual(f.scores,['first','next']);
  assert.equal(f.rows.get(f.ref.path)?.completed,true);
  assert.equal(f.rows.get(f.state.path)?.activeRequest,null);
  await f.parent();await f.child('US:AMD');
  assert.equal(f.scores.length,2);
});

test('completion counter alone cannot unlock scores without all durable receipts',async()=>{
  const f=fixture();await f.parent();
  f.rows.set(f.ref.path,{...f.rows.get(f.ref.path),completedCompanies:2});
  await assert.rejects(f.parent(),/completion barrier/);
  assert.deepEqual(f.scores,[]);
});

test('a publish failure retains the frozen scope and reuses existing task data',async()=>{
  const f=fixture();f.publishFails(true);
  await assert.rejects(f.parent(),/publish failed/);
  const request=companyWorkRequest('eod',f.root,'US:AMD'),ref=companyWorkRef(f.db,'eod_runs',request.batchId);
  assert.deepEqual(f.rows.get(f.ref.path)?.companyIds,['US:AMD','US:MSFT']);
  const original=f.rows.get(ref.path)?.result;
  f.publishFails(false);await f.parent();
  assert.deepEqual(f.rows.get(ref.path)?.result,original);
  assert.equal(f.rows.get(f.ref.path)?.dispatchCursor,2);
  await f.child('US:AMD');
  f.publishFails(true);
  await assert.rejects(f.child('US:MSFT'),/publish failed/);
  assert.equal(f.rows.get(f.ref.path)?.completedCompanies,2,'receipt persists before last-child notification');
  f.publishFails(false);await f.child('US:MSFT');await f.parent();
  assert.equal(f.scores.length,1,'duplicate last delivery repairs the finalizer publication');
});

test('dispatch pages are bounded and finalization cannot start before all pages dispatch',async()=>{
  const ids=Array.from({length:26},(_,i)=>`US:T${i}`),f=fixture(ids);
  await f.parent();assert.equal(f.published.filter(m=>'companyId'in m).length,25);
  assert.equal(f.rows.get(f.ref.path)?.phase,'companies');
  await f.parent();assert.equal(f.published.filter(m=>'companyId'in m).length,26);
  assert.equal(f.rows.get(f.ref.path)?.phase,'waiting');
  assert.deepEqual(f.scores,[]);
});

test('stale, invented and cross-kind deliveries cannot execute work; leases fence crashed attempts',async()=>{
  const f=fixture();await f.parent();
  await assert.rejects(f.child('US:FAKE'),/Unknown company task/);
  const real=companyWorkRequest('eod',f.root,'US:AMD');
  assert.throws(()=>parseCompanyWorkRequest({...real,companyId:'US:MSFT'},'eod'),/Invalid/);
  assert.throws(()=>parseCompanyWorkRequest(real,'us-market-cap'),/Invalid/);
  f.rows.set(f.state.path,{activeRequest:{batchId:'another-run'}});
  await assert.rejects(f.child('US:AMD'),/not active/);
  assert.deepEqual(f.work,[]);
});

test('one active pipeline excludes another run while its companies or finalization are incomplete',async()=>{
  const f=fixture();await f.parent();
  const root={...f.root,batchId:'run-2'},ref=f.db.collection('eod_runs').doc('_request_run-2');
  f.rows.set(ref.path,{request:root});
  await assert.rejects(processCompanyRun(root,{db:f.db,ref,state:f.state,collection:'eod_runs',kind:'eod',owner:'other',
    plan:async()=>[],prepare:async()=>({}),publish:async()=>{},finalize:async()=>null}),/Previous company run/);
  assert.equal(f.rows.get(ref.path)?.companyIds,undefined);
});

test('a failed completion transaction cannot acknowledge a company or release the score barrier',async()=>{
  const f=fixture();await f.parent();
  const receipt=companyWorkRef(f.db,'eod_runs',companyWorkRequest('eod',f.root,'US:AMD').batchId);
  f.reject((path,data)=>path===receipt.path&&data.completed===true);
  await assert.rejects(f.child('US:AMD'),/transaction failed/);
  assert.equal(f.rows.get(receipt.path)?.completed,false);
  assert.equal(f.rows.get(f.ref.path)?.completedCompanies,0);
  await f.parent();assert.deepEqual(f.scores,[]);
  f.reject(()=>false);await f.child('US:AMD');
  assert.equal(f.rows.get(f.ref.path)?.completedCompanies,1);
});
