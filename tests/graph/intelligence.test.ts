import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalEvidenceUrl, intelligenceSession, observation, secCollectorIsFresh, sourceChannel, summarizeIntelligence, sourceDocumentsForEvents, intelligenceEventMatchesId, type IntelligenceEvent } from '../../src/lib/intelligence/model';
import { mergeIntelligenceEvents, projectResearchIntelligence } from '../../src/lib/intelligence/project';
import { projectSecIntelligence } from '../../src/lib/intelligence/sec-events';
import { createSecFilingDiscovered } from '../../src/lib/sec-filings/event';
import { firstIntelligenceObservation } from '../../src/lib/sec-filings/store';
import {companySearchRank, type KnowledgeGraph} from '../../src/lib/knowledge-graph/model';

const now=new Date('2026-10-02T16:00:00Z');
const announcement=(id:string,url:string):IntelligenceEvent=>({id:`news-company_news_${id}`,origin:'US:AMD',companyIds:['US:AMD'],edgeIds:[],category:'BUSINESS',title:'AMD to Report Fiscal Third Quarter 2026 Financial Results',summary:'Official company news. Open the source for details.',published_at:'2026-10-06T20:15:00.000Z',publication_date:'2026-10-06',eventDate:'2026-10-06',evidence:[{id:`company_news_${id}`,url,title:'AMD to Report Fiscal Third Quarter 2026 Financial Results',sourceDate:'2026-10-06',channel:'IR'}],planned:false});

test('matching official announcements become one event with two source documents and stable old links',()=>{
  const ir=announcement('ir','https://ir.amd.com/release');
  const newsroom={...announcement('newsroom','https://newsroom.amd.com/release'),published_at:'2026-10-06T00:00:00.000Z',publication_date:'2026-10-05',title:' AMD to Report Fiscal Third Quarter 2026  Financial Results '};
  const input=structuredClone([ir,newsroom]);
  const [grouped]=mergeIntelligenceEvents(input,[]);
  assert.equal(mergeIntelligenceEvents(input,[]).length,1);
  assert.equal(grouped.evidence.length,2);assert.equal(grouped.published_at,ir.published_at);assert.equal(grouped.publication_date,'2026-10-06');
  assert.equal(summarizeIntelligence([grouped],['US:AMD'],'').signals,2);
  assert.equal(sourceDocumentsForEvents([grouped]).length,2);
  assert(intelligenceEventMatchesId(grouped,ir.id));assert(intelligenceEventMatchesId(grouped,newsroom.id));
  const reversed=mergeIntelligenceEvents([newsroom,ir],[])[0];assert.equal(reversed.id,grouped.id);assert.equal(reversed.published_at,grouped.published_at);
  assert.deepEqual(input,[ir,newsroom]);
});

test('announcement grouping leaves generic, conflicting, translated-only and other-company records separate',()=>{
  const a=announcement('a','https://ir.amd.com/a'),b=announcement('b','https://newsroom.amd.com/b');
  for(const changed of [
    {...b,origin:'US:MU',companyIds:['US:MU']},
    {...b,evidence:[{...b.evidence[0],sourceDate:'2026-10-07'}]},
    {...b,eventDate:'2026-11-03'},
    {...b,planned:true},
    {...b,title:'AMD to Report Fiscal Fourth Quarter 2026 Financial Results',titleEn:a.title},
    {...b,category:'FILING' as const},
    {...b,published_at:'2026-10-09T20:15:00.000Z'},
    {...b,evidence:[{...b.evidence[0],sourceDate:null}]},
  ])assert.equal(mergeIntelligenceEvents([a,changed],[]).length,2);
  assert.equal(mergeIntelligenceEvents([{...a,title:'Company update'},{...b,title:'Company update'}],[]).length,2);
  const generic='AMD General Business Update for Shareholders and Investors';
  assert.equal(mergeIntelligenceEvents([{...a,title:generic},{...b,title:generic}],[]).length,2);
  assert.equal(mergeIntelligenceEvents([{...a,summary:'Results will be published November 3.'},{...b,summary:'Results will be published November 4.'}],[]).length,2);
  assert.equal(mergeIntelligenceEvents([{...a,calendarEvents:[{id:'one',companyId:'US:AMD',day:'2026-11-03'}]},{...b,calendarEvents:[{id:'two',companyId:'US:AMD',day:'2026-11-04'}]}],[]).length,2);
});

test('a publisher date without an invented time wins over an inconsistent midnight timestamp',()=>{
  const dated={...announcement('dated','https://ir.amd.com/dated'),published_at:null};
  const alias={...announcement('alias','https://newsroom.amd.com/alias'),published_at:'2026-10-06T00:00:00.000Z',publication_date:'2026-10-05'};
  const grouped=mergeIntelligenceEvents([alias,dated],[])[0];
  assert.equal(grouped.publication_date,'2026-10-06');assert.equal(grouped.published_at,null);
});

