import { chartShareUrl, parseSharedChart, sharedChartParams, type SharedChart } from '../src/lib/ui/chart-share';
import test from "node:test";
import assert from "node:assert/strict";
import { adjacentTimelineBars, timelinePriceBars, weeklyTimelinePrices, timelineWeek, tradingSessionAxis, clusterTimelineEvents, companyTimelineEvents, intelligenceTimelineEvents, mapTimelinePrice, timelineDate, timelineWindow } from "../src/lib/ui/company-timeline";
import type { IntelligenceEvent } from "../src/lib/intelligence/model";
import type { KnowledgeGraph } from "../src/lib/knowledge-graph/model";
import { simpleMovingAverage, movingAverageConvergence } from '../src/lib/ui/technical-indicators';
import {cachedTimelinePrices} from '../src/lib/ui/timeline-cache';

test('YTD and annual windows use calendar boundaries, including leap days',()=>{
 assert.deepEqual(timelineWindow('ytd','2026-10-12'),{start:'2026-01-01',end:'2026-10-12'});
 assert.equal(timelineWindow('ytd','2026-01-01').start,'2026-01-01');
 assert.equal(timelineWindow(1826,'2026-10-12').start,'2021-10-12');
 assert.equal(timelineWindow(365,'2024-02-29').start,'2023-02-28');
});

test('weekly bars retain true OHLC, summed volume, partial holiday weeks and missing values',()=>{
 const rows=[{date:'2026-09-28',open:10,high:15,low:9,close:12,volume:100},{date:'2026-09-30',open:12,high:14,low:8,close:11,volume:200},{date:'2026-10-09',open:11,high:13,low:10,close:12,volume:null}];
 assert.deepEqual(weeklyTimelinePrices(rows),[{date:'2026-09-30',periodStart:'2026-09-28',open:10,high:15,low:8,close:11,volume:300},{date:'2026-10-09',periodStart:'2026-10-09',open:11,high:13,low:10,close:12,volume:null}]);
 assert.deepEqual(weeklyTimelinePrices([{date:'2026-10-01',close:11,volume:0}]),[{date:'2026-10-01',periodStart:'2026-10-01',close:11,volume:0}]);
 assert.equal(timelineWeek('2026-10-04'),'2026-09-28');
});

test('weekly event grouping retains individual publication dates and separates following weeks',()=>{
 const dates=['2026-09-28','2026-09-30','2026-10-05'];
 const events=dates.map((date,index)=>({id:String(index),date,title:'Business update',description:'',lane:'business' as const,eventType:'product_business' as const,eventSubtype:'business_update',sourceUrl:'https://example.com/'+index,sourceTitle:'Original',planned:false}));
 const weekly=layoutTimelineMarkers(events,'2026-09-01','2026-10-12',500,36,undefined,timelineWeek);
 assert.deepEqual(weekly.map(group=>group.events.map(event=>event.date)),[dates.slice(0,2),dates.slice(2)]);
 assert.equal(layoutTimelineMarkers(events,'2026-09-01','2026-10-12',500).length,3);
});

test('timeline cache shares pending reads, expires, separates revisions and retries failures',async()=>{
 let calls=0;const data={companyId:'US:TEST',start:'2021-01-01',end:'2026-01-01',prices:[],currency:'USD',available:true};
 const load=async()=>{calls++;return data;};
 await Promise.all([cachedTimelinePrices('test-revision-1',load,0),cachedTimelinePrices('test-revision-1',load,1)]);assert.equal(calls,1);
 await cachedTimelinePrices('test-revision-1',load,60_001);assert.equal(calls,2);
 await cachedTimelinePrices('test-revision-2',load,60_002);assert.equal(calls,3);
 await assert.rejects(cachedTimelinePrices('test-failure',async()=>{throw Error('read failed');},0));
 await cachedTimelinePrices('test-failure',load,1);assert.equal(calls,4);
});

