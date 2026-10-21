import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Timestamp, type Firestore} from 'firebase-admin/firestore';
import {instrumentFromCompany, instrumentId, instrumentType, validateInstrument} from '../../src/lib/instruments/model';
import {planInstrumentMigration} from '../../src/lib/instruments/migration';
import {resolveIssuer, resolveInstrumentContext, syncCompanyInstrument} from '../../src/lib/instruments/service';
const at='2026-10-21T00:00:00Z';
const row=(id:string,data:Record<string,unknown>)=>({id,data:{name:id,symbol:id.split(':')[1],...data},updateTime:new Timestamp(1,0)});

test('explicit types map; unknown and funds are not OTHER_EQUITY',()=>{
  assert.equal(instrumentType('Common Stock'),'COMMON_SHARE');
  assert.equal(instrumentType('Preferred Stock'),'PREFERRED_SHARE');
  assert.equal(instrumentType('American Depositary Receipt'),'DEPOSITARY_RECEIPT');
  assert.equal(instrumentType('OTHER_EQUITY'),'OTHER_EQUITY');
  assert.equal(instrumentType('ETF'),undefined);assert.equal(instrumentType('garbage'),undefined);
});
test('migration separates two share classes from one issuer and preserves stable legacy links',()=>{
  const rows=[row('US:GOOG',{cik:'0001652044',type:'Common Stock'}),row('US:GOOGL',{cik:'0001652044',themeIds:['ai'],type:'Common Stock'})];
  const plan=planInstrumentMigration(rows,'test',at);
  assert.equal(plan.instruments.length,2);assert.equal(new Set(plan.instruments.map(i=>i.companyId)).size,1);
  assert.equal(plan.instruments[0].companyId,'US:GOOGL');
  assert.notEqual(plan.instruments[0].id,plan.instruments[1].id);
  assert.deepEqual(plan.aliases.map(a=>[a.id,a.companyId]),[['US:GOOG','US:GOOGL']]);
  assert.deepEqual(planInstrumentMigration([...rows].reverse(),'test',at).instruments.map(r=>r.id).sort(),plan.instruments.map(r=>r.id).sort());
  assert.equal(plan.instruments[0].data.providerSymbols.youanalyst,'US:GOOG');
});
test('no name-based merges, no private instruments, no deleted resurrection, no inferred classes',()=>{
  const plan=planInstrumentMigration([row('US:A',{name:'Same'}),row('US:B',{name:'Same'}),row('US:C',{isDeleted:true}),row('ORG:PRIVATE',{listingStatus:'PRIVATE'})],'test',at);
  assert.equal(plan.aliases.length,0);assert.equal(plan.instruments.length,2);
  assert.equal(plan.instruments[0].data.instrumentType,undefined);
  assert.equal(plan.instruments[0].data.shareClass,undefined);
  assert.equal(instrumentId('US:A'),instrumentId('US:A'));
});
test('conflicting classification and two editorial companies require review before merge',()=>{
  const rows=[row('US:A',{cik:'0000000001',taxonomy:'SIC'}),row('US:B',{cik:'0000000001',taxonomy:'CNI'})];
  assert.equal(planInstrumentMigration(rows,'test',at).aliases.length,0);
  assert.equal(planInstrumentMigration(rows,'test',at).review[0].reason,'issuer_merge_requires_review');
  rows.forEach(r=>Object.assign(r.data,{taxonomy:'SIC',themeIds:['ai']}));
  assert.equal(planInstrumentMigration(rows,'test',at).aliases.length,0);
});
test('venue-specific identifiers and currencies stay on the instrument; invalid ratios fail',()=>{
  const instrument=instrumentFromCompany('US:BABA',{name:'Alibaba',symbol:'BABA',type:'American Depositary Receipt',micCode:'XNYS',currency:'USD',provider:'twelve-data'})!;
  assert.equal(instrument.instrumentType,'DEPOSITARY_RECEIPT');assert.equal(instrument.exchangeMic,'XNYS');
  assert.equal(instrument.underlyingSharesPerReceipt,undefined);
  assert.throws(()=>validateInstrument({...instrument,underlyingSharesPerReceipt:'0'}),/ratio/);
});