test('grouped announcements retain translations, documented paths, distinct calendar links and canonical source identity',()=>{
  const a={...announcement('a','https://ir.amd.com/release?utm_source=ir'),titleZh:'AMD将公布财务业绩',edgeIds:['relationship-a'],calendarEvents:[{id:'call',companyId:'US:AMD',day:'2026-11-03'}]};
  const b={...announcement('b','https://newsroom.amd.com/release'),edgeIds:['relationship-b'],summary:'Results will be published November 3.',calendarEvents:[{id:'call',companyId:'US:AMD',day:'2026-11-03'},{id:'release',companyId:'US:AMD',day:'2026-11-03'}]};
  const c=announcement('c','https://ir.amd.com/release?utm_source=news');
  const [grouped]=mergeIntelligenceEvents([a,b,c],[]);
  assert.equal(grouped.evidence.length,2);assert.equal(grouped.titleZh,a.titleZh);assert.equal(grouped.summary,b.summary);
  assert.deepEqual(new Set(grouped.edgeIds),new Set(['relationship-a','relationship-b']));
  assert.deepEqual(grouped.calendarEvents?.map(link=>link.id),['call','release']);
});
test('exact ticker search ranks above business-description and partial name matches',()=>{
  const names=[{id:'US:LITE',symbol:'LITE',name:'Lumentum'},{id:'US:MU',symbol:'MU',name:'Micron Technology'},{id:'US:MULT',symbol:'MULT',name:'Other'}].map((node,order)=>({...node,kind:'COMPANY' as const,order}));
  assert.equal([...names].sort((a,b)=>companySearchRank(a,'MU')-companySearchRank(b,'MU'))[0].symbol,'MU');
  assert.equal(companySearchRank(names[1],'$ＭＵ'),0);
  assert.equal(companySearchRank(names[1],'US:MU'),0);
});
test('a recent SEC run is fresh only when collection and publication completed without failure',()=>{
  const complete={failed:0,partial:0,remaining:0,outboxIncomplete:false};
  assert.equal(secCollectorIsFresh(now.toISOString(),complete,now),true);
  for(const field of ['failed','partial','remaining'])assert.equal(secCollectorIsFresh(now.toISOString(),{...complete,[field]:1},now),false);
  assert.equal(secCollectorIsFresh(now.toISOString(),{...complete,outboxIncomplete:true},now),false);
  assert.equal(secCollectorIsFresh(now.toISOString(),undefined,now),false);
  assert.equal(secCollectorIsFresh('2026-10-02T12:00:00Z',complete,now),false);
  assert.equal(secCollectorIsFresh('2026-10-02T17:00:00Z',complete,now),false);
});
const graph:KnowledgeGraph={asOf:'2026-10-01',nodes:['AMD','MU','NVDA'].map((symbol,order)=>({id:`US:${symbol}`,kind:'COMPANY',symbol,name:symbol,order})),sources:[{id:'release',title:'AMD release',url:'https://ir.amd.com/release?utm_source=test#details',sourceDate:'2026-09-01'}],relationships:[{id:'amd-mu',source:'US:AMD',target:'US:MU',type:'SUPPLIER_OF',summary:'Memory supply evidence',sourceIds:['release'],commercialStatus:'DOCUMENTED',publishedAt:'2026-09-01T12:00:00Z',researchReviewedAt:'2026-10-01'},{id:'amd-nvda',source:'US:AMD',target:'US:NVDA',type:'COMPETES_WITH',summary:'Comparison evidence',sourceIds:['release'],commercialStatus:'DOCUMENTED',researchReviewedAt:'2026-10-01'}]};

test('intraday boundaries follow Eastern DST rather than a fixed UTC offset',()=>{
  const spring=intelligenceSession(new Date('2026-03-08T16:00:00Z'));
  assert.equal(spring.startAt,'2026-03-08T05:00:00.000Z');
  assert.equal(Date.parse(spring.endAt)-Date.parse(spring.startAt),23*3_600_000);
  const fall=intelligenceSession(new Date('2026-11-01T16:00:00Z'));
  assert.equal(Date.parse(fall.endAt)-Date.parse(fall.startAt),25*3_600_000);
  assert.equal(intelligenceSession(new Date('2026-10-02T02:00:00Z')).date,'2026-10-01');
});

