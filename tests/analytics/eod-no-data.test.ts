import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pubsubFirestore} from '../helpers/pubsub-firestore';
import {queueEodMaintenance} from '../../src/lib/predictions/eod-pubsub';
import {processEodCompanyMessage,type EodMessage} from '../../src/lib/predictions/eod-company-queue';
import type {DailyEodMaintenanceResult} from '../../src/lib/predictions/eod-prices';
import {fetchEodhdDailyPrices} from '../../src/lib/predictions/eod-prices';
import {pacedEodPublisher} from '../../src/lib/predictions/eod-publisher';

async function fixture(){
  const f=pubsubFirestore(),messages:EodMessage[]=[];
  const publish=async(m:EodMessage)=>{messages.push(m);};
  await queueEodMaintenance({market:'US',runDate:'2026-10-30'},f.db,publish);
  await processEodCompanyMessage(messages.shift()!,f.db,f.log,publish);
  const parent=messages.shift()!;
  await processEodCompanyMessage(parent,f.db,f.log,publish,{plan:async()=>['US:DREM'],prepare:async()=>({})});
  const child=messages.find(m=>m.type==='company.work.requested')!;
  const result={candidatePredictions:0,hasMoreCandidatePredictions:false,priceLoad:{failed:1,failures:[{ticker:'DREM',reason:'eodhd_no_dated_bar'}]},marking:{checked:0,missingPrice:0}} as DailyEodMaintenanceResult;
  return {...f,publish,parent,child,result};
}
test('confirmed no dated bar without predictions settles explicitly NO_DATA and reports parent gaps',async()=>{
  const f=await fixture();let finalized=0;
  await processEodCompanyMessage(f.child,f.db,f.log,f.publish,{run:async()=>f.result});
  assert.equal(f.rows.get(`eod_runs/_company_${f.child.batchId}`)?.status,'NO_DATA');
  assert.equal(f.rows.get(`eod_runs/_company_${f.child.batchId}`)?.completed,true);
  await processEodCompanyMessage(f.parent,f.db,f.log,f.publish,{finalize:async()=>{finalized++;return null;}});
  assert.equal(finalized,1);
  assert.equal(f.rows.get('eod_runs/US_2026-10-30')?.status,'COMPLETED_WITH_ERRORS');
  assert.match(String(f.rows.get('eod_runs/US_2026-10-30')?.error),/1 companies/);
  assert.equal([...f.rows.keys()].some(key=>key.startsWith('eod_prices/')),false,'never fabricate a dated bar');
});
test('provider errors, predictions, unfinished scans and corporate action failures cannot be skipped',async()=>{
  for(const kind of ['http','predictions','valuation','pages','actions']){
    const f=await fixture();
    if(kind==='http')f.result.priceLoad.failures[0].reason='eodhd_http_429';
    if(kind==='predictions')f.result.candidatePredictions=1;
    if(kind==='valuation')f.result.marking.missingPrice=1;
    if(kind==='pages')f.result.hasMoreCandidatePredictions=true;
    if(kind==='actions')f.result.corporateActions={failures:[{}]} as DailyEodMaintenanceResult['corporateActions'];
    await assert.rejects(processEodCompanyMessage(f.child,f.db,f.log,f.publish,{run:async()=>f.result}),/incomplete/);
    assert.equal(f.rows.get(`eod_runs/_company_${f.child.batchId}`)?.completed,false);
  }
});
test('daily provider distinguishes empty arrays from malformed responses and wrong dates',async t=>{
  const old=process.env.EODHD_API_TOKEN;process.env.EODHD_API_TOKEN='synthetic';
  t.after(()=>{if(old===undefined)delete process.env.EODHD_API_TOKEN;else process.env.EODHD_API_TOKEN=old;});
  let payload:unknown=[];
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(payload),{status:200}));
  const load=()=>fetchEodhdDailyPrices(['DREM'],'2026-10-30','2026-10-31T00:00:00Z','US');
  assert.equal((await load()).failures[0].reason,'eodhd_no_dated_bar');
  payload={error:'quota'};assert.equal((await load()).failures[0].reason,'eodhd_invalid_response');
  payload=[{date:'2026-10-29',close:1}];assert.notEqual((await load()).failures[0].reason,'eodhd_no_dated_bar');
});
test('only company publications are paced and failed publication is not treated as successful',async()=>{
  const f=await fixture(),pauses:number[]=[],sent:EodMessage[]=[];
  const publish=pacedEodPublisher(async m=>{sent.push(m);},async ms=>{pauses.push(ms);});
  await publish(f.child);await publish(f.parent);
  assert.deepEqual(pauses,[1000]);assert.equal(sent.length,2);
  await assert.rejects(pacedEodPublisher(async()=>{throw Error('publish failed');},async()=>{throw Error('must not pause');})(f.child),/publish failed/);
});
