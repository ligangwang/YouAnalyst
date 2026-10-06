import test from 'node:test';
import assert from 'node:assert/strict';
import {mapListedCompanies,secDisclosureRows,cnDisclosureRows} from '../../src/lib/events/disclosures';
import {cnMapOrg,readCnMapDisclosures} from '../../src/lib/events/cn-disclosures';
import {originalArticleMetadata,parseHtmlNewsIndex} from '../../src/lib/intelligence/collectors/html-news';
import {approvedNewsUrl,parseNewsFeed,fetchNews} from '../../src/lib/intelligence/collectors/news';
import {NEWS_SOURCES} from '../../scripts/seed-news-sources';
import type {NewsSource} from '../../src/lib/intelligence/collectors/sources';
import {projectDisclosures} from '../../src/lib/events/disclosure-projection';
import type {KnowledgeGraph} from '../../src/lib/knowledge-graph/model';
import {earningsFirestore} from '../helpers/earnings-firestore';
import {saveDisclosures} from '../../src/lib/events/disclosure-store';
import {createMapSecObserver,SEC_LINK_COVERAGE_VERSION} from '../../src/lib/events/sec-disclosures';
import {secFilingCategory} from '../../src/lib/events/sec-filing-metadata';
import {parseSecFilingRows} from '../../src/lib/sec-filings/source';
import {collectCnMapDisclosures} from '../../src/lib/events/cn-disclosures';
import {collectLiveEarnings} from '../../src/lib/earnings/live-collector';
import {reviewedEarningsIssuers,restoreEarningsFixtures} from '../../src/lib/earnings/issuers';
import type {MaintenanceLog} from '../../src/lib/maintenance-log';
const graph:KnowledgeGraph={asOf:'2026-10-03',nodes:[{id:'US:MU',name:'Micron',market:'US',kind:'COMPANY',order:0},{id:'XSHE:000063',name:'ZTE',market:'CN_A',kind:'COMPANY',order:1},{id:'ORG:OPENAI',market:'GLOBAL',kind:'COMPANY',order:2}],relationships:[],sources:[]};
const payload={cik:723125,filings:{recent:{accessionNumber:['0000723125-26-000018'],form:['8-K'],filingDate:['2026-09-30'],primaryDocument:['mu-20260930.htm'],items:['2.02,9.01'],acceptanceDateTime:['2026-09-30T20:02:22Z']}}};
const cn={hasMore:false,totalAnnouncement:1,announcements:[{secCode:'000063',orgId:'testorg',announcementId:'12123',announcementTitle:'2026年半年度报告',adjunctUrl:'finalpage/2026-08-20/12123.PDF'}]};
test('all map listings participate regardless of extraction pilot; private organizations do not become SEC issuers',()=>{
  assert.deepEqual(mapListedCompanies(graph).map(n=>n.id),['US:MU','XSHE:000063']);
  assert(NEWS_SOURCES.some(s=>s.companyId==='US:MU'));
});
test('MU earnings 8-K is collected with its original acceptance time, without invented period dates',()=>{
  const [row]=secDisclosureRows('US:MU','0000723125',payload);assert.equal(row.category,'EARNINGS');assert.equal(row.published_at,'2026-09-30T20:02:22.000Z');assert.equal(row.publication_date,'2026-09-30');
  assert.throws(()=>secDisclosureRows('US:MU','0000723126',payload),/issuer mismatch/);
  assert.equal(secDisclosureRows('US:MU','0000723125',{...payload,filings:{recent:{...payload.filings.recent,form:['6-K'],items:['']}}})[0].category,'FILING');
});
test('all SEC form links enter the feed, including ownership XSL paths, amendments and notices without primary documents',()=>{
  const forms=['10-Q','4','4/A','3','5','144','SC 13D','SCHEDULE 13G/A','DEF 14A','DEFM14A','S-1','S-3ASR','424B5','S-4','SC TO-T','NT 10-Q','CORRESP','FUTURE-FORM','EFFECT','13F-HR'];
  const recent={form:forms,accessionNumber:forms.map((_,i)=>`0000723125-26-${String(i+1).padStart(6,'0')}`),filingDate:forms.map(()=>'2026-09-30'),primaryDocument:forms.map((form,i)=>form==='EFFECT'?'':form.startsWith('4')?'xslF345X06/ownership.xml':`filing-${i}.htm`),isXBRL:forms.map(()=>0)};
  const rows=secDisclosureRows('US:MU','0000723125',{cik:723125,filings:{recent}});
  assert.equal(rows.length,forms.length);assert.deepEqual(rows.map(row=>row.form),forms);
  assert.equal(rows[1].filingCategory,'insider_ownership');assert.match(rows[1].url,/\/xslF345X06\/ownership.xml$/);
  assert.equal(rows[7].filingCategory,'major_ownership');assert.equal(rows[8].filingCategory,'proxy');assert.equal(rows[9].filingCategory,'merger_tender');
  assert.equal(rows[11].filingCategory,'offering');assert.equal(rows[15].filingCategory,'late_filing');assert.equal(rows[17].filingCategory,'other');
  assert.equal(secFilingCategory('DEFC14A'),'proxy');assert.equal(secFilingCategory('PREC14A/A'),'proxy');assert.equal(secFilingCategory('DEFM14A'),'merger_tender');
  assert.match(rows[18].url,/0000723125-26-000019-index.html$/);assert.equal(secFilingCategory('13F-HR'),'other');
  assert.equal(projectDisclosures(rows,graph,new Date('2026-10-03T12:00:00Z')).length,forms.length);
  // Broad event links never widen the financial extraction/outbox contract.
  assert.deepEqual(parseSecFilingRows(recent).map(row=>row.form),['10-Q']);
  for(const path of ['../private.xml','xsl/../private.xml','/private.xml','xsl//private.xml','xsl/private.xml?token=x','https://evil.example/file','xsl/%2e%2e/private.xml']){
    assert.throws(()=>secDisclosureRows('US:MU','0000723125',{cik:723125,filings:{recent:{...recent,primaryDocument:recent.primaryDocument.map((value,i)=>i===1?path:value)}}}),/Invalid SEC filing link/);
  }
  assert.throws(()=>secDisclosureRows('US:MU','0000723125',{cik:723125,filings:{recent:{...recent,form:forms.map((form,i)=>i===1?'':form)}}}),/Invalid SEC disclosure form/);
});
test('non-pilot China company disclosures retain date-only precision and reject wrong issuer or unsafe document paths',()=>{
  const [row]=cnDisclosureRows('XSHE:000063','testorg',cn);assert.equal(row.published_at,null);assert.equal(row.category,'EARNINGS');
  assert.throws(()=>cnDisclosureRows('XSHE:000064','testorg',cn),/issuer mismatch/);
  assert.throws(()=>cnDisclosureRows('XSHE:000063','testorg',{...cn,announcements:[{...cn.announcements[0],adjunctUrl:'../private.pdf'}]}),/Invalid exchange/);
  assert.equal(cnMapOrg('XSHE:000063',[{code:'000063',category:'A股',orgId:'testorg'}]),'testorg');
  assert.throws(()=>cnMapOrg('XSHE:000063',[{code:'000063',category:'B股',orgId:'testorg'}]),/Ambiguous/);
});
test('exchange pagination must be complete, consistent and nonoverlapping before its cursor can advance',async()=>{
  assert.deepEqual(cnDisclosureRows('XSHE:000063','testorg',{announcements:null,totalAnnouncement:0,hasMore:false}),[]);
  assert.throws(()=>cnDisclosureRows('XSHE:000063','testorg',{announcements:null,totalAnnouncement:1,hasMore:false}),/Incomplete/);
  const request=async(url:string)=>url.includes('topSearch')?[{code:'000063',category:'A股',orgId:'testorg'}]:cn;
  assert.equal((await readCnMapDisclosures('XSHE:000063','2026-01-01','2026-10-03',request,'2026-10-03T12:00:00Z')).length,1);
  await assert.rejects(readCnMapDisclosures('XSHE:000063','2026-01-01','2026-10-03',async url=>url.includes('topSearch')?request(url):{...cn,hasMore:true,totalAnnouncement:2},'2026-10-03T12:00:00Z'),/Overlapping/);
  await assert.rejects(readCnMapDisclosures('XSHE:000063','2026-01-01','2026-10-03',async url=>url.includes('topSearch')?request(url):{...cn,totalAnnouncement:2},'2026-10-03T12:00:00Z'),/Incomplete/);
});
test('repeated disclosure scans preserve the first collection and processing timestamps',async()=>{
  const fx=earningsFirestore(),rows=secDisclosureRows('US:MU','0000723125',payload);
  assert.equal(await saveDisclosures(fx.db,rows,'2026-10-02T11:00:00Z',true),1);
  const original=structuredClone(fx.rows.get(`events/${rows[0].id}`));
  assert.equal(await saveDisclosures(fx.db,rows,'2026-10-03T12:00:00Z',false),0);
  assert.deepEqual(fx.rows.get(`events/${rows[0].id}`),original);
});
test('SEC issuer aliases share transport but each map company gets its own collection state',async()=>{
  const fx=earningsFirestore(),ids=new Map([['0000723125',['US:MU']]]);
  const collector=createMapSecObserver(fx.db,ids,{deadline:fx.now()+60000,now:fx.now});
  const raw={...payload,filings:{...payload.filings,files:[]}};
  await collector.observe('0000723125',raw,async()=>{throw new Error('Unexpected archive')});
  ids.set('0000723125',['US:MU','US:ALIAS']);
  await collector.observe('0000723125',raw,async()=>{throw new Error('Unexpected archive')});
  assert.equal(fx.rows.get('collectors/sec-US:MU')?.status,'complete');
  assert.equal(fx.rows.get('collectors/sec-US:ALIAS')?.status,'complete');
  assert.equal(collector.failed.size,0);
});
test('expanded SEC coverage backfills existing issuers and resumes bounded batches without changing original timestamps',async()=>{
  const fx=earningsFirestore(),ids=new Map([['0000723125',['US:MU']]]),at='2026-10-01T12:00:00.000Z';
  const existing=secDisclosureRows('US:MU','0000723125',payload);
  await saveDisclosures(fx.db,existing,at,false);
  const original=structuredClone(fx.rows.get(`events/${existing[0].id}`));
  fx.rows.set('collectors/sec-US:MU',{cik:'0000723125',status:'complete',lastCompleteAt:at});
  const recent={form:['4','DEF 14A','S-3','8-K'],accessionNumber:['0000723125-26-000001','0000723125-26-000002','0000723125-26-000003',payload.filings.recent.accessionNumber[0]],filingDate:['2026-01-15','2026-03-01','2026-08-01','2026-09-30'],primaryDocument:['xslF345X06/ownership.xml','proxy.htm','registration.htm','mu-20260930.htm'],items:['','','','2.02,9.01'],acceptanceDateTime:['2026-01-15T12:00:00Z','','','2026-09-30T20:02:22Z']};
  const raw={cik:723125,filings:{recent,files:[]}};
  const run=()=>createMapSecObserver(fx.db,ids,{deadline:fx.now()+60000,now:fx.now,maxRowsPerCompany:2});
  const first=run();await first.observe('0000723125',raw,async()=>{throw new Error('Unexpected archive')});
  assert.equal(first.failed.size,1);assert.equal(fx.rows.get('collectors/sec-US:MU')?.lastCompleteAt,at);
  assert.equal(fx.rows.get('collectors/sec-US:MU')?.linkCoverageVersion,undefined);
  assert.equal([...fx.rows.keys()].filter(key=>key.startsWith('events/')).length,3);
  fx.advance(86400000);
  const second=run();await second.observe('0000723125',raw,async()=>{throw new Error('Unexpected archive')});
  assert.equal(second.failed.size,0);assert.equal(fx.rows.get('collectors/sec-US:MU')?.linkCoverageVersion,SEC_LINK_COVERAGE_VERSION);
  assert.equal(fx.rows.get('collectors/sec-US:MU')?.linkScan,null);
  assert.equal(fx.rows.get('collectors/sec-US:MU')?.lastCompleteAt,'2026-10-02T11:00:00.000Z');
  assert.equal([...fx.rows.keys()].filter(key=>key.startsWith('events/')).length,4);
  assert.deepEqual(fx.rows.get(`events/${existing[0].id}`),original);
  const ownership=[...fx.rows.values()].find(row=>row.form==='4')!;
  assert.equal(ownership.baseline,true);assert.equal(ownership.publication_date,'2026-01-15');assert.equal(ownership.published_at,'2026-01-15T12:00:00.000Z');
  assert.equal(ownership.collected_at,'2026-10-02T11:00:00.000Z');
});
test('SEC persistence failures replay their uncommitted batch and never advance full coverage',async()=>{
  const fx=earningsFirestore(),ids=new Map([['0000723125',['US:MU']]]),raw={...payload,filings:{...payload.filings,files:[]}};
  fx.reject(path=>path.startsWith('events/'));
  const first=createMapSecObserver(fx.db,ids,{deadline:fx.now()+60000,now:fx.now});
  await first.observe('0000723125',raw,async()=>null);
  assert.equal(first.failed.size,1);assert.equal(fx.rows.get('collectors/sec-US:MU')?.lastCompleteAt,undefined);
  assert.equal(fx.rows.get('collectors/sec-US:MU')?.linkScan,undefined);
  fx.reject(()=>false);
  const retry=createMapSecObserver(fx.db,ids,{deadline:fx.now()+60000,now:fx.now});
  await retry.observe('0000723125',raw,async()=>null);
  assert.equal(retry.failed.size,0);assert.equal([...fx.rows.keys()].filter(key=>key.startsWith('events/')).length,1);
});
test('SEC archive sets above twenty files resume by page without refetching completed pages',async()=>{
  const fx=earningsFirestore(),ids=new Map([['0000723125',['US:MU']]]),calls:string[]=[];
  const files=Array.from({length:25},(_,i)=>({name:`CIK0000723125-submissions-${i+1}.json`,filingFrom:'2026-01-01',filingTo:'2026-01-31'}));
  const raw={...payload,filings:{...payload.filings,files}};
  const archive=async(name:string)=>{
    calls.push(name);const number=files.findIndex(file=>file.name===name)+1;
    return {form:['4'],accessionNumber:[`0000723125-26-${String(number+100).padStart(6,'0')}`],filingDate:['2026-01-15'],primaryDocument:['xslF345X06/ownership.xml']};
  };
  for(let run=0;run<3;run++){
    const collector=createMapSecObserver(fx.db,ids,{deadline:fx.now()+60000,now:fx.now,maxArchivesPerCompany:10});
    await collector.observe('0000723125',raw,archive);
    assert.equal(collector.failed.size,run===2?0:1);
    assert.equal(fx.rows.get('collectors/sec-US:MU')?.linkCoverageVersion,run===2?SEC_LINK_COVERAGE_VERSION:undefined);
  }
  assert.equal(calls.length,25);assert.equal(new Set(calls).size,25);
  assert.equal([...fx.rows.keys()].filter(path=>path.startsWith('events/')).length,26);
  assert.equal(fx.rows.get('collectors/sec-US:MU')?.documents,26);assert.equal(fx.rows.get('collectors/sec-US:MU')?.created,26);
});
test('China non-pilot announcements reach universal events; incomplete scans retain their checkpoint',async()=>{
  const fx=earningsFirestore();
  const request=async(url:string)=>url.includes('topSearch')?[{code:'000063',category:'A股',orgId:'testorg'}]:cn;
  const first=await collectCnMapDisclosures(fx.db,graph,request,{deadline:fx.now()+60000,runId:'one',earningsEnabled:true,now:fx.now});
  assert.equal('created' in first&&first.created,1);
  const old=fx.rows.get('collectors/exchange-XSHE:000063')!.lastCompleteAt;
  fx.advance(2*3600000);
  const failed=await collectCnMapDisclosures(fx.db,graph,async url=>url.includes('topSearch')?request(url):{...cn,totalAnnouncement:2},{deadline:fx.now()+60000,runId:'two',earningsEnabled:true,now:fx.now});
  assert.equal('failed' in failed&&failed.failed,1);
  assert.equal(fx.rows.get('collectors/exchange-XSHE:000063')?.lastCompleteAt,old);
  assert.equal([...fx.rows.keys()].filter(k=>k.startsWith('events/')).length,1);
});
test('earnings discovery hands off per issuer only when enabled and fresh, and falls back during rollout or outages',async()=>{
  restoreEarningsFixtures();
  const fx=earningsFirestore(),calls:string[]=[],log={runId:'handoff',emit:()=>{}} as unknown as MaintenanceLog;
  const run=(enabled:boolean)=>collectLiveEarnings(fx.db,log,{discoveryOwnedByMap:enabled,discoverCn:async id=>{calls.push(id);return [];},publish:async()=>{throw new Error('No queued sources');},now:fx.now,deadline:fx.now()+60000});
  await run(true);assert.equal(calls.length,4); // The enabled replacement has not initialized yet.
  for(const company of reviewedEarningsIssuers.filter(c=>!c.cik))fx.rows.set(`collectors/exchange-${company.companyId}`,{status:'complete',earningsCoverageVersion:2,lastSuccessAt:new Date(fx.now()).toISOString()});
  calls.length=0;await run(true);assert.equal(calls.length,0);
  fx.advance(3600000);calls.length=0;await run(false);assert.equal(calls.length,4); // Disabled replacement never owns discovery.
  fx.advance(4*3600000);calls.length=0;await run(true);assert.equal(calls.length,4); // Stale successful checkpoints do not own discovery.
  for(const company of reviewedEarningsIssuers.filter(c=>!c.cik))fx.rows.set(`collectors/exchange-${company.companyId}`,{status:'complete',earningsCoverageVersion:2,lastSuccessAt:new Date(fx.now()).toISOString()});
  fx.rows.set('collectors/exchange-XSHE:301308',{status:'partial',lastSuccessAt:new Date(fx.now()).toISOString()});
  fx.advance(3600000);calls.length=0;await run(true);assert.deepEqual(calls,['XSHE:301308']);
});
test('public disclosure projection excludes operational timestamps and out-of-map companies',()=>{
  const rows=secDisclosureRows('US:MU','0000723125',payload).map(r=>({...r,collected_at:'secret-operation-time',processed_at:'secret-operation-time'}));
  const projected=projectDisclosures(rows,graph,new Date('2026-10-03T12:00:00Z'));
  assert.equal(projected.length,1);assert(!JSON.stringify(projected).includes('secret-operation-time'));
  assert.equal(projectDisclosures(rows,{...graph,nodes:[]},new Date('2026-10-03T12:00:00Z')).length,0);
  assert.equal(projectDisclosures(cnDisclosureRows('XSHE:000063','testorg',cn),graph,new Date('2026-10-03T12:00:00Z')).length,1);
});
test('legacy HTTP article links upgrade only for a reviewed issuer and never leave its allowlist',()=>{
  const mu=NEWS_SOURCES.find(s=>s.id==='mu-ir')!;
  assert.equal(approvedNewsUrl('http://investors.micron.com/news/results',mu,true),'https://investors.micron.com/news/results');
  assert.equal(approvedNewsUrl('http://evil.example/news/results',mu,true),null);
  assert.equal(approvedNewsUrl('http://investors.micron.com/news/results',{...mu,upgradeArticleHttp:false},true),null);
  const feed='<rss><channel><item><title>Results</title><link>http://investors.micron.com/news/results</link><pubDate>Wed, 30 Sep 2026 20:01:00 GMT</pubDate></item></channel></rss>';
  assert.equal(parseNewsFeed(feed,mu).items.length,1);
});
test('unresolved HTML articles remain retryable while dated originals are saved with date-only precision',async()=>{
  const source:NewsSource={id:'test',companyId:'US:MU',name:'Test',url:'https://investors.micron.com/news',allowedHosts:['investors.micron.com'],pollMs:3600000,format:'html',articlePathPattern:'^/news/2026/'};
  const response=await fetchNews(source,{},async(input)=>String(input).endsWith('/news')?new Response('<a href="/news/2026/good">Quarterly results</a><a href="/news/2026/bad">Unavailable article</a>',{headers:{etag:'do-not-cache-partial'}}):String(input).endsWith('/good')?new Response('<script type="application/ld+json">{"@type":"NewsArticle","headline":"Results","datePublished":"2026-09-30"}</script>'):new Response(null,{status:404}));
  assert.equal(response.status,'modified');
  if(response.status==='modified'){assert.equal(response.page.invalid,1);assert.equal(response.page.items.length,1);assert.equal(response.page.items[0].published_at,null);assert.deepEqual(response.validators,{});}
});
test('HTML news accepts only configured issuer article paths and original publication metadata',()=>{
  const source:NewsSource={id:'test',companyId:'US:MU',name:'Test',url:'https://investors.micron.com/news',allowedHosts:['investors.micron.com'],pollMs:3600000,format:'html',articlePathPattern:'^/news/press-release/2026/'};
  const html='<a href="/news/press-release/2026/results">Quarterly results</a><a href="https://evil.example/news/press-release/2026/x">Fake</a><a href="/privacy">Privacy</a>';
  assert.equal(parseHtmlNewsIndex(html,source).items.length,1);
  assert.equal(originalArticleMetadata('<script type="application/ld+json">{"@type":"NewsArticle","headline":"Results","datePublished":"2026-09-30","dateModified":"2026-10-03"}</script>').day,'2026-09-30');
  assert.equal(originalArticleMetadata('<script type="application/ld+json">{"@type":"NewsArticle","dateModified":"2026-10-03"}</script>').day,null);
});
