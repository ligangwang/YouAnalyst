import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import {createSecFilingDiscovered} from '../../src/lib/sec-filings/event';
import {summarizeIntelligence,summarizeSourceDocuments} from '../../src/lib/intelligence/model';
import {NEWS_SOURCES} from '../../scripts/seed-news-sources';
import type { KnowledgeGraph } from '../../src/lib/knowledge-graph/model';

const now=new Date('2026-10-02T16:00:00Z');
const graph:KnowledgeGraph={asOf:'2026-10-02',nodes:[{id:'US:AMD',name:'AMD',kind:'COMPANY',order:0},{id:'US:MU',name:'Micron',kind:'COMPANY',order:1}],sources:[{id:'s',title:'Filing',url:'https://www.sec.gov/Archives/filing.htm',sourceDate:'2026-09-03'}],relationships:[{id:'edge',source:'US:MU',target:'US:AMD',type:'SUPPLIER_OF',summary:'Stored evidence',sourceIds:['s'],commercialStatus:'DOCUMENTED',researchReviewedAt:'2026-10-01'}]};

async function isolated(db:unknown,loadGraph:()=>Promise<KnowledgeGraph>,collectorResult:unknown={failed:0,partial:0,remaining:0,outboxIncomplete:false},loadThemedGraph=loadGraph){
  const result=await build({entryPoints:['src/lib/intelligence/service.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',external:['../firebase/admin','../knowledge-graph/service','../knowledge-graph/curated-events','../sec-filings/store','../company-themes/graph-service']});
  const realRequire=createRequire(import.meta.url);
  const evaluated={exports:{}};
  const injected=(name:string)=>{
    if(name==='../firebase/admin')return {getAdminFirestore:()=>db};
    if(name==='../company-themes/graph-service')return {loadThemeGraph:loadThemedGraph};
    if(name==='../knowledge-graph/service')return {loadKnowledgeGraph:loadGraph};
    if(name==='../knowledge-graph/curated-events')return {curatedEvents:[]};
    if(name==='../sec-filings/store')return {SEC_FILINGS_COLLECTION:'sec_filings',secCollectorMetadata:()=>({get:async()=>({get:(key:string)=>key==='lastRunAt'?now.toISOString():key==='intelligenceIndexReadyAt'?'ready':key==='result'?collectorResult:undefined})})};
    return realRequire(name);
  };
  new Function('require','module','exports',result.outputFiles[0].text)(injected,evaluated,evaluated.exports);
  return evaluated.exports as typeof import('../../src/lib/intelligence/service');
}

test('concurrent browsers share one paginated period read and the 60-second snapshot cache',async()=>{
  let reads=0,graphReads=0;
  const db={collection:(name:string)=>{assert.equal(name,'sec_filings');return {where:(field:string,operator:string)=>{assert.equal(field,'filingDate');assert.equal(operator,'>=');return {orderBy:()=>({limit:(limit:number)=>{assert.equal(limit,500);return {get:async()=>{reads++;return {size:0,docs:[]};}};}})};}};}};
  const service=await isolated(db,async()=>{graphReads++;return graph;});
  const [first,second]=await Promise.all([service.loadIntelligenceSnapshot(now),service.loadIntelligenceSnapshot(now)]);
  assert.equal(first,second);
  assert.equal(first.events.length,1);
  assert.equal(first.coverage.find(item=>item.channel==='SEC')?.status,'connected');
  await service.loadIntelligenceSnapshot(new Date(now.getTime()+59_000));
  assert.equal(reads,1);assert.equal(graphReads,1);
  await service.loadIntelligenceSnapshot(new Date(now.getTime()+61_000));
  assert.equal(reads,2);
});

test('unavailable SEC reads preserve real evidence and explicitly disclose partial coverage',async()=>{
  const service=await isolated({collection:()=>{throw new Error('test permission denied');}},async()=>graph);
  const snapshot=await service.loadIntelligenceSnapshot(now);
  assert.equal(snapshot.events.length,1);
  assert.equal(snapshot.events[0].published_at,null);
  assert.equal(snapshot.statisticsComplete,false);
  assert.equal(snapshot.coverage.find(item=>item.channel==='SEC')?.status,'stored_evidence');
  assert(snapshot.warnings.some(warning=>warning.includes('temporarily unavailable')));
});

test('graph failure rejects the snapshot instead of returning a mock universe',async()=>{
  const service=await isolated({},async()=>{throw new Error('real graph unavailable');});
  await assert.rejects(service.loadIntelligenceSnapshot(now),/real graph unavailable/);
});

test('a recent failed collector run never reports SEC as connected despite successful database reads',async()=>{
  const query={where:()=>query,orderBy:()=>query,limit:()=>query,get:async()=>({size:0,docs:[]})};
  const service=await isolated({collection:()=>query},async()=>graph,{failed:1,partial:0,remaining:12,outboxIncomplete:false});
  const snapshot=await service.loadIntelligenceSnapshot(now);
  assert.equal(snapshot.coverage.find(item=>item.channel==='SEC')?.status,'stored_evidence');
  assert(snapshot.warnings.some(warning=>warning.includes('freshness is unverified')));
});

test('enabled official news arrives through the shared snapshot with current source health',async()=>{
  const previous=process.env.INTELLIGENCE_NEWS_ENABLED;process.env.INTELLIGENCE_NEWS_ENABLED='1';
  try{
    const news={version:1,id:'amd-release',type:'company_news',sourceType:'company_ir',companyIds:['US:AMD'],sourceId:'amd-news',companyId:'US:AMD',baseline:false,title:'Official announcement',summary:'Publisher evidence',url:'https://newsroom.amd.com/news/announcement/',collected_at:now.toISOString(),processed_at:now.toISOString(),published_at:'2026-10-02T12:05:00.000Z',publication_date:'2026-10-02'};
    let newsReads=0;const filters:unknown[][]=[];
    const db={collection:(name:string)=>{
      const query={where:(...args:unknown[])=>{if(name==='events')filters.push(args);return query;},orderBy:()=>query,limit:(limit:number)=>{assert.equal(limit,500);return query;},get:async()=>{if(name==='companies')return {docs:graph.nodes.filter(node=>node.kind==='COMPANY').map(node=>({id:node.id,data:()=>({name:node.name||node.id,status:'DIRECTORY',themeIds:['ai'],themeMemberships:{ai:{status:'PUBLISHED'}},newsSources:NEWS_SOURCES.filter(source=>source.companyId===node.id).map(source=>({...source,status:'PUBLISHED',reviewedAt:'2026-10-04'}))})}))};if(name==='events'){newsReads++;return {size:1,docs:[{data:()=>news}]};}return {size:0,docs:[]};},doc:(id:string)=>({id})};return query;
    },getAll:async(...refs:unknown[])=>{assert.deepEqual(refs,NEWS_SOURCES.filter(source=>graph.nodes.some(node=>node.id===source.companyId)).map(source=>({id:source.id})));return refs.map(()=>({data:()=>({lastSuccessAt:now.toISOString(),failures:0,partial:false})}));}};
    const service=await isolated(db,async()=>graph);
    const snapshot=await service.loadIntelligenceSnapshot(now);
    assert.equal(snapshot.coverage.find(item=>item.channel==='IR')?.status,'connected');
    assert.deepEqual(snapshot.newsCoverage,{configured:2,healthy:2,total:2});
    assert.deepEqual(filters.slice(0,3),[['type','==','company_news'],['sourceType','==','company_ir'],['published_at','>=','2026-09-03T00:00:00.000Z']]);
    const arrival=snapshot.events.find(event=>event.id==='news-amd-release');assert.ok(arrival);
    assert.equal(arrival.published_at,'2026-10-02T12:05:00.000Z');assert.equal('collected_at' in arrival,false);assert.equal('processed_at' in arrival,false);assert.equal(arrival.evidence[0].channel,'IR');assert.deepEqual(arrival.edgeIds,[]);
    await service.loadIntelligenceSnapshot(new Date(now.getTime()+10_000));assert.equal(newsReads,4);
  }finally{if(previous===undefined)delete process.env.INTELLIGENCE_NEWS_ENABLED;else process.env.INTELLIGENCE_NEWS_ENABLED=previous;}
});


test('full-period statistics include sources beyond the 200-entry feed and paginate without double counting',async()=>{
  const documents=Array.from({length:620},(_,index)=>{
    const accessionNumber=`0000002488-26-${String(index).padStart(6,'0')}`;
    const event=createSecFilingDiscovered({companyId:index%2?'AMD':'MU',cik:'0000002488',accessionNumber,form:'10-Q',filingDate:'2026-10-01',primaryDocument:'release.htm',isXbrl:false,published_at:'2026-10-01T12:00:00Z',discoveredAt:'2026-10-02T12:00:00Z'});
    return {id:accessionNumber,data:()=>({discoveryEvents:{[event.eventId]:{event,state:'published'}}})};
  });
  const reads:number[]=[];
  const query=(name:string,offset=0)=>({where:()=>query(name,offset),orderBy:()=>query(name,offset),startAfter:(doc:{id:string})=>query(name,documents.findIndex(candidate=>candidate.id===doc.id)+1),limit:(limit:number)=>({get:async()=>{const docs=name==='sec_filings'?documents.slice(offset,offset+limit):[];if(name==='sec_filings')reads.push(offset);return {size:docs.length,docs};}})});
  const periodGraph={...graph,nodes:[...graph.nodes,{id:'US:OLD',name:'Older source company',kind:'COMPANY' as const,order:2}],sources:[{...graph.sources[0],id:'hidden',url:'https://www.sec.gov/Archives/hidden.htm',sourceDate:'2026-09-03'},...graph.sources,{...graph.sources[0],id:'old',url:'https://www.sec.gov/Archives/older.htm',sourceDate:'2026-09-02'}],relationships:[{...graph.relationships[0],id:'hidden-edge',source:'US:OLD',target:'US:OLD',sourceIds:['hidden']},...graph.relationships,{...graph.relationships[0],id:'older-edge',sourceIds:['old']}]};
  const service=await isolated({collection:(name:string)=>query(name)},async()=>periodGraph);
  const snapshot=await service.loadIntelligenceSnapshot(now);
  assert.equal(snapshot.events.length,200);assert.equal(snapshot.truncated,true);assert.equal(snapshot.statisticsComplete,true);
  // The graph's September source is also in this exact 30-calendar-day period.
  assert.equal(snapshot.sourceDocuments?.length,622);assert.deepEqual(reads,[0,500]);
  assert.equal(summarizeIntelligence(snapshot.events,['US:OLD'],'').events.length,0);
  assert.equal(summarizeSourceDocuments(snapshot.sourceDocuments!,['US:OLD'],'').signals,1);
  const stats=summarizeSourceDocuments(snapshot.sourceDocuments!,['US:AMD'],'SEC');
  assert.equal(stats.signals,311);assert.equal(stats.sources.find(source=>source.name==='SEC')?.count,311);
  assert.equal(summarizeSourceDocuments(snapshot.sourceDocuments!,['US:MU'],'IR').signals,0);
  assert.equal(summarizeSourceDocuments(snapshot.sourceDocuments!,['US:AMD'],'SEC',Date.parse('2026-10-01T11:59:00Z')).signals,0);
  await service.loadIntelligenceSnapshot(new Date(now.getTime()+10_000));assert.deepEqual(reads,[0,500]);
});

test('theme snapshots keep graph and full-period activity caches isolated during concurrent switches',async()=>{
  const query={where:()=>query,orderBy:()=>query,limit:()=>query,get:async()=>({size:0,docs:[]})};
  let aiReads=0,roboticsReads=0;
  const robotics={...graph,nodes:[{id:'US:ROK',name:'Rockwell',kind:'COMPANY' as const,order:0,stageIds:['robotics:systems-integration']}],relationships:[],sources:[]};
  const service=await isolated({collection:()=>query},async()=>{aiReads++;return graph;},undefined,async()=>{roboticsReads++;return robotics;});
  const [ai,robot]=await Promise.all([service.loadIntelligenceSnapshot(now),service.loadIntelligenceSnapshot(now,'robotics')]);
  assert.equal(ai.theme,'ai');assert.equal(robot.theme,'robotics');
  assert.equal(ai.graph,graph);assert.equal(robot.graph,robotics);assert.equal(robot.sourceDocuments?.length,0);assert.equal(ai.sourceDocuments?.length,1);
  const repeated=await service.loadIntelligenceSnapshot(new Date(now.getTime()+10_000),'robotics');assert.equal(repeated,robot);
  assert.equal(await service.loadIntelligenceSnapshot(now),ai);assert.equal(aiReads,1);assert.equal(roboticsReads,1);
});
