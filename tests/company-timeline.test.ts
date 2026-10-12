import test from "node:test";
import assert from "node:assert/strict";
import { clusterTimelineEvents, companyTimelineEvents, intelligenceTimelineEvents, mapTimelinePrice, timelineDate, timelineWindow } from "../src/lib/ui/company-timeline";
import type { IntelligenceEvent } from "../src/lib/intelligence/model";
import type { KnowledgeGraph } from "../src/lib/knowledge-graph/model";

const graph: KnowledgeGraph = { asOf: "2026-10-11", nodes: [], sources: [{ id: "s", title: "Primary disclosure", url: "https://example.com/disclosure", sourceDate: "2026-04-10" }], relationships: [{ id: "r", source: "US:AMD", target: "US:NVDA", type: "PARTNER_OF", summary: "Evidence", commercialStatus: "ANNOUNCED", sourceIds: ["s"], publishedAt: "2026-09-20", researchReviewedAt: "2026-10-01", facts: [{ state: "ANNOUNCED", scope: "Planned partnership", sourceIds: ["s"], eventDate: "2027-01-01", reviewedAt: "2026-10-10" }] }] };
test("Explore timeline preserves grouped events, company/source filters and publication dates", () => {
  const event: IntelligenceEvent = { id: "release", origin: "US:AMD", companyIds: ["US:AMD"], edgeIds: [], category: "BUSINESS", title: "Original", titleEn: "English title", titleZh: "中文标题", summary: "Summary", published_at: null, publication_date: "2026-10-01", eventDate: "2027-01-01", planned: true, evidence: [{ id: "one", url: "https://example.com/one", title: "One", sourceDate: "2026-09-30", channel: "IR" }, { id: "two", url: "https://example.com/two", title: "Two", sourceDate: "2026-10-02", channel: "SEC" }] };
  const result = intelligenceTimelineEvents("US:AMD", [event]);
  assert.equal(result.length, 1);
  assert.equal(result[0].date, "2026-10-01");
  assert.equal(result[0].title, "English title");
  assert.equal(result[0].category, "business");
  assert.equal(intelligenceTimelineEvents("US:AMD", [{ ...event, category: "FILING" }])[0].category, "filing");
  assert.equal(intelligenceTimelineEvents("US:AMD", [event], true)[0].title, "中文标题");
  assert.equal(intelligenceTimelineEvents("US:AMD", [event], false, "SEC")[0].sourceUrl, "https://example.com/two");
  assert.equal(intelligenceTimelineEvents("US:AMD", [event], false, "Exchange").length, 0);
  assert.equal(intelligenceTimelineEvents("US:NVDA", [event]).length, 0);
  assert.equal(intelligenceTimelineEvents("US:AMD", [{ ...event, publication_date: "" }]).length, 0);
});
test("timeline anchors disclosure to publication, never review or planned effective dates", () => {
  const events = companyTimelineEvents("US:AMD", graph, []);
  assert.equal(events.length, 1); assert.equal(events[0].date, "2026-04-10"); assert.equal(events[0].planned, true);
  assert.equal(companyTimelineEvents("US:META", graph, []).length, 0);
  assert.equal(companyTimelineEvents("US:AMD", { ...graph, sources: [{ ...graph.sources[0], sourceDate: null }] }, []).length, 0);
});
test("price history isolates markets and distinguishes missing volume from zero", () => {
  const row = { ticker: "AMD", market: "US", tradingDate: "2026-10-09", close: 120, volume: 0 };
  assert.equal(mapTimelinePrice(row, "AMD", "US")?.volume, 0);
  assert.equal(mapTimelinePrice({ ...row, volume: null }, "AMD", "US")?.volume, null);
  assert.equal(mapTimelinePrice(row, "AMD", "CN_A"), null);
  assert.equal(mapTimelinePrice({ ...row, close: NaN }, "AMD", "US"), null);
  assert.equal(timelineDate("2026-02-30"), null);
});
test("Chinese relationship events use localized source titles and summaries with English fallback", () => {
  const localized = { ...graph, sources: [{ ...graph.sources[0], titleZh: "原始公告" }], relationships: [{ ...graph.relationships[0], summaryZh: "计划合作" }] };
  const event = companyTimelineEvents("US:AMD", localized, [], true)[0];
  assert.equal(event.title, "原始公告"); assert.equal(event.sourceTitle, "原始公告"); assert.equal(event.description, "计划合作");
  assert.equal(companyTimelineEvents("US:AMD", graph, [], true)[0].description, "Planned partnership");
  assert.equal(companyTimelineEvents("US:AMD", localized, [])[0].title, "Primary disclosure");
});
test("clustering preserves lane and true date anchors, with bounded density", () => {
  const event = companyTimelineEvents("US:AMD", graph, [])[0];
  const events = [0, 1, 2, 3].map(i => ({ ...event, id: String(i), date: `2026-04-${10 + i}` }));
  const groups = clusterTimelineEvents(events, "2026-04-01", "2026-04-30", 290, 25);
  assert.equal(groups.length, 2); assert.equal(groups[0].events.length, 3); assert.equal(groups[0].events[0].date, "2026-04-10");
  assert.equal(clusterTimelineEvents([...events, { ...events[0], id: "business", lane: "business" }], "2026-04-01", "2026-04-30", 290, 25).length, 3);
  const overlay = clusterTimelineEvents([{ ...events[0], id: "business", lane: "business" }, ...events.toReversed()], "2026-04-01", "2026-04-30", 290, 25, false);
  assert.equal(overlay.length, 2); assert.equal(overlay[0].events.length, 4);
  assert.equal(overlay[0].events[0].date, "2026-04-10");
  assert.equal(timelineWindow(180, "2026-10-09").end, "2026-10-09");
});
import {layoutTimelineMarkers} from '../src/lib/ui/company-timeline';
test('dated marker band groups matching symbols without dropping events',()=>{
 const event=companyTimelineEvents('US:AMD',graph,[])[0];
 const groups=layoutTimelineMarkers(Array.from({length:20},(_,i)=>({...event,id:String(i),date:'2026-04-10'})),'2026-04-01','2026-04-30',290);
 assert.equal(groups.length,1);assert.equal(groups[0].x,90);assert.equal(groups[0].events.length,20);
});
test('different categories and insider directions stay separate at their actual dates',()=>{
 const event=companyTimelineEvents('US:AMD',graph,[])[0];
 const entries=[
  {...event,id:'earnings',date:'2026-04-10',eventType:'earnings' as const},
  {...event,id:'buy',date:'2026-04-10',eventType:'insider_trade' as const,eventSubtype:'insider_buy'},
  {...event,id:'sell',date:'2026-04-11',eventType:'insider_trade' as const,eventSubtype:'insider_sell'},
  {...event,id:'business',date:'2026-04-11',eventType:'product_business' as const},
 ];
 const groups=layoutTimelineMarkers(entries,'2026-04-01','2026-04-30',290);
 assert.equal(groups.length,4);
 assert.equal(new Set(groups.map(group=>group.level)).size,4);
 for(const group of groups)assert.equal(group.x,group.events[0].date==='2026-04-10'?90:100);
});
test('matching symbols on nearby different dates never combine',()=>{
 const event=companyTimelineEvents('US:AMD',graph,[])[0];
 const entries=[10,11,12].map(day=>({...event,id:String(day),date:`2026-04-${day}`}));
 const groups=layoutTimelineMarkers(entries,'2026-04-01','2026-04-30',290);
 assert.deepEqual(groups.map(group=>group.x),[90,100,110]);
 assert.ok(groups.every(group=>group.events.length===1));
 assert.deepEqual(groups.map(group=>group.level),[0,1,2]);
});

