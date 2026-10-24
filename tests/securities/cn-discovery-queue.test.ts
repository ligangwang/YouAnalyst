import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCnDiscoveryTask,publishCnDiscoveryTasks,processCnDiscoveryTask,loadCnDiscoveryCompany} from '../../src/lib/events/cn-discovery-queue';
import {collectCnMapDisclosures} from '../../src/lib/events/cn-disclosures';
import {collectLiveEarnings} from '../../src/lib/earnings/live-collector';
import {configureEarningsMap,restoreEarningsFixtures} from '../../src/lib/earnings/issuers';
import {discoverEarningsSource} from '../../src/lib/earnings/live-store';
import {acquireMaintenanceLease,releaseMaintenanceLease} from '../../src/lib/maintenance-lease';
import {earningsFirestore} from '../helpers/earnings-firestore';
import type {KnowledgeGraph} from '../../src/lib/knowledge-graph/model';
import type {MaintenanceLog} from '../../src/lib/maintenance-log';
import type {EarningsSource} from '../../src/lib/earnings/model';

const id='XSHE:301308',other='XSHG:688981';
const graph:KnowledgeGraph={asOf:'',nodes:[{id,name:'Longsys',market:'CN_A',kind:'COMPANY',order:0},{id:other,name:'SMIC',market:'CN_A',kind:'COMPANY',order:1}],relationships:[],sources:[]};
const log={runId:'test',emit:()=>{}} as unknown as MaintenanceLog;
const task=(mode:'announcements'|'earnings-fallback'='announcements')=>({version:1 as const,type:'cn.company.discovery.requested' as const,batchId:'cn_'+'a'.repeat(64),companyId:id,mode,requestedAt:'2026-10-02T11:00:00.000Z'});
const fixture=JSON.parse(readFileSync('tests/fixtures/earnings/cn/longsys-h1-2026.json','utf8')).source as EarningsSource;

test('tasks bind one A-share company and mode; payload cannot supply provider URLs',()=>{
  assert.deepEqual(parseCnDiscoveryTask({...task(),url:'https://evil.example'}),task());
  for(const patch of [{companyId:'US:AMD'},{companyId:'XSHE:999999'},{mode:'all'},{batchId:'forged'},{requestedAt:'invalid'},{version:2}])assert.throws(()=>parseCnDiscoveryTask({...task(),...patch}));
});

test('dispatch skips only fresh complete coverage, isolates failures, and has stable retry identities',async()=>{
  const now=Date.parse(task().requestedAt),sent:ReturnType<typeof task>[]=[],ids=[id,other,'XSHE:000063','XSHE:300308'];
  const readState=async(company:string)=>company===other?{status:'complete',nextPollAtMs:now+3600000,earningsCoverageVersion:2}:company==='XSHE:000063'?{status:'partial',nextPollAtMs:now+3600000}:{status:'complete',nextPollAtMs:now+3600000,earningsCoverageVersion:1};
  const opts={execution:'execution',deadline:now+60000,now:()=>now,earningsEnabled:true,readState};
  const first=await publishCnDiscoveryTasks([...ids,id],'announcements',async value=>{sent.push(value);if(value.companyId===id)throw Error('publisher unavailable');},opts);
  assert.deepEqual(first,{mode:'pubsub',requested:2,skipped:1,deferred:0,failed:1});
  const retry:typeof sent=[];await publishCnDiscoveryTasks(ids,'announcements',async value=>{retry.push(value);},opts);
  assert.deepEqual(sent,retry);
  const fallback=await publishCnDiscoveryTasks([id,other],'earnings-fallback',async()=>assert.fail('Fresh replacement owns discovery'),{...opts,readState:async(_id,mode)=>mode==='announcements'?{status:'complete',earningsCoverageVersion:2,lastSuccessAt:task().requestedAt}:undefined});
  assert.equal(fallback.skipped,2);
});

test('dispatch bounds publication concurrency and defers when its deadline is exhausted',async()=>{
  const ids=Array.from({length:25},(_,n)=>`XSHG:${600000+n}`),now=Date.parse(task().requestedAt);let active=0,peak=0;
  const opts={execution:'execution',deadline:now+60000,now:()=>now,earningsEnabled:false,readState:async()=>undefined};
  const result=await publishCnDiscoveryTasks(ids,'announcements',async()=>{peak=Math.max(peak,++active);await new Promise(resolve=>setTimeout(resolve,1));active--;},opts);
  assert.equal(result.requested,25);assert(peak<=8&&peak>1);
  const expired=await publishCnDiscoveryTasks(ids,'announcements',async()=>assert.fail(),{...opts,deadline:now+1000});assert.equal(expired.deferred,25);
});

