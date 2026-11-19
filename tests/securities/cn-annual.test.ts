import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from 'firebase-admin/firestore';
import { akshareSymbol,parseCnAnnual } from '../../src/lib/fundamentals/cn-annual';
import { refreshCnAnnual } from '../../src/lib/fundamentals/cn-annual-worker';
import { readCnFundamentals } from '../../src/lib/fundamentals/cn-service';
import type { MaintenanceLog } from '../../src/lib/maintenance-log';

const id='XSHE:301308',now=new Date('2026-09-27T12:00:00Z');
// Trimmed real AKShare 1.18.97 response captured 2026-09-27; amounts in CNY yuan.
const row={SECUCODE:'301308.SZ',SECURITY_CODE:'301308',REPORT_DATE:'2025-12-31 00:00:00',REPORT_TYPE:'年报',NOTICE_DATE:'2026-04-28 00:00:00',UPDATE_DATE:'2026-04-28 00:00:00',CURRENCY:'CNY',OPERATE_INCOME:22766169990.55,PARENT_NETPROFIT:1423298162.88};
const parse=(rows:unknown[])=>parseCnAnnual(id,{symbol:'SZ301308',rows},now);
const log={emit:()=>{},stage:()=>{},runId:'00000000-0000-0000-0000-000000000000'} as MaintenanceLog;
test('real A-share annual payload retains exact CNY amounts, annual period and attributable profit',()=>{
  const annual=parse([row]);
  assert.equal(annual.metrics[0].value,22766169990.55);
  assert.equal(annual.metrics[1].value,1423298162.88);
  assert.equal(annual.metrics[1].label,'Net income attributable to parent');
  assert.equal(annual.metrics[0].start,'2025-01-01');
  assert.equal(annual.filed,'2026-04-28');
  assert.equal(akshareSymbol('XSHG:688981'),'SH688981');
  assert.throws(()=>akshareSymbol('US:NVDA'));
});
test('selects latest corrected year, never a half year or forecast, and preserves losses and zero',()=>{
  const annual=parse([row,{...row,UPDATE_DATE:'2026-05-01',PARENT_NETPROFIT:-123},
    {...row,REPORT_DATE:'2026-06-30',NOTICE_DATE:'2026-08-01',UPDATE_DATE:'2026-08-01',REPORT_TYPE:'中报'},
    {...row,REPORT_DATE:'2026-12-31',REPORT_TYPE:'业绩预告'}]);
  assert.equal(annual.metrics[1].value,-123);
  assert.equal(parse([{...row,PARENT_NETPROFIT:0}]).metrics[1].value,0);
  for(const changes of [{OPERATE_INCOME:null},{PARENT_NETPROFIT:null},{CURRENCY:'USD'},{SECUCODE:'301308.SH'},{SECURITY_CODE:'000063'},{REPORT_TYPE:'中报'},{NOTICE_DATE:'2027-01-01'}])assert.throws(()=>parse([{...row,...changes}]));
  assert.throws(()=>parse([row,{...row,PARENT_NETPROFIT:123}]),/Ambiguous/);
  assert.throws(()=>parse([{...row,NOTICE_DATE:'2026-02-30'}]));
  assert.throws(()=>parse([{...row,REPORT_DATE:'2024-12-31'},{...row,CURRENCY:'USD'}]),/currency/);
});
function database(seed:Record<string,unknown>={}){
  const docs=new Map<string,Record<string,unknown>>([[id,seed]]),writes:unknown[]=[];
  const db={} as Firestore;
  let generation=0,status:import('../../src/lib/fundamentals/cn-annual-status').AnnualStatus|undefined;
  const dependencies:Partial<Parameters<typeof refreshCnAnnual>[0]>={
    statusStore:{
      read:async()=>({generation:String(generation),status}),
      write:async(_id,expected,next)=>{assert.equal(expected,String(generation));generation++;status=next;writes.push(next);},
    },
    read:async(_db,key)=>docs.get(key),
    publish:async(_db,annual)=>{docs.set(annual.companyId,{...docs.get(annual.companyId),cnAnnual:annual});writes.push(annual);},
  };
  return {db,docs,writes,dependencies};
}
test('annual worker merges into the existing cache and public reads do not enqueue SEC work',async()=>{
  const state=database({marketCap:{close:123},cnShares:{totalShares:100}}),annual=parse([row]);
  const result=await refreshCnAnnual({...state.dependencies,db:state.db,companies:[id],deadline:now.getTime()+120000,log,now:()=>now.getTime(),fetch:async()=>annual});
  assert.equal(result.updated,1);assert.deepEqual(state.docs.get(id)?.cnShares,{totalShares:100});
  const writes=state.writes.length;
  const snapshot=await readCnFundamentals(id,state.db,now.getTime()+4*86400000,async()=>state.docs.get(id));
  assert.equal(snapshot?.annual?.end,'2025-12-31');assert.equal(snapshot?.stale,true);
  assert.equal(state.writes.length,writes);
  const again=await refreshCnAnnual({...state.dependencies,db:state.db,companies:[id],deadline:now.getTime()+120000,log,now:()=>now.getTime(),fetch:async()=>{throw new Error('should skip');}});
  assert.equal(again.skipped,1);
});
test('provider failures preserve last report, retry later, and dry runs never write',async()=>{
  const annual=parse([row]),state=database({cnAnnual:annual});
  const result=await refreshCnAnnual({...state.dependencies,db:state.db,companies:[id],deadline:now.getTime()+120000,log,now:()=>now.getTime(),fetch:async()=>{throw new Error('provider offline');}});
  assert.equal(result.failed,1);assert.deepEqual(state.docs.get(id)?.cnAnnual,annual);
  const retry=await refreshCnAnnual({...state.dependencies,db:state.db,companies:[id],deadline:now.getTime()+120000,log,now:()=>now.getTime(),fetch:async()=>{throw new Error('cooldown must prevent fetch');}});
  assert.equal(retry.failed,1);assert.equal(retry.skipped,0);
  assert.deepEqual(state.docs.get(id)?.cnAnnual,annual);
  const dry=database();
  await refreshCnAnnual({...dry.dependencies,db:dry.db,companies:[id],deadline:now.getTime()+120000,log,dryRun:true,now:()=>now.getTime(),fetch:async()=>annual,print:()=>{}});
  assert.equal(dry.writes.length,0);
  const deferred=await refreshCnAnnual({...dry.dependencies,db:dry.db,companies:[id],deadline:now.getTime()+1000,log,now:()=>now.getTime(),fetch:async()=>{throw new Error('must not start');}});
  assert.equal(deferred.deferred,1);assert.equal(dry.writes.length,0);
});

