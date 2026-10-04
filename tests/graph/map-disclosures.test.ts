import test from 'node:test';
import assert from 'node:assert/strict';
import {mapListedCompanies,secDisclosureRows,cnDisclosureRows} from '../../src/lib/events/disclosures';
import {cnMapOrg,readCnMapDisclosures} from '../../src/lib/events/cn-disclosures';
import {originalArticleMetadata,parseHtmlNewsIndex} from '../../src/lib/intelligence/collectors/html-news';
import {approvedNewsUrl,parseNewsFeed,fetchNews} from '../../src/lib/intelligence/collectors/news';
import {NEWS_SOURCES,type NewsSource} from '../../src/lib/intelligence/collectors/sources';
import {projectDisclosures} from '../../src/lib/events/disclosure-projection';
import type {KnowledgeGraph} from '../../src/lib/knowledge-graph/model';
import {earningsFirestore} from '../helpers/earnings-firestore';
import {saveDisclosures} from '../../src/lib/events/disclosure-store';
import {createMapSecObserver} from '../../src/lib/events/sec-disclosures';
import {collectCnMapDisclosures} from '../../src/lib/events/cn-disclosures';
import {collectLiveEarnings} from '../../src/lib/earnings/live-collector';
import {earningsPilot} from '../../src/lib/earnings/pilot';
import type {MaintenanceLog} from '../../src/lib/maintenance-log';
const graph:KnowledgeGraph={asOf:'2026-10-03',nodes:[{id:'US:MU',market:'US',kind:'COMPANY',order:0},{id:'XSHE:000063',market:'CN_A',kind:'COMPANY',order:1},{id:'ORG:OPENAI',market:'GLOBAL',kind:'COMPANY',order:2}],relationships:[],sources:[]};
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
  const fx=earningsFirestore(),calls:string[]=[],log={runId:'handoff',emit:()=>{}} as unknown as MaintenanceLog;
  const run=(enabled:boolean)=>collectLiveEarnings(fx.db,log,{discoveryOwnedByMap:enabled,discoverCn:async id=>{calls.push(id);return [];},publish:async()=>{throw new Error('No queued sources');},now:fx.now,deadline:fx.now()+60000});
  await run(true);assert.equal(calls.length,4); // The enabled replacement has not initialized yet.
  for(const company of earningsPilot.filter(c=>!c.cik))fx.rows.set(`collectors/exchange-${company.companyId}`,{status:'complete',lastSuccessAt:new Date(fx.now()).toISOString()});
  calls.length=0;await run(true);assert.equal(calls.length,0);
  fx.advance(3600000);calls.length=0;await run(false);assert.equal(calls.length,4); // Disabled replacement never owns discovery.
  fx.advance(4*3600000);calls.length=0;await run(true);assert.equal(calls.length,4); // Stale successful checkpoints do not own discovery.
  for(const company of earningsPilot.filter(c=>!c.cik))fx.rows.set(`collectors/exchange-${company.companyId}`,{status:'complete',lastSuccessAt:new Date(fx.now()).toISOString()});
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