test('date-only observations have no invented replay time',()=>{
  assert.deepEqual(observation('2026-10-01'),{at:null,day:'2026-10-01'});
  assert.deepEqual(observation('2026-10-02T02:00:00Z'),{at:'2026-10-02T02:00:00.000Z',day:'2026-10-01'});
  assert.equal(observation('2026-02-30'),null);
  assert.equal(observation('2026-10-02T12:00:00'),null);
  assert.equal(observation('2026-02-30T12:00:00Z'),null);
  assert.equal(observation('2026-10-02T24:00:00Z'),null);
});

test('canonical source identity removes tracking, preserves substantive queries, and rejects unsafe evidence',()=>{
  assert.equal(canonicalEvidenceUrl('https://ir.amd.com/release?doc=1&utm_campaign=ad#x'),'https://ir.amd.com/release?doc=1');
  assert.equal(canonicalEvidenceUrl('http://ir.amd.com/release'),null);
  assert.equal(canonicalEvidenceUrl('https://user:secret@example.com'),null);
  assert.equal(sourceChannel('https://www.sec.gov/Archives'),'SEC');
  assert.equal(sourceChannel('https://sec.gov.attacker.example/Archives'),'Other');
});

test('one document cited by multiple graph edges yields one signal without inventing relationships',()=>{
  const events=projectResearchIntelligence(graph,[],now);
  assert.equal(events.length,1);
  assert.deepEqual(new Set(events[0].companyIds),new Set(['US:AMD','US:MU','US:NVDA']));
  assert.deepEqual(events[0].edgeIds,['amd-mu','amd-nvda']);
  assert.equal(events[0].evidence[0].sourceDate,'2026-09-01');
  assert.equal(events[0].publication_date,'2026-09-01');
  assert.equal(events[0].published_at,null);
  assert.equal(summarizeIntelligence(events,['US:AMD'],'').signals,1);
  assert.equal(summarizeIntelligence(events,['US:AMD'],'',now.getTime()).signals,0);
  assert.equal(summarizeIntelligence(events,['US:AMD'],'SEC').events.length,0);
});

const discovery=(companyId='AMD')=>createSecFilingDiscovered({companyId,cik:'0000002488',accessionNumber:'0000002488-26-000018',form:'10-K',filingDate:'2026-02-25',primaryDocument:'amd-20251231.htm',isXbrl:true,published_at:'2026-10-02T15:04:00Z',discoveredAt:'2026-10-02T15:05:30Z'});
test('filing and graph citation deduplicate without losing documented paths or changing arrival time',()=>{
  const event=discovery();
  const filings=projectSecIntelligence([{id:event.accessionNumber,data:{discoveryEvents:{[event.eventId]:{event,state:'published'}}}}],graph,now);
  const research={...projectResearchIntelligence(graph,[],now)[0],evidence:filings[0].evidence};
  const merged=mergeIntelligenceEvents(filings,[research]);
  assert.equal(merged.length,1);
  assert.deepEqual(merged[0].edgeIds,['amd-mu','amd-nvda']);
  assert.equal(merged[0].published_at,event.published_at);
  assert.equal(summarizeIntelligence(merged,['US:AMD'],'').signals,1);
});
test('SEC baseline history is excluded; retries and cross-listings do not inflate activity',()=>{
  const event=discovery(),other=discovery('MU');
  assert.equal(firstIntelligenceObservation({[event.eventId]:{event,state:'baseline'}}),null);
  const records={[event.eventId]:{event,state:'published' as const},[other.eventId]:{event:other,state:'pending' as const}};
  assert.equal(firstIntelligenceObservation(records),event.discoveredAt);
  const projected=projectSecIntelligence([{id:event.accessionNumber,data:{discoveryEvents:records}}],graph,now);
  assert.equal(projected.length,1);
  assert.equal(projected[0].evidence.length,1);
  assert.equal(projected[0].publication_date,'2026-10-02');
  assert.equal(projected[0].eventDate,'2026-02-25');
  assert.deepEqual(projected[0].edgeIds,[]);
  assert.equal(summarizeIntelligence(projected,['US:AMD'],'SEC',Date.parse('2026-10-02T15:03:00Z')).signals,0);
  assert.equal(summarizeIntelligence(projected,['US:AMD'],'SEC',Date.parse('2026-10-02T15:06:00Z')).signals,1);
});

test('invalid identities, baseline documents and future observations never become live events',()=>{
  const event=discovery();
  assert.equal(projectSecIntelligence([{id:event.accessionNumber,data:{discoveryEvents:{bad:{event,state:'published'}}}}],graph,now).length,0);
  assert.equal(projectSecIntelligence([{id:event.accessionNumber,data:{discoveryEvents:{[event.eventId]:{event,state:'baseline'}}}}],graph,now).length,1);
  assert.equal(projectSecIntelligence([{id:event.accessionNumber,data:{discoveryEvents:{[event.eventId]:{event,state:'pending'}}}}],graph,new Date('2026-10-02T15:00:00Z')).length,0);
});
