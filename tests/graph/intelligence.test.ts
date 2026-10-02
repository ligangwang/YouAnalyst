import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalEvidenceUrl, intelligenceSession, observation, sourceChannel, summarizeIntelligence } from '../../src/lib/intelligence/model';
import { mergeIntelligenceEvents, projectResearchIntelligence } from '../../src/lib/intelligence/project';
import { projectSecIntelligence } from '../../src/lib/intelligence/sec-events';
import { createSecFilingDiscovered } from '../../src/lib/sec-filings/event';
import { firstIntelligenceObservation } from '../../src/lib/sec-filings/store';
import type { KnowledgeGraph } from '../../src/lib/knowledge-graph/model';

const now=new Date('2026-10-02T16:00:00Z');
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
  assert.equal(events[0].observedDate,'2026-10-01');
  assert.equal(events[0].observedAt,null);
  assert.equal(summarizeIntelligence(events,['US:AMD'],'').signals,1);
  assert.equal(summarizeIntelligence(events,['US:AMD'],'',now.getTime()).signals,0);
  assert.equal(summarizeIntelligence(events,['US:AMD'],'SEC').events.length,0);
});

const discovery=(companyId='AMD')=>createSecFilingDiscovered({companyId,cik:'0000002488',accessionNumber:'0000002488-26-000018',form:'10-K',filingDate:'2026-02-25',primaryDocument:'amd-20251231.htm',isXbrl:true,discoveredAt:'2026-10-02T15:05:30Z'});
test('filing and graph citation deduplicate without losing documented paths or changing arrival time',()=>{
  const event=discovery();
  const filings=projectSecIntelligence([{id:event.accessionNumber,data:{discoveryEvents:{[event.eventId]:{event,state:'published'}}}}],graph,now);
  const research={...projectResearchIntelligence(graph,[],now)[0],evidence:filings[0].evidence};
  const merged=mergeIntelligenceEvents(filings,[research]);
  assert.equal(merged.length,1);
  assert.deepEqual(merged[0].edgeIds,['amd-mu','amd-nvda']);
  assert.equal(merged[0].observedAt,event.discoveredAt);
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
  assert.equal(projected[0].observedDate,'2026-10-02');
  assert.equal(projected[0].eventDate,'2026-02-25');
  assert.deepEqual(projected[0].edgeIds,[]);
  assert.equal(summarizeIntelligence(projected,['US:AMD'],'SEC',Date.parse('2026-10-02T15:05:00Z')).signals,0);
  assert.equal(summarizeIntelligence(projected,['US:AMD'],'SEC',Date.parse('2026-10-02T15:06:00Z')).signals,1);
});

test('invalid identities, baseline documents and future observations never become live events',()=>{
  const event=discovery();
  assert.equal(projectSecIntelligence([{id:event.accessionNumber,data:{discoveryEvents:{bad:{event,state:'published'}}}}],graph,now).length,0);
  assert.equal(projectSecIntelligence([{id:event.accessionNumber,data:{discoveryEvents:{[event.eventId]:{event,state:'baseline'}}}}],graph,now).length,0);
  assert.equal(projectSecIntelligence([{id:event.accessionNumber,data:{discoveryEvents:{[event.eventId]:{event,state:'pending'}}}}],graph,new Date('2026-10-02T15:00:00Z')).length,0);
});