test('worker rechecks canonical enrollment and completed deliveries before any provider work',async()=>{
  const fx=earningsFirestore(),none={...graph,nodes:[]};
  fx.rows.set(`companies/${id}`,{name:'Longsys',status:'PUBLISHED',themeMemberships:{ai:{status:'PUBLISHED',primarySector:'chips'}}});
  assert.deepEqual((await loadCnDiscoveryCompany(fx.db,id)).nodes.map(n=>n.id),[id]);
  fx.rows.get(`companies/${id}`)!.themeMemberships={ai:{status:'WITHDRAWN'}};
  assert.equal((await loadCnDiscoveryCompany(fx.db,id)).nodes.length,0);
  const options={enabled:true,earningsEnabled:true,now:fx.now,loadCompany:async()=>none,announcements:async()=>assert.fail(),fallback:async()=>assert.fail()};
  assert.equal((await processCnDiscoveryTask(task(),fx.db,log,options)).status,'ineligible');
  await assert.rejects(processCnDiscoveryTask(task(),fx.db,log,{...options,enabled:false}),/disabled/);
  await assert.rejects(processCnDiscoveryTask(task('earnings-fallback'),fx.db,log,{...options,earningsEnabled:false}),/disabled/);
  fx.rows.set(`collectors/exchange-${id}`,{status:'complete',lastSuccessAt:task().requestedAt,earningsCoverageVersion:2});
  assert.equal((await processCnDiscoveryTask(task(),fx.db,log,{...options,earningsEnabled:false,loadCompany:async()=>graph,announcements:undefined})).duplicate,true);
  assert(!fx.rows.get(`collectors/exchange-task-${id}`)?.leaseOwner);
});

test('worker fails delivery for busy, failed or deferred company work',async()=>{
  const fx=earningsFirestore(),options={enabled:true,earningsEnabled:true,now:fx.now,loadCompany:async()=>graph,fallback:async()=>({})};
  for(const result of [{status:'busy'},{failed:1},{deferred:1}])await assert.rejects(processCnDiscoveryTask(task(),fx.db,log,{...options,announcements:async()=>result}),/retry company/);
  assert.equal((await processCnDiscoveryTask(task(),fx.db,log,{...options,announcements:async()=>({failed:0,deferred:0})})).status,'verified');
});

test('announcement and fallback share the company lease; other companies proceed independently',async()=>{
  const fx=earningsFirestore(),lease=fx.db.collection('collectors').doc(`exchange-task-${id}`),seen:string[]=[];
  configureEarningsMap(graph,new Map());
  try{
    assert(await acquireMaintenanceLease(lease,'other-worker',fx.now()));
    const blocked=await collectCnMapDisclosures(fx.db,graph,async()=>assert.fail(),{companyId:id,runId:'announcement',now:fx.now,deadline:fx.now()+60000,earningsEnabled:false});
    assert.equal('status' in blocked&&blocked.status,'busy');
    await assert.rejects(collectLiveEarnings(fx.db,log,{companyId:id,now:fx.now,deadline:fx.now()+60000,publish:async()=>'',discoverCn:async()=>assert.fail()}),/busy/);
    const direct=await collectLiveEarnings(fx.db,log,{now:fx.now,deadline:fx.now()+60000,publish:async()=>'',discoverCn:async company=>{seen.push(company);return [];}});
    assert.deepEqual(seen,[other]);assert.equal(direct.deferred,1);
    await releaseMaintenanceLease(lease,'other-worker');
    const done=await collectLiveEarnings(fx.db,log,{companyId:id,now:fx.now,deadline:fx.now()+60000,publish:async()=>'',discoverCn:async company=>{seen.push(company);return [];}});
    assert.equal(done.companies,1);assert.deepEqual(seen,[other,id]);
    assert(!fx.rows.get(`collectors/exchange-task-${id}`)?.leaseOwner);
  }finally{restoreEarningsFixtures();}
});

test('fallback publishes only its company sources before checkpoint; failed handoff retries stable pending work',async()=>{
  const fx=earningsFirestore(),checkpoint=`earnings_collectors/cn_${id}`,sent:string[]=[];
  configureEarningsMap(graph,new Map());
  const run=(fail:boolean)=>collectLiveEarnings(fx.db,log,{companyId:id,now:fx.now,deadline:fx.now()+60000,discoverCn:async company=>{assert.equal(company,id);return [fixture];},publish:async event=>{assert.notEqual(fx.rows.get(checkpoint)?.status,'complete');sent.push(event.sourceId);if(fail)throw Error('publish unavailable');return 'accepted';}});
  try{
    const unrelated=await discoverEarningsSource(fx.db,{...fixture,companyId:other,issuerId:'cn:688981'},'document',fx.now());
    const failed=await run(true);assert.equal(failed.failed,1);assert.equal(fx.rows.get(checkpoint)?.status,'partial');assert(!fx.rows.get(checkpoint)?.lastCompleteAt);
    const pending=[...fx.rows.values()].find(row=>row.recordType==='source'&&(row.source as EarningsSource).companyId===id)!;assert.equal(pending.publishPending,true);
    const done=await run(false);assert.equal(done.failed,0);assert.equal(done.published,1);assert.equal(fx.rows.get(checkpoint)?.status,'complete');assert.equal(sent[0],sent[1]);
    assert.equal([...fx.rows.values()].filter(row=>row.recordType==='source').length,2);
    assert.equal(fx.rows.get(`earnings_sources/${unrelated.sourceId}`)?.publishPending,true,'Company task does not drain unrelated pending work');
    await run(false);assert.equal(sent.length,2,'Duplicate completed delivery does not publish again');
    assert(!fx.rows.has(`earnings_collectors/cn_${other}`));
  }finally{restoreEarningsFixtures();}
});

