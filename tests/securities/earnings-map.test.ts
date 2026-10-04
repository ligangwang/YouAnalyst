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
import {createSecEarningsObserver} from '../../src/lib/earnings/sec-observer';
import {loadEarningsMap} from '../../src/lib/earnings/map-issuers';
import {earningsFirestore} from '../helpers/earnings-firestore';
import type {MaintenanceLog} from '../../src/lib/maintenance-log';

const graph:KnowledgeGraph={asOf:'2026-10-04',nodes:[
  {id:'US:MU',market:'US',name:'Micron Technology, Inc.',aliases:['Micron'],kind:'COMPANY',order:1},
  {id:'US:AMAT',market:'US',name:'Applied Materials',kind:'COMPANY',order:2},
  {id:'XSHE:000063',market:'CN_A',name:'ZTE',names:{'zh-CN':'中兴通讯'},kind:'COMPANY',order:3},
  {id:'ORG:OPENAI',market:'GLOBAL',name:'OpenAI',kind:'COMPANY',order:4}],relationships:[],sources:[]};
const ids=new Map([['US:MU','0000723125'],['US:AMAT','0000006951']]);
const now='2026-10-04T12:00:00Z';
const payload={cik:723125,filings:{files:[],recent:{form:['8-K'],accessionNumber:['0000723125-26-000018'],filingDate:['2026-09-30'],primaryDocument:['mu-20260930.htm'],acceptanceDateTime:['2026-09-30T20:02:22Z']}}};
test.afterEach(()=>restoreEarningsFixtures());

test('earnings eligibility follows the map and verified scanner identities, never the adapter hints',async()=>{
  const fx=earningsFirestore();fx.rows.set('collectors/sec-US:MU',{companyId:'US:MU',cik:'0000723125'});
  fx.rows.set('collectors/sec-US:AMAT',{companyId:'US:OTHER',cik:'0000006951'});
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