test('moving averages use full preceding sessions without future closes or fabricated warmup',()=>{
  const prices=Array.from({length:80},(_,index)=>({date:new Date(Date.UTC(2026,5,1+index)).toISOString().slice(0,10),close:index+1,volume:0}));
  const average=simpleMovingAverage(prices,60);
  assert.equal(average[0].date,prices[59].date);assert.equal(average[0].value,30.5);
  assert.equal(average.at(-1)!.value,50.5);
  assert.deepEqual(simpleMovingAverage(prices.slice(0,59),60),[]);
  assert.deepEqual(simpleMovingAverage(prices.slice(0,65),60),average.slice(0,6));
});
test('MACD uses 12/26/9 EMA with complete signal warmup and no lookahead',()=>{
  const prices=Array.from({length:80},(_,index)=>({date:new Date(Date.UTC(2026,5,1+index)).toISOString().slice(0,10),close:index+1,volume:0}));
  const macd=movingAverageConvergence(prices);
  assert.deepEqual(movingAverageConvergence(prices.slice(0,33)),[]);
  assert.equal(macd[0].date,prices[33].date);
  for(const point of macd){assert.ok(Math.abs(point.dif-7)<1e-10);assert.ok(Math.abs(point.signal-7)<1e-10);assert.ok(Math.abs(point.histogram)<1e-10);}
  const varied=prices.map((price,index)=>({...price,close:100+Math.sin(index)*5+index*.2}));
  assert.deepEqual(movingAverageConvergence(varied.slice(0,50)),movingAverageConvergence(varied).filter(point=>point.date<=varied[49].date));
  const step=prices.map((price,index)=>({...price,close:index<40?100:110}));
  const firstStep=movingAverageConvergence(step).find(point=>point.date===step[40].date)!;
  const expectedDif=10*(2/13-2/27);
  assert.ok(Math.abs(firstStep.dif-expectedDif)<1e-10);
  assert.ok(Math.abs(firstStep.signal-expectedDif*.2)<1e-10);
  assert.ok(Math.abs(firstStep.histogram-expectedDif*.8)<1e-10);
});

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

test('OHLC uses the existing adjusted close basis without mixing raw prices',()=>{
 const row={ticker:'AMD',market:'US',tradingDate:'2026-10-09',open:100,high:120,low:90,rawClose:110,close:55,source:'eodhd-bulk-eod',volume:0};
 const bar=mapTimelinePrice(row,'AMD','US');assert.equal(bar?.open,50);assert.equal(bar?.high,60);assert.equal(bar?.low,45);assert.equal(bar?.close,55);
 assert.equal(mapTimelinePrice({...row,rawClose:undefined},'AMD','US')?.open,undefined);
 assert.equal(mapTimelinePrice({...row,source:'eodhd-eod',rawClose:undefined,close:105},'AMD','US')?.open,undefined);
 assert.equal(mapTimelinePrice({...row,source:'eodhd-eod'},'AMD','US')?.open,50);
 assert.equal(mapTimelinePrice({...row,high:80},'AMD','US')?.open,undefined);
 assert.equal(mapTimelinePrice({...row,low:NaN},'AMD','US')?.open,undefined);
 assert.equal(mapTimelinePrice({...row,open:undefined},'AMD','US')?.open,undefined);
});


test('trading sessions remove weekend and holiday widths while preserving publication dates',()=>{
 const dates=['2026-09-25','2026-09-28','2026-09-29','2026-09-30','2026-10-08'];
 const axis=tradingSessionAxis(dates,'2026-09-11','2026-10-11');
 for(let i=1;i<dates.length;i++)assert.ok(Math.abs(axis.ratio(dates[i])-axis.ratio(dates[i-1])-.2)<1e-10);
 assert.ok(axis.ratio('2026-09-26')>axis.ratio('2026-09-25'));
 assert.ok(axis.ratio('2026-09-27')<axis.ratio('2026-09-28'));
 assert.ok(axis.ratio('2026-10-02')>axis.ratio('2026-09-30'));
 assert.ok(axis.ratio('2026-10-02')<axis.ratio('2026-10-08'));
 assert.ok(axis.ratio('2026-10-03')>axis.ratio('2026-10-02'));
 assert.equal(axis.dateAt(axis.ratio('2026-10-08')),'2026-10-08');
 assert.equal(axis.dateAt(0),'2026-09-25');assert.equal(axis.dateAt(1),'2026-10-08');
 const events=['2026-10-02','2026-10-03'].map((date,i)=>({id:String(i),date,title:'Business',description:'',lane:'business' as const,sourceUrl:'https://example.com',sourceTitle:'Source',planned:false}));
 const markers=layoutTimelineMarkers(events,'2026-09-11','2026-10-11',600,36,date=>axis.ratio(date)*600);
 assert.equal(markers.length,2);assert.ok(markers[1].x>markers[0].x);
 assert.deepEqual(markers.map(marker=>marker.events[0].date),['2026-10-02','2026-10-03']);
});