test('the public annual reader handles published and deleted Parquet rows', async () => {
  const annual = parse([row]);
  const db = {} as Firestore;
  const result = await readCnFundamentals(id,db,now.getTime(),async (_db,key,fields)=>{
    assert.equal(key,id);
    assert.deepEqual(fields,['cnAnnual','marketCap']);
    return {cnAnnual:annual};
  });
  assert.deepEqual(result?.metrics,annual.metrics);
  assert.equal(await readCnFundamentals(id,db,now.getTime(),async()=>({cnAnnual:annual,isDeleted:true})),null);
  assert.equal(await readCnFundamentals(id,db,now.getTime(),async()=>undefined),null);
});

test('annual checkpoints bind reads and competing updates to the observed object generation',async()=>{
  const {annualStatusStore}=await import('../../src/lib/fundamentals/cn-annual-status');
  let generation=0,bytes='';
  const error=(code:number)=>Object.assign(new Error(String(code)),{code});
  const bucket={file:(name:string,options?:{generation:string})=>{
    assert.equal(name,'worker-state/v1/cn-annual/'+id+'.json');
    return {
      getMetadata:async()=>{if(!generation)throw error(404);return [{generation:String(generation)}];},
      download:async()=>{assert.equal(options?.generation,String(generation));return [Buffer.from(bytes)];},
      save:async(value:string,options:{preconditionOpts:{ifGenerationMatch:string}})=>{
        if(options.preconditionOpts.ifGenerationMatch!==String(generation))throw error(412);
        generation++;bytes=value;
      },
    };
  }} as unknown as import('@google-cloud/storage').Bucket;
  const store=annualStatusStore(bucket),original=await store.read(id);
  assert.equal(original.generation,'0');
  const ready={outcome:'ready' as const,checkedAtMs:100,retryAfter:200,lastError:null};
  await store.write(id,original.generation,ready);
  await assert.rejects(store.write(id,original.generation,{...ready,outcome:'retry'}),/412/);
  assert.deepEqual(await store.read(id),{generation:'1',status:ready});
});