function fixture(initial:Record<string,Record<string,unknown>>){
  const rows=new Map(Object.entries(initial));let writes=0;
  const ref=(path:string)=>({path,id:path.split('/').at(-1),get:async()=>doc(path)});
  const doc=(path:string)=>({id:path.split('/').at(-1),exists:rows.has(path),ref:ref(path),data:()=>rows.get(path),get:(k:string)=>rows.get(path)?.[k]});
  const db={collection:(c:string)=>({doc:(id:string)=>ref(`${c}/${id}`)}),runTransaction:async(fn:(t:unknown)=>Promise<unknown>)=>fn({getAll:async(...refs:{path:string}[])=>refs.map(r=>doc(r.path)),set:(r:{path:string},data:Record<string,unknown>)=>{writes++;rows.set(r.path,{...rows.get(r.path),...data});}})};
  return {db:db as unknown as Firestore,rows,writes:()=>writes};
}
test('legacy instrument lookup resolves issuer aliases but retains the price-history key',async()=>{
  const i=instrumentFromCompany('US:OLD',{name:'Shares',symbol:'OLD'},'US:OLD')!;
  const f=fixture({[`instruments/${instrumentId('US:OLD')}`]:i,'companies/US:OLD':{supersededByCompanyId:'US:NEW'},'companies/US:NEW':{name:'Issuer'}});
  const result=await resolveInstrumentContext(f.db,'US:OLD');
  assert.equal(result?.company.id,'US:NEW');assert.equal(result?.historyKey,'US:OLD');
  f.rows.set('companies/US:NEW',{supersededByCompanyId:'US:OLD'});
  await assert.rejects(resolveIssuer(f.db,'US:OLD'),/cycle/);
});
test('import synchronization is idempotent, preserves tombstones and rejects issuer replacement',async()=>{
  const company={name:'A',symbol:'A',type:'Common Stock'};
  const f=fixture({'companies/US:A':company});
  assert.deepEqual(await syncCompanyInstrument(f.db,'US:A',company),{changed:true});
  assert.deepEqual(await syncCompanyInstrument(f.db,'US:A',company),{changed:false});assert.equal(f.writes(),1);
  const path=`instruments/${instrumentId('US:A')}`;
  f.rows.set(path,{...f.rows.get(path),isDeleted:true});
  assert.deepEqual(await syncCompanyInstrument(f.db,'US:A',company),{changed:false});assert.equal(f.writes(),1);
  f.rows.set(path,{...f.rows.get(path),isDeleted:false,companyId:'US:DIFFERENT'});
  await assert.rejects(syncCompanyInstrument(f.db,'US:A',company),/issuer changed/);
});

test('daily file comparison does not read Firestore for unchanged instrument maps',async()=>{
  const {syncSnapshotInstruments}=await import('../../src/lib/instruments/snapshot-sync');
  const company={name:'A',symbol:'A',type:'Common Stock',provider:'twelve-data'};
  const next=instrumentFromCompany('US:A',company)!;
  const existing={...next,providerSymbols:Object.fromEntries(Object.entries(next.providerSymbols).reverse()),sourceMetadata:{...next.sourceMetadata,observedAt:'2026-01-01T00:00:00Z'}};
  const result=await syncSnapshotInstruments({} as Firestore,{version:1,collection:'companies',watermark:new Timestamp(1,0),rows:[{id:'US:A',data:company}]},
    {version:1,collection:'instruments',watermark:new Timestamp(1,0),rows:[{id:instrumentId('US:A'),data:existing}]});
  assert.deepEqual(result,{updated:0,unchanged:1});
});
test('issuer financial statements never leak another share class valuation',async()=>{
  const {financialsForInstrument}=await import('../../src/lib/instruments/fundamentals');
  const financials={metrics:[],report:{cik:'1'},marketCap:{value:100},shareAssessment:{basis:{shares:10}}} as never;
  assert.deepEqual(financialsForInstrument(financials),{metrics:[],report:{cik:'1'}});
  assert.equal(financialsForInstrument(financials,{marketCap:{value:50}}).marketCap.value,50);
  assert.equal(financialsForInstrument(financials,{isDeleted:true,marketCap:{value:50}}).marketCap,undefined);
});

test('daily sync delists a company that becomes private and rechecks current source state',async()=>{
 const {syncSnapshotInstruments}=await import('../../src/lib/instruments/snapshot-sync');
 const listed={name:'A',symbol:'A',active:true};const value=instrumentFromCompany('US:A',listed)!;
 const company={...listed,listingStatus:'PRIVATE'};const path=`instruments/${instrumentId('US:A')}`;
 const f=fixture({'companies/US:A':company,[path]:value});
 const companies={version:1 as const,collection:'companies' as const,watermark:new Timestamp(1,0),rows:[{id:'US:A',data:company}]};
 const instruments={version:1 as const,collection:'instruments' as const,watermark:new Timestamp(1,0),rows:[{id:instrumentId('US:A'),data:value}]};
 assert.equal((await syncSnapshotInstruments(f.db,companies,instruments)).updated,1);
 assert.equal(f.rows.get(path)!.status,'DELISTED');
 assert.equal((await syncCompanyInstrument(f.db,'US:A',company)).changed,false);
 f.rows.set('companies/US:A',listed);f.rows.set(path,value);
 assert.equal((await syncCompanyInstrument(f.db,'US:A',company)).changed,false,'stale snapshot must not delist a public company');
});

test('global issuers with a verified listing migrate; private and ambiguous listings do not',()=>{
  const company={name:'Samsung',listingStatus:'PUBLIC',listings:[{exchange:'XKRX',symbol:'005930'}]};
  const value=instrumentFromCompany('ORG:SAMSUNG',company)!;
  assert.equal(value.symbol,'005930');assert.equal(value.exchangeMic,'XKRX');assert.equal(value.instrumentType,undefined);
  assert.equal(instrumentFromCompany('ORG:SAMSUNG',{...company,listingStatus:'PRIVATE'}),null);
  assert.equal(instrumentFromCompany('ORG:SAMSUNG',{...company,listings:[...company.listings,{exchange:'XKRX',symbol:'005935'}]}),null);
});
