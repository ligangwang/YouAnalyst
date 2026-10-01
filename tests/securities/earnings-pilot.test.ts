import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { replayEarningsFixture } from '../../src/lib/earnings/replay';
import { collectCnEarningsPages, discoverCnEarnings, discoverSecEarnings, discoverSecExhibits, classifyEarningsTitle } from '../../src/lib/earnings/discovery';
import { captureEarningsDocument, htmlToEarningsText } from '../../src/lib/earnings/document';
import { emptyEarningsReplayState, stageEarningsRecord, drainEarningsOutbox } from '../../src/lib/earnings/ledger';
import { type EarningsRecord, sourceIdentity, validatePeriod } from '../../src/lib/earnings/model';

const now='2026-10-01T14:00:00Z';
const fixtureRoot=resolve('tests/fixtures/earnings');
const usIds=['nvda-fy2027-q1','nvda-fy2027-q2','amd-fy2026-q1','amd-fy2026-q2','msft-fy2026-q3','msft-fy2026-q4','baba-fy2026-q4','baba-fy2027-q1'];
const cnIds=['smic-q1-2026','smic-h1-2026','longsys-q1-2026','longsys-h1-2026','cambricon-q1-2026','cambricon-h1-2026','zhongji-q1-2026','zhongji-h1-2026','longsys-h1-forecast-2026'];
const json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
for(const id of usIds)test(`official-source factual fixture ${id}: amounts, fiscal period and provenance`,async()=>{
 const original=json(resolve(fixtureRoot,'us',id+'.json'));
 const result=await replayEarningsFixture(resolve(fixtureRoot,'us',id+'.replay.json'),{now});
 assert.equal(result.outcome.status,'extracted',JSON.stringify(result.outcome));
 if(result.outcome.status!=='extracted')return;
 const record=result.outcome.record, revenue=record.metrics.find(m=>m.name==='revenue'&&m.kind==='actual'&&m.scope==='consolidated')!;
 assert.equal(revenue.value,original.expected.revenue.amount*1e6);
 assert.equal(revenue.currency,original.expected.revenue.currency);
 assert.equal(record.period.end,original.expected.fiscal_period.period_end);
 assert.equal(record.period.fiscalYear,original.expected.fiscal_period.fiscal_year);
 assert.equal(record.period.fiscalQuarter,original.expected.fiscal_period.fiscal_quarter);
 assert.equal(record.metrics.find(m=>m.name==='revenue_yoy')!.value,original.expected.revenue.yoy_percent);
 assert.equal(record.completeness,'excerpt');assert.equal(record.announcementDate,null);
 assert.equal(record.periodEvidence.length,4);
 assert.ok(record.metrics.every(m=>m.evidence.length&&m.evidence.every(e=>e.text)&&m.sourceUrl.startsWith('https://')));
 assert.equal(record.metrics.filter(m=>m.scope==='segment'&&m.kind==='actual').length,original.expected.segments.length);
 const again=await replayEarningsFixture(resolve(fixtureRoot,'us',id+'.replay.json'),{now:'2026-10-02T14:00:00Z'});
 assert.equal(again.outcome.status,'extracted');if(again.outcome.status==='extracted')assert.equal(record.revisionId,again.outcome.record.revisionId);
});
for(const id of cnIds)test(`official-source factual fixture ${id}: native units and actual/forecast separation`,async()=>{
 const fixture=json(resolve(fixtureRoot,'cn',id+'.json'));
 const result=await replayEarningsFixture(resolve(fixtureRoot,'cn',id+'.json'),{now});
 assert.equal(result.outcome.status,'extracted',JSON.stringify(result.outcome));if(result.outcome.status!=='extracted')return;
 const record=result.outcome.record,metric=record.metrics.find(m=>m.name==='revenue')!;
 assert.deepEqual(record.period,fixture.expected.period);assert.equal(record.kind,fixture.expected.kind);
 assert.equal(metric.currency,'CNY');assert.equal(metric.value,fixture.expected.revenue);
 assert.equal(metric.scale,fixture.expected.scale);
 if(record.kind==='forecast'){assert.equal(metric.low,fixture.expected.lower);assert.equal(metric.high,fixture.expected.upper);assert.ok(record.metrics.every(m=>m.kind==='forecast'));}
 else assert.equal(record.metrics.find(m=>m.name==='revenue_yoy')!.value,fixture.expected.yoy);
 if(id.includes('h1')){assert.equal(record.period.type,'half_year');assert.equal(record.period.fiscalQuarter,undefined);}
});
test('CNINFO recorded announcement rows discover the eight reports and forecast; calendar notices excluded',()=>{
 const fixture=json(resolve(fixtureRoot,'cn/discovery.json'));
 const sources=Object.entries({'301308':'XSHE:301308','688981':'XSHG:688981','688256':'XSHG:688256','300308':'XSHE:300308'}).flatMap(([code,id])=>discoverCnEarnings(id,{announcements:fixture.rows.filter((row:{secCode:string})=>row.secCode===code),hasMore:false},now));
 assert.equal(sources.length,9);assert.equal(new Set(sources.map(sourceIdentity)).size,9);
 assert.ok(sources.every(s=>s.publishedAt?.precision==='date'&&s.publishedAt.timezone==='Asia/Shanghai'));
 assert.ok(!sources.some(s=>/提示性|预约披露/.test(s.title)));
 const row=fixture.rows.find((r:{secCode:string})=>r.secCode==='688981');
 assert.throws(()=>discoverCnEarnings('XSHE:301308',{announcements:[row],hasMore:false},now),/issuer mismatch/);
 assert.equal(classifyEarningsTitle('2026年半年度业绩预告'),'forecast');
 assert.equal(classifyEarningsTitle('2026年度业绩快报'),'preliminary');
});
test('pagination never advances a cursor after truncation, repeated pages, malformed body or failure',async()=>{
 const row=json(resolve(fixtureRoot,'cn/discovery.json')).rows.find((r:{secCode:string})=>r.secCode==='301308');
 const page={announcements:[row],hasMore:true};
 await assert.rejects(()=>collectCnEarningsPages({companyId:'XSHE:301308',firstSeenAt:now,maxPages:1,fetchPage:async()=>page}),/incomplete/);
 await assert.rejects(()=>collectCnEarningsPages({companyId:'XSHE:301308',firstSeenAt:now,fetchPage:async()=>page}),/Repeated/);
 await assert.rejects(()=>collectCnEarningsPages({companyId:'XSHE:301308',firstSeenAt:now,fetchPage:async()=>{throw new Error('429');}}),/429/);
 assert.throws(()=>discoverCnEarnings('XSHE:301308',{announcements:[],hasMore:'false'},now),/Invalid/);
 const done=await collectCnEarningsPages({companyId:'XSHE:301308',firstSeenAt:now,fetchPage:async n=>({announcements:n===1?[row]:[],hasMore:n===1,totalAnnouncement:1})});
 assert.equal(done.sources.length,1);assert.equal(done.pages,2);
});
function secSource(){return discoverSecEarnings('US:AMD',{cik:2488,filings:{recent:{form:['8-K','10-Q','4'],accessionNumber:['0000002488-26-000121','0000002488-26-000122','0000002488-26-000123'],filingDate:['2026-08-04','2026-08-05','2026-08-05'],primaryDocument:['amd8k.htm','amd10q.htm','x.xml'],acceptanceDateTime:['2026-08-04T20:12:00Z','2026-08-05T20:00:00Z','2026-08-05T20:00:00Z']}}},now)[0];}
test('SEC scanner adapter keeps 8-K candidate and acceptance separate from release publication',()=>{
 const source=secSource();assert.equal(source.form,'8-K');assert.equal(source.publishedAt,null);assert.equal(source.filingAcceptedAt,'2026-08-04T20:12:00Z');
 assert.throws(()=>discoverSecEarnings('US:NVDA',{cik:2488,filings:{recent:{form:[]}}},now),/identity/);
 const index='<table><tr><td>2</td><td>Earnings release</td><td><a href="release.htm">release.htm</a></td><td>EX-99.2</td></tr><tr><td><a href="cover.htm">cover</a></td><td>8-K</td></tr></table>';
 const exhibits=discoverSecExhibits(source,index);assert.equal(exhibits.length,1);assert.match(exhibits[0].url,/release.htm$/);assert.notEqual(exhibits[0].documentId,source.documentId);
 assert.throws(()=>discoverSecExhibits(source,index.replace('release.htm','https://evil.test/release.htm')),/Unsafe/);
});
test('raw captures hash exact bytes and reject unsafe, blocked, scanned and mismatched sources',()=>{
 const source=secSource(),body=Buffer.from('<h1>AMD</h1><script>Revenue 999</script><table><tr><td>Revenue</td><td>100</td></tr></table>');
 const capture=captureEarningsDocument(source,body,{mediaType:'text/html',retrievedAt:now});
 assert.match(capture.text,/Revenue \| 100/);assert.ok(!capture.text.includes('999'));
 assert.equal(capture.completeness,'full');assert.equal(captureEarningsDocument(source,body,{mediaType:'text/html',retrievedAt:now}).rawSha256,capture.rawSha256);
 assert.throws(()=>captureEarningsDocument({...source,url:'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/nvda.htm'},body,{mediaType:'text/html',retrievedAt:now}),/mismatch/);
 assert.throws(()=>captureEarningsDocument(source,Buffer.from('Access denied'),{mediaType:'text/plain',retrievedAt:now}),/blocked/);
 assert.throws(()=>captureEarningsDocument(source,Buffer.from('%PDF-1.7'),{mediaType:'application/pdf',retrievedAt:now}),/PDF text unavailable/);
 assert.match(htmlToEarningsText('<tr><td>Revenue\n</td><td> \n100\n </td></tr>'),/Revenue \| 100/);
});
test('idempotent outbox retries, same-source revisions and explicit correction lineage preserve history',async()=>{
 const result=await replayEarningsFixture(resolve(fixtureRoot,'cn/longsys-h1-2026.json'),{now});assert.equal(result.outcome.status,'extracted');if(result.outcome.status!=='extracted')return;
 const original=result.outcome.record;let state=stageEarningsRecord(emptyEarningsReplayState(),original).state;
 assert.equal(stageEarningsRecord(state,original).status,'duplicate');
 await assert.rejects(()=>drainEarningsOutbox(state,async()=>{throw new Error('publish failed');}));assert.equal(Object.values(state.outbox)[0].acknowledged,false);
 let sent=0;state=await drainEarningsOutbox(state,async()=>{sent++;});state=await drainEarningsOutbox(state,async()=>{sent++;});assert.equal(sent,1);
 // Synthetic correction of an actual source fixture, not a claimed real notice.
 const correction:EarningsRecord={...original,eventId:'synthetic-correction',revisionId:'synthetic-revision',supersedes:original.eventId,source:{...original.source,publishedAt:{value:'2026-09-01',precision:'date',timezone:'Asia/Shanghai'}}};
 assert.equal(stageEarningsRecord(emptyEarningsReplayState(),correction).status,'predecessor_missing');
 state=stageEarningsRecord(state,correction).state;assert.equal(Object.keys(state.records).length,2);
 assert.throws(()=>stageEarningsRecord(state,{...correction,revisionId:'wrong-company',issuerId:'cn:688981'}),/mismatch/);
 assert.throws(()=>stageEarningsRecord(state,{...correction,revisionId:'wrong-kind',kind:'forecast'}),/mismatch/);
});
test('period duration validation does not let YTD, invalid dates or annual fields masquerade as a quarter',()=>{
 assert.throws(()=>validatePeriod({start:'2026-01-01',end:'2026-06-30',type:'quarter',fiscalYear:2026,fiscalQuarter:2}),/duration/);
 assert.throws(()=>validatePeriod({start:'2026-02-30',end:'2026-06-30',type:'quarter',fiscalYear:2026,fiscalQuarter:2}),/Invalid/);
 assert.throws(()=>validatePeriod({start:'2026-01-01',end:'2026-06-30',type:'half_year',fiscalYear:2026,fiscalQuarter:2}),/cannot/);
});
test('pilot runtime is a read-only local rehearsal and does not import cloud clients or HTTP',()=>{
 for(const path of ['scripts/replay-earnings-pilot.ts','src/lib/earnings/replay.ts','src/lib/earnings/ledger.ts']){
  const code=readFileSync(path,'utf8');assert.doesNotMatch(code,/from ["'](?:firebase|@google-cloud)|getFirestore\(|fetch\(|\.collection\(/);
 }
 assert.equal(readdirSync(resolve(fixtureRoot,'us')).filter(f=>f.endsWith('.replay.json')).length,8);
});

test('indirect correction cycles are rejected and partial publication remains explicitly at-least-once',async()=>{
 const r=await replayEarningsFixture(resolve(fixtureRoot,'cn/longsys-h1-2026.json'),{now});assert.equal(r.outcome.status,'extracted');if(r.outcome.status!=='extracted')return;
 const a=r.outcome.record,b={...a,eventId:'B',revisionId:'B1',supersedes:a.eventId};
 let state=stageEarningsRecord(emptyEarningsReplayState(),a).state;state=stageEarningsRecord(state,b).state;
 assert.throws(()=>stageEarningsRecord(state,{...a,revisionId:'A2',supersedes:b.eventId}),/cycle/);
 const deliveries:string[]=[];
 await assert.rejects(()=>drainEarningsOutbox(state,async item=>{if(item.eventId==='B')throw new Error('partial failure');deliveries.push(item.revisionId);}));
 await drainEarningsOutbox(state,async item=>{deliveries.push(item.revisionId);});
 assert.equal(deliveries.filter(id=>id===a.revisionId).length,2); // downstream revisionId deduplication required
});

test('CLI exits nonzero and reports unresolved correction staging rather than clean success',async()=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const{tmpdir}=await import('node:os');const{spawnSync}=await import('node:child_process');
 const dir=await mkdtemp(resolve(tmpdir(),'earnings-cli-'));
 try{
  const original=resolve(fixtureRoot,'cn/longsys-h1-2026.json'),fixture=json(original);
  fixture.source.correctionOf='synthetic-unknown-predecessor';
  fixture.bodyFile=resolve(fixtureRoot,'cn',fixture.bodyFile);fixture.planFile=resolve(fixtureRoot,'cn',fixture.planFile);
  const manifest=resolve(dir,'synthetic-correction.json');await writeFile(manifest,JSON.stringify(fixture));
  const result=spawnSync(process.execPath,['--import','tsx','scripts/replay-earnings-pilot.ts','--dry-run','--manifest='+manifest],{cwd:process.cwd(),encoding:'utf8'});
  assert.equal(result.status,1,result.stderr);const rows=result.stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(rows[0].staging,'predecessor_missing');assert.equal(rows.at(-1).reviewRequired,1);assert.equal(rows.at(-1).stagedRevisions,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('stable identities do not depend on JSON property insertion order',async()=>{
 const {stableId}=await import('../../src/lib/earnings/model');
 assert.equal(stableId('period',[{start:'2026-01-01',end:'2026-03-31'}]),stableId('period',[{end:'2026-03-31',start:'2026-01-01'}]));
});

test('injection-only collector composes discovery, raw capture, validation and idempotent staging',async()=>{
 const {collectEarningsDocuments}=await import('../../src/lib/earnings/collector');
 const fixture=json(resolve(fixtureRoot,'cn/longsys-h1-2026.json')),plan=json(resolve(fixtureRoot,'cn',fixture.planFile));
 let downloads=0;
 const options={sources:[fixture.source,fixture.source],now,download:async()=>{downloads++;return{bytes:readFileSync(resolve(fixtureRoot,'cn',fixture.bodyFile)),mediaType:'text/plain' as const,completeness:'excerpt' as const};},plan:async()=>plan};
 const first=await collectEarningsDocuments(options);assert.equal(first.complete,true);assert.equal(first.results[0].status,'staged');assert.equal(downloads,1);
 const again=await collectEarningsDocuments({...options,state:first.state});assert.equal(again.results[0].status,'duplicate');
 const failure=await collectEarningsDocuments({...options,state:first.state,download:async()=>{throw new Error('provider cooldown');}});assert.equal(failure.complete,false);assert.deepEqual(failure.state,first.state);
 const unreviewed=await collectEarningsDocuments({...options,plan:async()=>null});assert.equal(unreviewed.complete,false);assert.equal(unreviewed.results[0].reason,'no_reviewed_source_adapter');
});

test('Chinese Q1 fiscalQuarter must equal its source label, not any valid quarter number',async()=>{
 const {extractEarnings}=await import('../../src/lib/earnings/extract');
 const fixture=json(resolve(fixtureRoot,'cn/longsys-q1-2026.json')),plan=json(resolve(fixtureRoot,'cn',fixture.planFile));
 const doc=captureEarningsDocument(fixture.source,readFileSync(resolve(fixtureRoot,'cn',fixture.bodyFile)),{mediaType:'text/plain',retrievedAt:now,completeness:'excerpt'});
 plan.period.fiscalQuarter=4;const result=extractEarnings(doc,plan,now);assert.equal(result.status,'review_required');if(result.status==='review_required')assert.match(result.reason,/Period conflicts/);
});

test('Chinese half-year cannot become Q2 by omitting the literal report-period label',async()=>{
 const {extractEarnings}=await import('../../src/lib/earnings/extract');
 const fixture=json(resolve(fixtureRoot,'cn/longsys-h1-2026.json')),plan=json(resolve(fixtureRoot,'cn',fixture.planFile));
 const doc=captureEarningsDocument(fixture.source,readFileSync(resolve(fixtureRoot,'cn',fixture.bodyFile)),{mediaType:'text/plain',retrievedAt:now,completeness:'excerpt'});
 plan.periodEvidence=['2026'];
 for(const period of [plan.period,{start:'2026-04-01',end:'2026-06-30',type:'quarter',fiscalYear:2026,fiscalQuarter:2}]){
  const result=extractEarnings(doc,{...plan,period},now);assert.equal(result.status,'review_required');if(result.status==='review_required')assert.match(result.reason,/recognized report title.*literal period evidence/);
 }
});
test('Chinese period evidence must agree with the discovery report title',async()=>{
 const {extractEarnings}=await import('../../src/lib/earnings/extract');
 const fixture=json(resolve(fixtureRoot,'cn/longsys-q1-2026.json')),plan=json(resolve(fixtureRoot,'cn',fixture.planFile));
 const doc=captureEarningsDocument({...fixture.source,title:'2026 年半年度报告'},readFileSync(resolve(fixtureRoot,'cn',fixture.bodyFile)),{mediaType:'text/plain',retrievedAt:now,completeness:'excerpt'});
 const result=extractEarnings(doc,plan,now);assert.equal(result.status,'review_required');if(result.status==='review_required')assert.match(result.reason,/Period conflicts with Chinese/);
});

test('correction metadata changes revision identity and cannot disappear behind duplicate handling',async()=>{
 const{extractEarnings}=await import('../../src/lib/earnings/extract');
 const fixture=json(resolve(fixtureRoot,'cn/longsys-h1-2026.json')),plan=json(resolve(fixtureRoot,'cn',fixture.planFile)),bytes=readFileSync(resolve(fixtureRoot,'cn',fixture.bodyFile));
 const run=(correctionOf?:string)=>extractEarnings(captureEarningsDocument({...fixture.source,...(correctionOf?{correctionOf}:{})},bytes,{mediaType:'text/plain',retrievedAt:now,completeness:'excerpt'}),plan,now);
 const a=run(),b=run('missing-predecessor');assert.equal(a.status,'extracted');assert.equal(b.status,'extracted');if(a.status!=='extracted'||b.status!=='extracted')return;
 assert.equal(a.record.eventId,b.record.eventId);assert.notEqual(a.record.revisionId,b.record.revisionId);
 const state=stageEarningsRecord(emptyEarningsReplayState(),a.record).state;
 assert.equal(stageEarningsRecord(state,b.record).status,'predecessor_missing');
 assert.throws(()=>stageEarningsRecord(state,{...b.record,revisionId:a.record.revisionId}),/Conflicting content/);
});
test('advertised page totals and repeated terminal pages cannot falsely report complete discovery',async()=>{
 const row=json(resolve(fixtureRoot,'cn/discovery.json')).rows.find((r:{secCode:string})=>r.secCode==='301308');
 const base={companyId:'XSHE:301308',firstSeenAt:now};
 await assert.rejects(()=>collectCnEarningsPages({...base,fetchPage:async()=>({announcements:[row],hasMore:false,totalAnnouncement:100})}),/total incomplete/);
 await assert.rejects(()=>collectCnEarningsPages({...base,fetchPage:async n=>({announcements:[row],hasMore:n===1,totalAnnouncement:2})}),/Repeated/);
 await assert.rejects(()=>collectCnEarningsPages({...base,fetchPage:async()=>({announcements:[],hasMore:true,totalAnnouncement:5})}),/Empty nonterminal/);
});

test('correction chronology compares offset timestamps as instants',async()=>{
 const r=await replayEarningsFixture(resolve(fixtureRoot,'cn/longsys-h1-2026.json'),{now});assert.equal(r.outcome.status,'extracted');if(r.outcome.status!=='extracted')return;
 const a:EarningsRecord={...r.outcome.record,source:{...r.outcome.record.source,publishedAt:{value:'2026-08-11T09:00:00Z',precision:'second',timezone:'UTC'}}};
 const state=stageEarningsRecord(emptyEarningsReplayState(),a).state;
 const correction:EarningsRecord={...a,eventId:'time-correction',revisionId:'time-revision',supersedes:a.eventId,source:{...a.source,publishedAt:{value:'2026-08-11T16:30:00+08:00',precision:'second',timezone:'Asia/Shanghai'}}};
 assert.throws(()=>stageEarningsRecord(state,correction),/predates/);
});