test('session axis handles missing, single and unordered stored prices without inventing bars',()=>{
 const none=tradingSessionAxis([],'2026-10-01','2026-10-11');assert.equal(none.ratio('2026-10-06'),.5);assert.equal(none.dateAt(.5),'2026-10-06');
 const single=tradingSessionAxis(['2026-10-08'],'2026-10-01','2026-10-11');assert.equal(single.ratio('2026-10-08'),.5);assert.equal(single.dateAt(0),'2026-10-08');assert.equal(single.dateAt(1),'2026-10-08');assert.ok(single.ratio('2026-10-05')<.5);assert.ok(single.ratio('2026-10-10')>.5);
 assert.deepEqual(tradingSessionAxis(['2026-10-09','2026-10-08','2026-10-08','2026-09-30'],'2026-10-01','2026-10-11').sessions,['2026-10-08','2026-10-09']);
});


test('event symbols clear full candle wicks and bodies while retaining date columns',async()=>{
 const {layoutOverlayMarkers}=await import('../src/lib/ui/company-timeline');
 const events=['2026-09-10','2026-09-20'].map((date,i)=>({id:String(i),date,title:'Event',description:'',lane:'business' as const,eventType:'product_business' as const,sourceUrl:'https://example.com',sourceTitle:'Source',planned:false}));
 const bounds=[{left:85,right:95,top:65,bottom:132},{left:185,right:195,top:72,bottom:137}];
 const groups=layoutOverlayMarkers(events,'2026-09-01','2026-10-01',300,24,140,[],26,undefined,bounds);
 assert.equal(groups.length,2);
 for(const group of groups){
  assert.equal(group.x,(Date.parse(group.events[0].date)-Date.parse('2026-09-01'))/86400000*10);
  for(const candle of bounds){const dx=Math.max(candle.left-group.x,0,group.x-candle.right),dy=Math.max(candle.top-group.y,0,group.y-candle.bottom);assert.ok(Math.hypot(dx,dy)-group.size/2>=8-1e-9);}
 }
});

test('indicator warmup cannot change the first visible weekly candle',()=>{
 const rows=['2026-09-25','2026-09-28','2026-09-30','2026-10-01','2026-10-02'].map((date,index)=>({date,open:10+index,high:15+index,low:9+index,close:11+index,volume:100}));
 const full=timelinePriceBars(rows,'2026-10-01',true);
 const visible=timelinePriceBars(rows.slice(3),'2026-10-01',true);
 assert.deepEqual(full.prices,visible.prices);assert.equal(full.prices[0].open,13);assert.equal(full.warmupPrices.length,1);assert.equal(full.warmupPrices[0].date,'2026-09-25');
});

test('weekly change labels distinguish adjacent holiday-shortened weeks from missing weeks',()=>{
 assert.equal(adjacentTimelineBars('2026-09-30','2026-10-09',true),true);
 assert.equal(adjacentTimelineBars('2026-09-25','2026-10-09',true),false);
 assert.equal(adjacentTimelineBars('2026-09-25','2026-09-28',false),true);
 assert.equal(adjacentTimelineBars('2026-09-25','2026-10-09',false),false);
});

const chart:SharedChart={range:1826,style:'line',averages:[5,20],macd:true,events:true};
test('shared settings round trip and malformed settings use safe defaults',()=>{
  assert.deepEqual(parseSharedChart(new URLSearchParams(sharedChartParams(chart))),chart);
  assert.deepEqual(parseSharedChart(new URLSearchParams('chartRange=999&chartStyle=unknown&chartMA=20,20,999,5&chartMacd=true')), {...chart,range:30,style:'candles',macd:false});
});
test('company links resolve to the appropriate public profile and preserve language',()=>{
  assert.equal(new URL(chartShareUrl('US:AMD','en',chart)).pathname,'/en/ticker/AMD');
  assert.equal(new URL(chartShareUrl('XSHG:600519','zh-CN',chart)).pathname,'/zh-cn/ticker/XSHG:600519');
  assert.equal(decodeURIComponent(new URL(chartShareUrl('ORG:OPENAI','en',chart)).pathname),'/en/company/ORG:OPENAI');
});
test('event shares preserve public selection without personal browsing state',()=>{
  const url=new URL(chartShareUrl('US:AMD','zh-CN',chart,'news_a/b & c',true));
  assert.equal(url.origin,'https://youanalyst.com');
  assert.equal(url.pathname,'/zh-cn');
  assert.equal(url.searchParams.get('event'),'news_a/b & c');
  assert.equal(url.searchParams.get('company'),'US:AMD');
  assert.equal(url.hash,'#company-timeline');
  assert.deepEqual([...url.searchParams.keys()].sort(),['chartEvents','chartMA','chartMacd','chartRange','chartStyle','company','event','view'].sort());
  assert.equal(new URL(chartShareUrl('US:AMD','en',chart,'business_1')).searchParams.get('chartEvent'),'business_1');
});
