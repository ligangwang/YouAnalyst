import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichIntelligenceSnapshot} from '../../src/lib/intelligence/enrichment-model';
import {intelligenceSession,sourceDocumentsForEvents,type IntelligenceEvent,type IntelligenceSnapshot} from '../../src/lib/intelligence/model';

const event=(id:string):IntelligenceEvent=>({id:`news-company_news_${id}`,origin:'US:AMD',companyIds:['US:AMD'],edgeIds:[],category:'BUSINESS',title:'AMD announces quarterly financial results and earnings conference call',summary:'',published_at:null,publication_date:'2026-10-02',eventDate:null,planned:false,evidence:[{id,url:`https://ir.amd.com/${id}`,title:'Results',channel:'IR',sourceDate:'2026-10-02'}],calendarPending:true});
function snapshot():IntelligenceSnapshot{
 const events=[event('a'),event('b')],now=new Date('2026-10-02T16:00:00Z');
 return {theme:'ai',events,sourceDocuments:sourceDocumentsForEvents(events),graph:{nodes:[{id:'US:AMD',kind:'COMPANY',order:0},{id:'US:MU',kind:'COMPANY',order:1}],relationships:[],sources:[],asOf:'2026-10-02'},graphVersion:'one',generatedAt:now.toISOString(),session:intelligenceSession(now),coverage:[],warnings:[],truncated:false,limit:200,enrichmentDeferred:true};
}
test('calendar enrichment waits for confirmation before grouping and preserves source totals and base',()=>{
 const base=snapshot(),original=structuredClone(base),[a,b]=base.events.map(event=>event.id);
 assert.equal(enrichIntelligenceSnapshot(base,{snapshotAt:base.generatedAt,calendar:{[a]:[]}}).events.length,2);
 const combined=enrichIntelligenceSnapshot(base,{snapshotAt:base.generatedAt,calendar:{[a]:[],[b]:[]}});
 assert.equal(combined.events.length,1);assert.equal(combined.events[0].calendarPending,false);
 assert.deepEqual(combined.sourceDocuments,base.sourceDocuments);assert.deepEqual(base,original);
 const separate=enrichIntelligenceSnapshot(base,{snapshotAt:base.generatedAt,calendar:{[a]:[{id:'one',companyId:'US:AMD',day:'2026-10-10'}],[b]:[{id:'two',companyId:'US:AMD',day:'2026-10-11'}]}});
 assert.equal(separate.events.length,2,'different scheduled events must remain separate');
});
test('stale patches are ignored and price updates preserve unrelated nodes',()=>{
 const base=snapshot();assert.equal(enrichIntelligenceSnapshot(base,{snapshotAt:'old',prices:{'US:AMD':null}}),base);
 const next=enrichIntelligenceSnapshot(base,{snapshotAt:base.generatedAt,prices:{'US:AMD':null}});
 assert.equal(next.graph.nodes[1],base.graph.nodes[1]);assert.equal(next.events.length,2);
});
