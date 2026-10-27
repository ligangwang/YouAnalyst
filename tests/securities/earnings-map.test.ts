import {withThemeCatalog} from '../helpers/theme-catalog';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {KnowledgeGraph} from '../../src/lib/knowledge-graph/model';
import {configureEarningsMap,earningsCompany,earningsCompanies,restoreEarningsFixtures,registerEarningsIssuer} from '../../src/lib/earnings/issuers';
import {discoverSecEarnings,discoverCnEarnings} from '../../src/lib/earnings/discovery';
import {captureEarningsDocument,validateSource} from '../../src/lib/earnings/document';
import {makeUsEarningsPlan} from '../../src/lib/earnings/live-us';
import {makeCnEarningsPlan,parseCnEarningsOrg} from '../../src/lib/earnings/live-cn';
import {extractEarnings} from '../../src/lib/earnings/extract';
import {createSecEarningsObserver,secEarningsCursorId} from '../../src/lib/earnings/sec-observer';
import {loadEarningsMap} from '../../src/lib/earnings/map-issuers';
import {earningsFirestore} from '../helpers/earnings-firestore';
import {publicEarningsSummary,latestPublicEarnings} from '../../src/lib/earnings/public-summary';
import type {MaintenanceLog} from '../../src/lib/maintenance-log';
import type {Firestore} from 'firebase-admin/firestore';
import {loadCollectionCompanyScope} from '../../src/lib/company-themes/service';
import {usMapTickers} from '../../src/lib/knowledge-graph/us-companies';
import {createMapSecObserver} from '../../src/lib/events/sec-disclosures';
import type {DocumentData} from 'firebase-admin/firestore';

const graph:KnowledgeGraph={asOf:'2026-10-04',nodes:[
  {id:'US:MU',market:'US',name:'Micron Technology, Inc.',aliases:['Micron'],kind:'COMPANY',order:1},
  {id:'US:AMAT',market:'US',name:'Applied Materials',kind:'COMPANY',order:2},
  {id:'XSHE:000063',market:'CN_A',name:'ZTE',names:{'zh-CN':'中兴通讯'},kind:'COMPANY',order:3},
  {id:'ORG:OPENAI',market:'GLOBAL',name:'OpenAI',kind:'COMPANY',order:4}],relationships:[],sources:[]};
const ids=new Map([['US:MU','0000723125'],['US:AMAT','0000006951']]);
const now='2026-10-04T12:00:00Z';
const payload={cik:723125,filings:{files:[],recent:{form:['8-K'],accessionNumber:['0000723125-26-000018'],filingDate:['2026-09-30'],primaryDocument:['mu-20260930.htm'],acceptanceDateTime:['2026-09-30T20:02:22Z']}}};
test.afterEach(()=>restoreEarningsFixtures());

test('SEC identity snapshots avoid disclosure rereads, but failed scans reload durable progress',async()=>{
  const fx=earningsFirestore(),reads=new Map<string,number>();
  fx.rows.set('collectors/sec-US:MU',{companyId:'US:MU',cik:'0000723125'});
  const db=withThemeCatalog({runTransaction:fx.db.runTransaction.bind(fx.db),collection:(name:string)=>{
    const collection=fx.db.collection(name);
    return {doc:(id:string)=>{
      const ref=collection.doc(id);
      return {...ref,get:async()=>{reads.set(id,(reads.get(id)??0)+1);return ref.get();},set:ref.set.bind(ref)};
    }};
  }} as unknown as Firestore);
  const initialStates=new Map<string,DocumentData|undefined>();
  await loadEarningsMap(db,graph,initialStates);
  assert(initialStates.has('US:AMAT'),'Missing identity documents must also be reusable');
  assert.equal(initialStates.get('US:AMAT'),undefined);
  const observer=createMapSecObserver(db,new Map([['0000723125',['US:MU']],['0000006951',['US:AMAT']]]),
    {deadline:fx.now()+60000,now:fx.now,initialStates});
  const empty=(cik:number)=>({cik,filings:{files:[],recent:{form:[],accessionNumber:[],filingDate:[],primaryDocument:[]}}});
  const archive=async()=>{throw new Error('Unexpected archive');};
  await observer.observe('0000723125',empty(723125),archive);
  await observer.observe('0000723125',empty(723125),archive);
  assert.equal(reads.get('sec-US:MU'),1);
  assert.equal(observer.failed.size,0);
  await observer.observe('0000006951',{cik:6951},archive);
  assert(observer.failed.has('US:AMAT'));
  assert.equal(reads.get('sec-US:AMAT'),1);
  await observer.observe('0000006951',empty(6951),archive);
  assert.equal(reads.get('sec-US:AMAT'),2,'Retry must read the checkpoint saved after failure');
  assert.equal(observer.failed.size,0);
  // Starting another run must refresh states instead of reusing the old missing value.
  await loadEarningsMap(db,graph,initialStates);
  assert.equal(initialStates.get('US:AMAT')?.status,'complete');
  assert.equal(reads.get('sec-US:AMAT'),3);
});