test('announcement task scope cannot scan another company and retains checkpoint on incomplete pagination',async()=>{
  const fx=earningsFirestore(),calls:string[]=[];
  const request=async(url:string,options:{companyId:string})=>{calls.push(options.companyId);return url.includes('topSearch')?[{code:'301308',category:'A股',orgId:'org'}]:{hasMore:false,totalAnnouncement:1,announcements:[]};};
  const result=await collectCnMapDisclosures(fx.db,graph,request,{companyId:id,runId:'announcement',now:fx.now,deadline:fx.now()+60000,earningsEnabled:false});
  assert.equal('failed' in result&&result.failed,1);assert.deepEqual(calls,[id,id]);assert(!fx.rows.get(`collectors/exchange-${id}`)?.lastCompleteAt);
  assert(!fx.rows.has(`collectors/exchange-${other}`));assert(!fx.rows.get(`collectors/exchange-task-${id}`)?.leaseOwner);
});

test('announcement earnings handoff failure leaves pending source and retries before committing coverage',async()=>{
  const fx=earningsFirestore(),checkpoint=`collectors/exchange-${id}`,sent:string[]=[];
  const request=async(url:string)=>url.includes('topSearch')?[{code:'301308',category:'A股',orgId:'org'}]:{hasMore:false,totalAnnouncement:1,announcements:[{secCode:'301308',orgId:'org',announcementId:'12345',announcementTitle:'2026年半年度报告',adjunctUrl:'finalpage/2026-08-20/12345.PDF'}]};
  const run=(fail:boolean)=>collectCnMapDisclosures(fx.db,graph,request,{companyId:id,runId:'announcement',now:fx.now,deadline:fx.now()+60000,earningsEnabled:true,publish:async event=>{assert.notEqual(fx.rows.get(checkpoint)?.status,'complete');sent.push(event.sourceId);if(fail)throw Error('publish unavailable');return 'accepted';}});
  try{
    const failed=await run(true);assert.equal('failed' in failed&&failed.failed,1);assert(!fx.rows.get(checkpoint)?.lastCompleteAt);
    const done=await run(false);assert.equal('completed' in done&&done.completed,1);assert.equal(fx.rows.get(checkpoint)?.earningsCoverageVersion,2);assert.equal(sent[0],sent[1]);
    assert.equal([...fx.rows.values()].filter(row=>row.recordType==='source').length,1);
    assert(!fx.rows.has(`collectors/exchange-${other}`));
  }finally{restoreEarningsFixtures();}
});

test('completed delivery checks use one progress read under the company lease',async()=>{
  const fx=earningsFirestore(),collection=fx.db.collection.bind(fx.db);let reads=0;
  fx.db.collection=((name:string)=>{
    const result=collection(name),doc=result.doc.bind(result);
    result.doc=((key:string)=>{
      const ref=doc(key),get=ref.get.bind(ref);
      if(key===`exchange-${id}`||key===`cn_${id}`)ref.get=(async()=>{
        reads++;assert.equal(fx.rows.get(`collectors/exchange-task-${id}`)?.leaseOwner,log.runId);
        return get();
      }) as typeof ref.get;
      return ref;
    }) as typeof result.doc;
    return result;
  }) as typeof fx.db.collection;
  const at=task().requestedAt;
  fx.rows.set(`collectors/exchange-${id}`,{status:'complete',lastSuccessAt:at,earningsCoverageVersion:2,nextPollAtMs:0});
  const first=await processCnDiscoveryTask(task(),fx.db,log,{enabled:true,earningsEnabled:false,now:fx.now,loadCompany:async()=>graph});
  assert.equal(first.duplicate,true);assert.equal(reads,1);
  configureEarningsMap(graph,new Map());
  try{
    fx.rows.set(`earnings_collectors/cn_${id}`,{status:'complete',lastCompleteAt:at,nextPollAtMs:0});
    const second=await collectLiveEarnings(fx.db,log,{companyId:id,completedSince:at,deadline:fx.now()+60000,now:fx.now,publish:async()=>assert.fail(),discoverCn:async()=>assert.fail()});
    assert.equal('duplicate' in second&&second.duplicate,true);assert.equal(reads,2);
    assert(!fx.rows.get(`collectors/exchange-task-${id}`)?.leaseOwner);
  }finally{restoreEarningsFixtures();}
});
