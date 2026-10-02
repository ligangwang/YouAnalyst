import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import type { KnowledgeGraph } from '../../src/lib/knowledge-graph/model';

const now=new Date('2026-10-02T16:00:00Z');
const graph:KnowledgeGraph={asOf:'2026-10-02',nodes:[{id:'US:AMD',name:'AMD',kind:'COMPANY',order:0},{id:'US:MU',name:'Micron',kind:'COMPANY',order:1}],sources:[{id:'s',title:'Filing',url:'https://www.sec.gov/Archives/filing.htm',sourceDate:'2026-09-01'}],relationships:[{id:'edge',source:'US:MU',target:'US:AMD',type:'SUPPLIER_OF',summary:'Stored evidence',sourceIds:['s'],commercialStatus:'DOCUMENTED',researchReviewedAt:'2026-10-01'}]};

async function isolated(db:unknown,loadGraph:()=>Promise<KnowledgeGraph>,collectorResult:unknown={failed:0,partial:0,remaining:0,outboxIncomplete:false}){
  const result=await build({entryPoints:['src/lib/intelligence/service.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',external:['../firebase/admin','../knowledge-graph/service','../knowledge-graph/curated-events','../sec-filings/store']});
  const realRequire=createRequire(import.meta.url);
  const evaluated={exports:{}};
  const injected=(name:string)=>{
    if(name==='../firebase/admin')return {getAdminFirestore:()=>db};
    if(name==='../knowledge-graph/service')return {loadKnowledgeGraph:loadGraph};
    if(name==='../knowledge-graph/curated-events')return {curatedEvents:[]};
    if(name==='../sec-filings/store')return {SEC_FILINGS_COLLECTION:'sec_filings',secCollectorMetadata:()=>({get:async()=>({get:(key:string)=>key==='lastRunAt'?now.toISOString():key==='intelligenceIndexReadyAt'?'ready':key==='result'?collectorResult:undefined})})};
    return realRequire(name);
  };
  new Function('require','module','exports',result.outputFiles[0].text)(injected,evaluated,evaluated.exports);
  return evaluated.exports as typeof import('../../src/lib/intelligence/service');
}

test('concurrent browsers share one bounded read and the 60-second snapshot cache',async()=>{
  let reads=0,graphReads=0;
  const db={collection:(name:string)=>{assert.equal(name,'sec_filings');return {where:(field:string,operator:string)=>{assert.equal(field,'intelligenceObservedAt');assert.equal(operator,'>=');return {orderBy:()=>({limit:(limit:number)=>{assert.equal(limit,201);return {get:async()=>{reads++;return {size:0,docs:[]};}};}})};}};}};
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
  assert.equal(snapshot.events[0].observedAt,null);
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
