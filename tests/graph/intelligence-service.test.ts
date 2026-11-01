import {legacyCatalog} from '../helpers/theme-catalog';
import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {gunzipSync} from 'node:zlib';
import type {KnowledgeGraph} from '../../src/lib/knowledge-graph/model';
import type {CachedFeed} from '../../src/lib/intelligence/feed-cache-store';
import type {FeedRecord} from '../../src/lib/intelligence/feed-cache';
import {createSecFilingDiscovered} from '../../src/lib/sec-filings/event';
const now=new Date('2026-10-02T16:00:00Z');
const graph:KnowledgeGraph={asOf:'2026-10-02',nodes:[{id:'US:AMD',name:'AMD',kind:'COMPANY',order:0},{id:'US:MU',name:'Micron',kind:'COMPANY',order:1}],sources:[],relationships:[]};
function filing(index:number,day='2026-10-02',companyId='AMD'):FeedRecord{
  const accessionNumber=`0000002488-26-${String(index).padStart(6,'0')}`;
  const event=createSecFilingDiscovered({companyId,cik:'0000002488',accessionNumber,form:'10-K',filingDate:day,primaryDocument:'report.htm',isXbrl:false,discoveredAt:day+'T12:00:00.000Z'});
  return {collection:'sec_filings',id:accessionNumber,data:{filingDate:day,published_at:null,discoveryEvents:{[event.eventId]:{event,state:'published'}}}};
}
function feed(records:FeedRecord[]=[],revision='one',loadedFrom='2026-10-02'):CachedFeed{return {days:{[loadedFrom]:records},revision,loadedFrom,hasMore:true};}
async function isolated(load:()=>Promise<CachedFeed>,options:{priceVersion?:()=>string;priceRead?:()=>void;priceAttach?:(graph:KnowledgeGraph,events:unknown[])=>void;graph?:()=>Promise<KnowledgeGraph>;valuations?:(graph:KnowledgeGraph)=>Promise<KnowledgeGraph>;calendar?:(events:unknown[])=>void;sources?:()=>Promise<[]>;freshness?:()=>void;collector?:Record<string,unknown>}={}){
  const external=['../change-cache','./price-cache','./feed-cache-store','./price-performance-service','../firebase/admin','../knowledge-graph/service','../knowledge-graph/curated-events','../sec-filings/store','../company-themes/graph-service','../calendar/intelligence-links','./collectors/source-service'];
  const result=await build({entryPoints:['src/lib/intelligence/service.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',external});
  const realRequire=createRequire(import.meta.url),evaluated={exports:{}},db={};
  const injected=(name:string)=>{
    if(name==='./price-cache')return {loadPriceCache:async()=>{options.priceRead?.();return {version:options.priceVersion?.()??'prices',entries:{}};}};
    if(name==='./collectors/source-service')return {loadNewsSourceCompanies:options.sources??(async()=>[]),graphNewsSources:async()=>[],loadNewsSources:async()=>[]};
    if(name==='./feed-cache-store')return {loadCachedFeed:load};
    if(name==='./price-performance-service')return {attachPricePerformance:async(_db:unknown,graph:KnowledgeGraph,events:unknown[])=>{options.priceAttach?.(graph,events);return {graph,eventReturns:{}};}};
    if(name==='../calendar/intelligence-links')return {attachCalendarLinks:async(_db:unknown,events:unknown[])=>{options.calendar?.(events);return events;}};
    if(name==='../firebase/admin')return {getAdminFirestore:()=>db};
    if(name==='../change-cache')return {withCacheReadScope:(load:()=>Promise<unknown>)=>load(),changeCached:async(_db:unknown,_key:string,_scopes:string[],load:()=>Promise<unknown>)=>load()};
    if(name==='../company-themes/graph-service')return {loadThemeGraphStructure:options.graph??(async()=>graph),loadThemeGraph:async(_theme:string,structure:KnowledgeGraph)=>options.valuations?options.valuations(structure):structure};
    if(name==='../knowledge-graph/service')return {loadKnowledgeGraph:options.graph??(async()=>graph)};
    if(name==='../knowledge-graph/curated-events')return {curatedEvents:[]};
    if(name==='../sec-filings/store')return {secCollectorFreshness:()=>({get:async()=>{options.freshness?.();return {get:(key:string)=>key==='lastRunAt'?now.toISOString():key==='result'?(options.collector??{failed:0,partial:0,remaining:0,outboxIncomplete:false}):undefined};}})};
    return realRequire(name);
  };
  new Function('require','module','exports',result.outputFiles[0].text)(injected,evaluated,evaluated.exports);
  return evaluated.exports as typeof import('../../src/lib/intelligence/service');
}

test('feed starts graph work without waiting for source data and shares it with bootstrap',async()=>{
  let releaseFeed!:(value:CachedFeed)=>void,releaseGraph!:(value:KnowledgeGraph)=>void,graphCalls=0;
  const feedGate=new Promise<CachedFeed>(resolve=>{releaseFeed=resolve;});
  const graphGate=new Promise<KnowledgeGraph>(resolve=>{releaseGraph=resolve;});
  const service=await isolated(()=>feedGate,{graph:async()=>{graphCalls++;return graphGate;}});
  const full=service.loadIntelligenceSnapshot(now);
  assert.equal(graphCalls,1,'source I/O must not delay graph I/O');
  const bootstrap=service.loadIntelligenceUniverse(now);
  assert.equal(graphCalls,1,'concurrent bootstrap must not repeat graph/valuation work');
  releaseGraph(graph);assert.equal((await bootstrap).eventsPending,true);
  releaseFeed(feed([filing(1)]));assert.equal((await full).events.length,1);
  await service.loadIntelligenceUniverse(now);assert.equal(graphCalls,2,'completed work is not a stale result cache');
});

test('a failed shared graph can retry and a pending theme does not block another theme',async()=>{
  let rejectGraph!:(error:Error)=>void,calls=0;
  const blocked=new Promise<KnowledgeGraph>((_resolve,reject)=>{rejectGraph=reject;});
  const service=await isolated(async()=>feed(),{graph:async()=>++calls===1?blocked:graph});
  const first=service.loadIntelligenceUniverse(now,'ai');
  const second=service.loadIntelligenceUniverse(now,'ai');
  const failures=Promise.all([assert.rejects(first,/offline/),assert.rejects(second,/offline/)]);
  assert.equal(calls,1);
  const other=await service.loadIntelligenceUniverse(now,'quantum');assert.equal(other.theme,'quantum');
  rejectGraph(Error('offline'));await failures;
  assert.equal((await service.loadIntelligenceUniverse(now,'ai')).theme,'ai');assert.equal(calls,3);
});

test('event and calendar work overlaps valuation loading without dropping market caps',async()=>{
  let release!:(graph:KnowledgeGraph)=>void,calendarStarted!:()=>void,finished=false;
  const valuations=new Promise<KnowledgeGraph>(resolve=>{release=resolve;});
  const calendar=new Promise<void>(resolve=>{calendarStarted=resolve;});
  const service=await isolated(async()=>feed([filing(1)]),{valuations:()=>valuations,calendar:calendarStarted});
  const pending=service.loadIntelligenceSnapshot(now);void pending.then(()=>{finished=true;});
  await calendar;assert.equal(finished,false,'calendar must run while valuations are pending');
  const enriched={...graph,nodes:graph.nodes.map(node=>({...node,marketCap:{value:123,currency:'USD' as const,priceDate:'2026-10-01'}}))};
  release(enriched);const result=await pending;assert.equal(result.graph.nodes[0].marketCap?.value,123);assert.equal(result.events.length,1);
});

test('unchanged feed revision reuses the projected feed past one minute; new arrivals invalidate it',async()=>{
  let current=feed([filing(1)]);
  const service=await isolated(async()=>current);
  const first=await service.loadIntelligenceSnapshot(now);
  assert.equal(first.events.length,1);
  assert.deepEqual((await service.loadIntelligenceSnapshot(new Date(now.getTime()+61_000))).events,first.events);
  current=feed([filing(1),filing(2)],'two');
  const next=await service.loadIntelligenceSnapshot(new Date(now.getTime()+62_000));
  assert.equal(next.events.length,2);assert.notEqual(next,first);
  assert.equal(next.feedWindow?.version,'two');
});

test('loaded history is explicit and out-of-window sources never appear',async()=>{
  const service=await isolated(async()=>feed([filing(1),filing(2,'2026-10-01'),filing(3,'2026-09-01')],'history','2026-10-01'));
  const snapshot=await service.loadIntelligenceSnapshot(now);
  assert.equal(snapshot.events.length,2);
  assert.deepEqual(snapshot.feedWindow,{loadedFrom:'2026-10-01',through:'2026-10-02',maxDays:7,hasMore:true,version:'history'});
  assert.equal(snapshot.sourceDocuments?.length,2);
});

test('company filters and ten-at-a-time UI do not lose older items within a loaded day',async()=>{
  const records=Array.from({length:230},(_,i)=>filing(i+1,'2026-10-02',i%2?'AMD':'MU'));
  const service=await isolated(async()=>feed(records));
  const all=await service.loadIntelligenceSnapshot(now);
  assert.equal(all.events.length,230);assert.equal(all.limit,10);assert.equal(all.truncated,false);
  const amd=await service.loadCompanyIntelligenceSnapshot(now,'ai','AMD');
  assert.equal(amd.events.length,115);assert(amd.events.every(event=>event.companyIds.includes('US:AMD')));
  assert.equal((await service.loadCompanyIntelligenceSnapshot(now,'ai','UNKNOWN')).events.length,0);
});

test('universe bootstrap does not touch the feed; unavailable cache reports partial coverage and retries',async()=>{
  let fail=true,calls=0;
  const service=await isolated(async()=>{calls++;if(fail)throw Error('test cache unavailable');return feed([filing(1)]);});
  const universe=await service.loadIntelligenceUniverse(now);assert.equal(calls,0);assert.equal(universe.eventsPending,true);
  const partial=await service.loadIntelligenceSnapshot(now);assert.equal(partial.statisticsComplete,false);assert.equal(partial.events.length,0);
  fail=false;const next=await service.loadIntelligenceSnapshot(now);assert.equal(next.events.length,1);
});

test('graph failures are surfaced and collector failures never claim connected coverage',async()=>{
  const broken=await isolated(async()=>feed(),{graph:async()=>{throw Error('graph unavailable');}});
  await assert.rejects(broken.loadIntelligenceSnapshot(now),/graph unavailable/);
  const service=await isolated(async()=>feed([filing(1)]),{collector:{failed:1,partial:0,remaining:0,outboxIncomplete:false}});
  const snapshot=await service.loadIntelligenceSnapshot(now);
  assert.notEqual(snapshot.coverage.find(source=>source.channel==='SEC')?.status,'connected');
});

test('Eastern day boundary changes projection even without a source notification',async()=>{
  const service=await isolated(async()=>feed([filing(1)]));
  const first=await service.loadIntelligenceSnapshot(new Date('2026-10-03T03:59:59Z'));
  const next=await service.loadIntelligenceSnapshot(new Date('2026-10-03T04:00:00Z'));
  assert.equal(first.session.date,'2026-10-02');assert.equal(next.session.date,'2026-10-03');assert.notEqual(first,next);
});

test('the events route negotiates compression and preserves filters and deferred refresh scheduling',async()=>{
  const result=await build({entryPoints:['src/app/api/intelligence/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',external:['@/lib/company-themes/catalog','@/lib/intelligence/service','@/lib/company-themes/model','next/server']});
  const realRequire=createRequire(import.meta.url),evaluated={exports:{}};
  const callbacks:Array<()=>Promise<void>>=[];
  let fail=false;
  const payload={theme:'ai',graph,events:[],sourceDocuments:[],padding:'source evidence '.repeat(500)};
  const after=(callback:()=>Promise<void>)=>{callbacks.push(callback);};
  const injected=(name:string)=>{
    if(name==='@/lib/company-themes/catalog')return {loadThemeCatalog:async()=>legacyCatalog};
    if(name==='next/server')return {after};
    if(name==='@/lib/company-themes/model')return {parseCompanyTheme:()=> 'ai'};
    if(name==='@/lib/intelligence/service')return {loadCompanyIntelligenceSnapshot:async(_now:Date,theme:string,company:string,query:string,region:string,schedule:typeof after)=>{
      assert.equal(theme,'ai');assert.equal(company,'');assert.equal(query,'QCOM');assert.equal(region,'US');assert.equal(schedule,after);
      if(fail)throw new Error('unavailable');
      schedule(async()=>{});return payload;
    }};
    return realRequire(name);
  };
  new Function('require','module','exports',result.outputFiles[0].text)(injected,evaluated,evaluated.exports);
  const route=evaluated.exports as typeof import('../../src/app/api/intelligence/route');
  for(const [accept,compressed] of [['gzip',true],['br, gzip;q=0.5',true],['gzip;q=0',false],['identity',false],['',false]] as const){
    const response=await route.GET(new Request('http://localhost/api/intelligence?q=QCOM&region=US',{headers:{'accept-encoding':accept}}));
    assert.equal(response.status,200);assert.equal(response.headers.get('vary'),'Accept-Encoding');
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('content-encoding'),compressed?'gzip':null);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(compressed)assert(bytes.length<JSON.stringify(payload).length/2);
    assert.deepEqual(JSON.parse(compressed?gunzipSync(bytes).toString():bytes.toString()),payload);
  }
  assert.equal(callbacks.length,5);
  const current=await route.GET(new Request('http://localhost/api/intelligence?q=QCOM&region=US'));
  const unchanged=await route.GET(new Request('http://localhost/api/intelligence?q=QCOM&region=US',{headers:{'If-None-Match':current.headers.get('etag')!}}));
  assert.equal(unchanged.status,304);assert.equal(await unchanged.text(),'');
  assert.equal((await route.GET(new Request('http://localhost/api/intelligence?before=invalid'))).status,400);
  fail=true;
  const error=await route.GET(new Request('http://localhost/api/intelligence?q=QCOM&region=US'));
  assert.equal(error.status,503);assert.equal(error.headers.get('content-encoding'),null);
});

 test('a price arrival invalidates the projected snapshot before the five-minute metadata refresh',async()=>{
 let version='one';const service=await isolated(async()=>feed(),{priceVersion:()=>version});
 const first=await service.loadIntelligenceSnapshot(now);
 version='two';const next=await service.loadIntelligenceSnapshot(new Date(now.getTime()+1000));
 assert.notEqual(next,first);
 });


test('core initializes independent sources together and never reads optional calendar or prices',async()=>{
  const previous=process.env.INTELLIGENCE_NEWS_ENABLED;process.env.INTELLIGENCE_NEWS_ENABLED='1';
  try{
    let release!:(value:CachedFeed)=>void;const started:string[]=[];
    const gate=new Promise<CachedFeed>(resolve=>{release=resolve;});
    const unexpected=()=>{throw Error('optional read on core path');};
    const service=await isolated(()=>{started.push('feed');return gate;},{graph:async()=>{started.push('graph');return graph;},sources:async()=>{started.push('sources');return [];},freshness:()=>{started.push('freshness');},priceRead:unexpected,priceAttach:unexpected,calendar:unexpected});
    const pending=service.loadIntelligenceSnapshot(now,'ai',undefined,undefined,true);
    assert.deepEqual(new Set(started),new Set(['feed','graph','sources','freshness']));
    release(feed([filing(1)]));const result=await pending;
    assert.equal(result.enrichmentDeferred,true);assert.equal(result.events.length,1);assert.deepEqual(result.eventReturns,{});
  }finally{if(previous===undefined)delete process.env.INTELLIGENCE_NEWS_ENABLED;else process.env.INTELLIGENCE_NEWS_ENABLED=previous;}
});

test('demand enrichment reuses core data and scopes prices to requested companies and events',async()=>{
  let feedReads=0;const priceScopes:string[][]=[],calendarScopes:unknown[][]=[];
  const service=await isolated(async()=>{feedReads++;return feed([filing(1),filing(2,'2026-10-02','MU')]);},{priceRead:()=>{throw Error('whole price cache read');},priceAttach:graph=>{priceScopes.push(graph.nodes.map(node=>node.id));},calendar:events=>{calendarScopes.push(events);}});
  const base=await service.loadIntelligenceSnapshot(now,'ai',undefined,undefined,true);
  const amd=base.events.find(event=>event.companyIds.includes('US:AMD'))!;
  await service.loadIntelligenceEnrichment('ai',[amd.id],['US:UNKNOWN'],'prices',base.generatedAt,now);
  assert.deepEqual(priceScopes,[['US:AMD']]);assert.equal(calendarScopes.length,0);
  await service.loadIntelligenceEnrichment('ai',[amd.id],[],'calendar',base.generatedAt,now);
  assert.deepEqual(calendarScopes,[[amd]]);assert.equal(priceScopes.length,1);assert.equal(feedReads,1);
});


test('enrichment endpoint rejects oversized or unknown scopes before reading data',async()=>{
 const dependencies=['@/lib/intelligence/service','@/lib/company-themes/catalog','@/lib/company-themes/catalog-model','@/lib/local-cache/company-page-scope'];
 const built=await build({entryPoints:['src/app/api/intelligence/enrichment/route.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',external:dependencies});
 const evaluated={exports:{}},calls:unknown[][]=[];
 new Function('require','module','exports',built.outputFiles[0].text)((name:string)=>{
  if(name===dependencies[0])return {loadIntelligenceEnrichment:async(...args:unknown[])=>{calls.push(args);return {calendar:{chosen:[]}};}};
  if(name===dependencies[1])return {loadThemeCatalog:async()=>[]};
  if(name===dependencies[2])return {resolveCatalogTheme:(_catalog:unknown,theme:string)=>theme==='ai'?'ai':undefined};
  if(name===dependencies[3])return {withCompanyPageReads:(load:()=>unknown)=>load()};
  throw Error(name);
 },evaluated,evaluated.exports);
 const route=evaluated.exports as typeof import('../../src/app/api/intelligence/enrichment/route');
 const body={theme:'ai',snapshotAt:now.toISOString(),kind:'calendar',eventIds:['chosen'],companyIds:[]};
 const request=(value:unknown)=>new Request('http://localhost/api/intelligence/enrichment',{method:'POST',body:JSON.stringify(value)});
 assert.equal((await route.POST(request({...body,eventIds:Array(21).fill('chosen')}))).status,400);
 assert.equal((await route.POST(request({...body,theme:'private'}))).status,404);
 assert.equal((await route.POST(request({...body,eventIds:[]}))).status,200);assert.equal(calls.length,0);
 const response=await route.POST(request(body));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{calendar:{chosen:[]},snapshotAt:now.toISOString()});
 assert.deepEqual(calls,[['ai',['chosen'],[],'calendar',now.toISOString()]]);
});