test('overlay markers stay in the price plot, avoid a sparse curve and retain exact dates',async()=>{
 const {layoutOverlayMarkers}=await import('../src/lib/ui/company-timeline');
 const events=Array.from({length:3},(_,i)=>({id:`overlay-${i}`,date:`2026-09-${String(5+i*10).padStart(2,'0')}`,title:'Event',description:'',lane:'business' as const,eventType:'product_business' as const,sourceUrl:'https://example.com',sourceTitle:'Source',planned:false}));
 const result=layoutOverlayMarkers(events,'2026-09-01','2026-10-01',300,24,140,[{x:0,y:82},{x:300,y:82}]);
 assert.equal(result.length,3);
 for(const group of result){assert.ok(group.y-group.size/2>=24);assert.ok(group.y+group.size/2<=140);assert.ok(Math.abs(group.y-82)>group.size/2+6);assert.equal(group.x,(Date.parse(group.events[0].date)-Date.parse('2026-09-01'))/86400000*10);}
});
test('crowded dates use a mixed-symbol chooser without combining dates or losing events',async()=>{
 const {layoutOverlayMarkers}=await import('../src/lib/ui/company-timeline');
 const types=['earnings','insider_trade','relationship','product_business','corporate_action','financing','regulatory_governance','other'] as const;
 const events=types.flatMap((eventType,i)=>[1,2].map(day=>({id:`dense-${day}-${i}`,date:`2026-09-0${day}`,title:'Event',description:'',lane:'business' as const,eventType,sourceUrl:'https://example.com',sourceTitle:'Source',planned:false})));
 const result=layoutOverlayMarkers(events,'2026-09-01','2026-10-01',277,24,164,[],34);
 assert.deepEqual(result.flatMap(g=>g.events.map(e=>e.id)).sort(),events.map(e=>e.id).sort());
 for(const group of result){assert.equal(new Set(group.events.map(e=>e.date)).size,1);assert.ok(group.y-group.size/2>=24);assert.ok(group.y+group.size/2<=164);}
 for(let i=0;i<result.length;i++)for(let j=i+1;j<result.length;j++)assert.ok(Math.hypot(result[i].x-result[j].x,result[i].y-result[j].y)>=(result[i].size+result[j].size)/2);
});