test('SEC and earnings discovery reuse one supported scope without reading relationships or valuations',async()=>{
  const fx=earningsFirestore();
  fx.rows.set('collectors/sec-identity-US:MU',{companyId:'US:MU',cik:'0000723125'});
  const published={status:'PUBLISHED',primarySector:'compute',reviewedAt:'2026-10-17'};
  const rows=[
    {id:'US:MU',name:'Micron Technology',names:{en:'Micron Technology'},aliases:['Micron'],status:'DIRECTORY',onboarding:{status:'SUPPORTED'},themeMemberships:{ai:published,robotics:published}},
    {id:'US:AMAT',name:'Applied Materials',status:'DIRECTORY',onboarding:{status:'SUPPORTED'},themeMemberships:{space:published}},
    {id:'XSHE:000063',name:'ZTE',status:'DIRECTORY',onboarding:{status:'SUPPORTED'},themeMemberships:{robotics:published}},
    {id:'ORG:OPENAI',name:'OpenAI',status:'DIRECTORY',onboarding:{status:'SUPPORTED'},themeMemberships:{ai:published}},
    {id:'US:WITHDRAWN',name:'Withdrawn',status:'DIRECTORY',inGraph:{status:'PUBLISHED'},themeMemberships:{ai:{...published,status:'WITHDRAWN'}}},
  ];
  let companyQueries=0;
  const db=withThemeCatalog({runTransaction:fx.db.runTransaction.bind(fx.db),collection:(name:string)=>{
    if(name==='companies')return {where:(field:string,op:string,values:string[])=>{
      assert.equal(field,'onboarding.status');assert.equal(op,'==');assert.equal(values,'SUPPORTED');
      return {get:async()=>{companyQueries++;return {docs:rows.map(row=>({id:row.id,data:()=>row}))};}};
    }};
    assert.equal(name,'collectors','Company scope must not load relationships or fundamentals');
    return fx.db.collection(name);
  }} as unknown as Firestore);
  const scope=await loadCollectionCompanyScope(db);
  assert.deepEqual(usMapTickers(scope),['AMAT','MU']);
  assert.deepEqual(scope.relationships,[]);
  await loadEarningsMap(db,scope);
  assert.equal(companyQueries,1);
  assert.deepEqual(earningsCompanies().map(row=>row.companyId),['US:MU','XSHE:000063']);
  assert(earningsCompany('US:MU').aliases.includes('Micron'));
  registerEarningsIssuer('US:AMAT','0000006951');
  assert.equal(earningsCompany('US:AMAT').name,'Applied Materials');
  assert.throws(()=>registerEarningsIssuer('US:NEIGHBOR','0000001234'),/Unverified map/);
  // The standalone scheduled job must use the same narrow scope without a supplied graph.
  const standalone = await loadEarningsMap(db);
  assert.equal(companyQueries,2);
  assert.deepEqual(standalone.relationships,[]);
  assert.deepEqual(usMapTickers(standalone),['AMAT','MU']);
  assert.deepEqual(earningsCompanies().map(row=>row.companyId),['US:MU','XSHE:000063']);
});

