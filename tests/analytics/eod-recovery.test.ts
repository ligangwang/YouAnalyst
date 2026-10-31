import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pubsubFirestore} from '../helpers/pubsub-firestore';
import {companyWorkRequest,companyWorkRef} from '../../src/lib/company-work-queue';
import {digest} from '../../src/lib/fundamentals/pubsub';
import {EOD_COMPANY_RECOVERY_MS,retireExpiredEodRun} from '../../src/lib/predictions/eod-recovery';
import {processEodCompanyMessage,type EodCompanyRunRequest,type EodMessage} from '../../src/lib/predictions/eod-company-queue';
import {queueEodMaintenance} from '../../src/lib/predictions/eod-pubsub';

function fixture(){
  const f=pubsubFirestore(),now=Date.now();
  const request:EodCompanyRunRequest={version:2,type:'eod.company-run.requested',batchId:'old',requestedAt:new Date(now-EOD_COMPANY_RECOVERY_MS-1).toISOString(),input:{market:'US',runDate:'2026-10-26'}};
  const parent=f.db.collection('eod_runs').doc('_request_old'),state=f.db.collection('eod_runs').doc('_company_pipeline');
  const tasks=['US:AMD','US:AGNPF'].map(id=>companyWorkRequest('eod',request,id));
  f.rows.set(state.path,{activeRequest:request});
  f.rows.set(parent.path,{request,companyIds:tasks.map(t=>t.companyId),phase:'waiting',dispatchCursor:2,completedCompanies:1});
  tasks.forEach((task,index)=>f.rows.set(companyWorkRef(f.db,'eod_runs',task.batchId).path,{request:task,result:{},completed:index===0}));
  const dispatch=`eod_runs/_dispatch_${digest(request.input)}`;
  f.rows.set(dispatch,{activeRequest:request});
  return {...f,now,request,parent,state,tasks,dispatch};
}

test('expired incomplete EOD retires visibly failed, preserves receipts, and allows a later run',async()=>{
  const f=fixture(),messages:EodMessage[]=[];
  assert.equal(await retireExpiredEodRun(f.db,f.now),'old');
  assert.equal(f.rows.get(f.parent.path)?.status,'FAILED');
  assert.equal(f.rows.get(f.parent.path)?.completedCompanies,1);
  assert.equal(f.rows.get('eod_runs/US_2026-10-26')?.status,'FAILED');
  assert.equal(f.rows.get(f.dispatch)?.activeRequest,null);
  assert.equal(f.rows.get(companyWorkRef(f.db,'eod_runs',f.tasks[1].batchId).path)?.completed,false);
  const late=await processEodCompanyMessage(f.tasks[1],f.db,f.log,async()=>{}, {run:async()=>{throw Error('Must not execute stale work');}});
  assert.ok('retired' in late&&late.retired===true);
  await queueEodMaintenance({market:'US',runDate:'2026-10-27'},f.db,async m=>{messages.push(m);});
  const publish=async(m:EodMessage)=>{messages.push(m);};
  await processEodCompanyMessage(messages.shift()!,f.db,f.log,publish);
  const next=messages.shift()!;
  await processEodCompanyMessage(next,f.db,f.log,publish,{plan:async()=>['US:AMD'],prepare:async()=>({})});
  assert.equal((f.rows.get(f.state.path)?.activeRequest as EodMessage).batchId,next.batchId);
});

test('recovery preserves retry window and never retires active children, parent, or maintenance',async()=>{
  const f=fixture();
  assert.equal(await retireExpiredEodRun(f.db,f.now-2),null);
  f.rows.get(f.parent.path)!.startedAt=new Date(f.now).toISOString();
  assert.equal(await retireExpiredEodRun(f.db,f.now),null,'old queued requests get a full budget after starting');
  delete f.rows.get(f.parent.path)!.startedAt;
  const child=f.rows.get(companyWorkRef(f.db,'eod_runs',f.tasks[1].batchId).path)!;
  child.leaseExpiresAtMs=f.now+1000;
  assert.equal(await retireExpiredEodRun(f.db,f.now),null);
  delete child.leaseExpiresAtMs;
  f.rows.get(f.parent.path)!.leaseExpiresAtMs=f.now+1000;
  assert.equal(await retireExpiredEodRun(f.db,f.now),null);
  delete f.rows.get(f.parent.path)!.leaseExpiresAtMs;
  f.rows.get(f.state.path)!.leaseExpiresAtMs=f.now+1000;
  assert.equal(await retireExpiredEodRun(f.db,f.now),null);
  assert.equal(f.rows.get(f.parent.path)?.completed,undefined);
});

test('recovery does not discard undispatched work or a successful run awaiting finalization',async()=>{
  const f=fixture();
  f.rows.get(f.parent.path)!.phase='companies';
  assert.equal(await retireExpiredEodRun(f.db,f.now),null);
  f.rows.get(f.parent.path)!.phase='waiting';
  f.rows.get(companyWorkRef(f.db,'eod_runs',f.tasks[1].batchId).path)!.completed=true;
  assert.equal(await retireExpiredEodRun(f.db,f.now),null);
});

test('failed recovery transaction cannot release the barrier or partially retire a run',async()=>{
  const f=fixture();f.reject((path)=>path==='eod_runs/US_2026-10-26');
  await assert.rejects(retireExpiredEodRun(f.db,f.now),/transaction failed/);
  assert.equal(f.rows.get(f.parent.path)?.completed,undefined);
  assert.equal((f.rows.get(f.state.path)?.activeRequest as EodMessage).batchId,'old');
});

test('historical replay fails visibly instead of advancing across a retired incomplete date',async()=>{
  const f=fixture(),messages:EodMessage[]=[];
  await queueEodMaintenance({market:'US',runDate:'2026-10-26',rollForward:true},f.db,async m=>{messages.push(m);});
  await processEodCompanyMessage(messages.shift()!,f.db,f.log,async m=>{messages.push(m);});
  const replay=messages.shift()! as EodCompanyRunRequest;
  const ref=`eod_runs/_request_${replay.batchId}`;
  Object.assign(f.rows.get(ref)!,{dates:['2026-10-26','2026-10-27'],dateIndex:0});
  f.rows.set(`eod_runs/_request_${digest({replay:replay.batchId,date:'2026-10-26'})}`,{completed:true,status:'FAILED'});
  const outcome=await processEodCompanyMessage(replay,f.db,f.log,async()=>{throw Error('Must not advance');});
  assert.ok('status' in outcome&&outcome.status==='FAILED');
  assert.equal(f.rows.get(ref)?.dateIndex,0);
});