test('earnings eligibility follows the map and verified scanner identities, never the adapter hints',async()=>{
  const fx=earningsFirestore();fx.rows.set('collectors/sec-identity-US:MU',{companyId:'US:MU',cik:'0000723125'});
  fx.rows.set('collectors/sec-identity-US:AMAT',{companyId:'US:OTHER',cik:'0000006951'});
  await loadEarningsMap(fx.db,graph);
  assert.deepEqual(earningsCompanies().map(c=>c.companyId),['US:MU','XSHE:000063']);
  assert.throws(()=>earningsCompany('US:AMD'));assert.throws(()=>earningsCompany('ORG:OPENAI'));
  assert.throws(()=>registerEarningsIssuer('US:NOT_IN_MAP','0000001234'));
  registerEarningsIssuer('US:AMAT','0000006951');assert.equal(earningsCompany('US:AMAT').issuerId,'sec:0000006951');
});
test('Micron discovery uses the shared SEC response and preserves original acceptance time',async()=>{
  configureEarningsMap(graph,ids);
  const fx=earningsFirestore(),observer=createSecEarningsObserver(fx.db,{runId:'map',emit:()=>{}} as unknown as MaintenanceLog,{deadline:fx.now()+60000,now:fx.now});
  await observer.observe('0000723125',payload,async()=>{throw new Error('Unexpected archive');});
  assert.equal(observer.observed.size,1);
  const [source]=discoverSecEarnings('US:MU',payload,now);validateSource(source);
  assert.equal(source.filingAcceptedAt,'2026-09-30T20:02:22Z');assert.equal(source.publishedAt,null);
  assert.throws(()=>discoverSecEarnings('US:AMAT',payload,now));
  assert.throws(()=>validateSource({...source,issuerId:'sec:0000006951'}));
  assert.throws(()=>validateSource({...source,url:source.url.replace('/723125/','/6951/')}));
});
test('SEC earnings observer completes when historical financial rows lack documents',async()=>{
  configureEarningsMap(graph,ids);
  const fx=earningsFirestore(),observer=createSecEarningsObserver(fx.db,{runId:'historical',emit:()=>{}} as unknown as MaintenanceLog,{deadline:fx.now()+60000,now:fx.now});
  const recent={...payload.filings.recent,form:['10-Q',...payload.filings.recent.form],accessionNumber:['0000723125-97-000001',...payload.filings.recent.accessionNumber],
    filingDate:['1997-11-14',...payload.filings.recent.filingDate],primaryDocument:['',...payload.filings.recent.primaryDocument],acceptanceDateTime:['',...payload.filings.recent.acceptanceDateTime]};
  await observer.observe('0000723125',{...payload,filings:{...payload.filings,recent}},async()=>{throw new Error('Unexpected archive');});
  assert.equal(observer.failed.size,0);assert.equal(observer.observed.size,1);
});
test('queued SEC earnings cannot advance coverage before its durable intake handoff',async()=>{
 configureEarningsMap(graph,ids);const fx=earningsFirestore(),log={runId:'queued',emit:()=>{}} as unknown as MaintenanceLog;
 let attempted=0;
 const failing=createSecEarningsObserver(fx.db,log,{deadline:fx.now()+60000,now:fx.now,publish:async()=>{attempted++;throw Error('queue unavailable');}});
 await failing.observe('0000723125',payload,async()=>{throw Error('Unexpected archive');});
 const key=`earnings_collectors/${secEarningsCursorId('US:MU')}`;
 assert(attempted>0);assert.equal(failing.failed.size,1);assert.equal(fx.rows.get(key)?.lastCompleteAt,undefined);assert.equal(fx.rows.get(key)?.status,'partial');
 const before=[...fx.rows.values()].filter(r=>r.recordType==='source').map(r=>r.sourceId);
 const retry=createSecEarningsObserver(fx.db,log,{deadline:fx.now()+60000,now:fx.now,publish:async discovery=>{assert(discovery.delivery);}});
 await retry.observe('0000723125',payload,async()=>{throw Error('Unexpected archive');});
 assert.equal(retry.failed.size,0);assert.equal(fx.rows.get(key)?.status,'complete');
 assert.deepEqual([...fx.rows.values()].filter(r=>r.recordType==='source').map(r=>r.sourceId),before);
});
test('shared-CIK listings get independent full windows and durable intake without changing existing source IDs',async()=>{
  const shared={...graph,nodes:[...graph.nodes,{...graph.nodes[0],id:'US:MU.B'}]};
  configureEarningsMap(shared,new Map([...ids,['US:MU.B','0000723125']]));
  const fx=earningsFirestore(),observer=createSecEarningsObserver(fx.db,{runId:'aliases',emit:()=>{}} as unknown as MaintenanceLog,{deadline:fx.now()+60000,now:fx.now});
  const raw={...payload,filings:{files:[],recent:{form:['8-K','8-K'],accessionNumber:['0000723125-26-000018','0000723125-26-000010'],filingDate:['2026-09-30','2026-06-01'],primaryDocument:['mu-20260930.htm','older.htm']}}};
  await observer.observe('0000723125',raw,async()=>{throw new Error('Unexpected archive');});
  assert.equal(observer.failed.size,0);assert.equal(observer.observed.size,2);
  for(const id of ['US:MU','US:MU.B'])assert.equal(fx.rows.get(`earnings_collectors/${secEarningsCursorId(id)}`)?.candidates,2);
  const sources=[...fx.rows.values()].filter(row=>row.recordType==='source');assert.equal(sources.length,4);
  assert.equal(sources.filter(row=>(row.source as {companyId:string}).companyId==='US:MU.B').length,2);
  const before=new Map(sources.map(row=>[row.sourceId,row.firstSeenAt]));
  const repeat=createSecEarningsObserver(fx.db,{runId:'again',emit:()=>{}} as unknown as MaintenanceLog,{deadline:fx.now()+60000,now:fx.now});
  await repeat.observe('0000723125',raw,async()=>{throw new Error('Unexpected archive');});
  assert.equal(repeat.failed.size,0);
  const after=[...fx.rows.values()].filter(row=>row.recordType==='source');assert.equal(after.length,4);
  for(const row of after)assert.equal(row.firstSeenAt,before.get(row.sourceId));
});
test('Micron quarterly revenue uses its 14-week period and cannot absorb annual or reordered columns',()=>{
  configureEarningsMap(graph,ids);
  const text=readFileSync(resolve('tests/fixtures/earnings/map/micron-q4-2026.txt'),'utf8');
  const filing=discoverSecEarnings('US:MU',payload,now)[0];
  const source={...filing,url:'https://www.sec.gov/Archives/edgar/data/723125/000072312526000018/a2026q4ex991-pressrelease.htm',documentId:'0000723125-26-000018/a2026q4ex991-pressrelease.htm',title:'EX-99.1 EARNINGS RELEASE'};
  const document=(body:string)=>captureEarningsDocument(source,Buffer.from(body),{mediaType:'text/plain',retrievedAt:now,completeness:'excerpt'});
  const doc=document(text),plan=makeUsEarningsPlan(doc);assert.ok(plan);
  const outcome=extractEarnings(doc,plan,now);assert.equal(outcome.status,'extracted');
  if(outcome.status==='extracted'){
    assert.deepEqual(outcome.record.period,{start:'2026-05-29',end:'2026-09-03',type:'quarter',fiscalYear:2026,fiscalQuarter:4});
    assert.equal(outcome.record.metrics[0].value,54229000000);
    assert.equal(outcome.record.announcementDate,'2026-09-30');
    // Synthetic full capture exercises the public gate; it does not represent stored production data.
    const fullOutcome=extractEarnings({...doc,completeness:'full'},plan,now);assert.equal(fullOutcome.status,'extracted');
    if(fullOutcome.status!=='extracted')return;
    const record=fullOutcome.record;
    const summary=publicEarningsSummary(record,'US:MU',new Date(now));assert.ok(summary);
    assert.equal(summary.metrics[0].value,54229000000);
    for(const invalid of [outcome.record,{...record,companyId:'US:OTHER'},{...record,kind:'forecast' as const},{...record,metrics:[...record.metrics,record.metrics[0]]},{...record,metrics:record.metrics.map(metric=>({...metric,sourceUrl:'https://example.com/unsourced'}))},{...record,metrics:record.metrics.map(metric=>({...metric,period:{...metric.period,fiscalQuarter:1}}))}])assert.equal(publicEarningsSummary(invalid,'US:MU',new Date(now)),null);
    const replacement={...record,eventId:'corrected',revisionId:'new',supersedes:record.eventId};
    const stale={...replacement,revisionId:'old',metrics:[]};
    const heads=new Map([[record.eventId,record.revisionId],['corrected','new']]);
    assert.deepEqual(latestPublicEarnings([record,stale,replacement],heads,'US:MU',new Date(now)),summary);
    assert.deepEqual(latestPublicEarnings([record,stale],heads,'US:MU',new Date(now)),summary);
    assert.equal(latestPublicEarnings([record],new Map(),'US:MU',new Date(now)),null);
  }
  for(const change of [text.replace('May 28, 2026','March 28, 2026'),text.replace('4th Qtr. | 3rd Qtr.','3rd Qtr. | 4th Qtr.'),text.replace('Fiscal Q4 2026 Highlights','Fiscal Q1 2026 Highlights'),text.replaceAll('Micron','Other').replaceAll('MICRON','OTHER')])assert.equal(makeUsEarningsPlan(document(change)),null);
});
test('China map issuers use exact exchange identity and the reviewed common table layout',()=>{
  configureEarningsMap(graph,ids);
  assert.equal(parseCnEarningsOrg('XSHE:000063',[{code:'000063',category:'A股',orgId:'testorg',zwjc:'中兴通讯'}]),'testorg');
  assert.throws(()=>parseCnEarningsOrg('XSHE:000063',[{code:'000063',category:'A股',orgId:'testorg',zwjc:'Other'}]));
  const [source]=discoverCnEarnings('XSHE:000063',{hasMore:false,totalAnnouncement:1,announcements:[{secCode:'000063',announcementId:'123456',announcementTitle:'2026年第一季度报告',adjunctUrl:'finalpage/2026-04-29/123456.PDF'}]},now);
  const text='中兴通讯 2026年第一季度报告\n一、主要会计数据和财务指标\n本报告期              上年同期              本报告期比上年同期增减（%）\n营业收入（元） 100,000.00 90,000.00 11.11%\n归属于上市公司股东的净利润 20,000.00';
  const doc=captureEarningsDocument(source,Buffer.from('%PDF-test'),{mediaType:'application/pdf',pdfText:text,retrievedAt:now,completeness:'excerpt'});
  // Production requires full PDF captures; do not treat this synthetic excerpt as one.
  assert.equal(makeCnEarningsPlan(doc),null);
  const plan=makeCnEarningsPlan({...doc,completeness:'full'});assert.ok(plan);
  assert.equal(extractEarnings({...doc,completeness:'full'},plan,now).status,'extracted');
  assert.deepEqual(discoverCnEarnings('XSHE:000063',{announcements:null,hasMore:false,totalAnnouncement:0},now),[]);
});
test('reviewed renamed China issuers require the exact ticker, organisation and current short name',()=>{
  const cases=[['XSHG:688347','华虹公司','9900029531','华虹宏力'],['XSHE:000672','上峰水泥','gssz0000672','上峰材料'],
    ['XSHG:600228','*ST返利','gssh0600228','返利科技'],['XSHE:000504','*ST生物','gssz0000504','南华生物']] as const;
  const renamed:KnowledgeGraph={asOf:'2026-10-27',nodes:cases.map(([id,name],i)=>({id,market:'CN_A',name,kind:'COMPANY',order:i})),relationships:[],sources:[]};
  configureEarningsMap(renamed,new Map());
  for(const [id,,orgId,zwjc] of cases){
    const row={code:id.split(':')[1],category:'A股',orgId,zwjc};
    assert.equal(parseCnEarningsOrg(id,[row]),orgId);
    assert.throws(()=>parseCnEarningsOrg(id,[{...row,orgId:'changed'}]));
    assert.throws(()=>parseCnEarningsOrg(id,[{...row,zwjc:'unrelated'}]));
    assert.throws(()=>parseCnEarningsOrg(id,[row,row]));
  }
});


test('issuer membership reflects source changes without a checkpoint or timer',async()=>{
 const fx=earningsFirestore();
 fx.rows.set('collectors/_read_cache_versions_v1',{enabled:true,versions:{collectors:'one'}});
 fx.rows.set('collectors/sec-identity-US:MU',{companyId:'US:MU',cik:'0000723125'});
 await loadEarningsMap(fx.db,graph);
 fx.rows.set('collectors/sec-identity-US:AMAT',{companyId:'US:AMAT',cik:'0000006951'});
 await loadEarningsMap(fx.db,graph);
 assert.equal(earningsCompany('US:AMAT').issuerId,'sec:0000006951');
 await loadEarningsMap(fx.db,graph);
 assert.equal(earningsCompany('US:AMAT').issuerId,'sec:0000006951');
});
