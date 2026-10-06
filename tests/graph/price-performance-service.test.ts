import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import type {KnowledgeGraph} from '../../src/lib/knowledge-graph/model';
import type {IntelligenceEvent} from '../../src/lib/intelligence/model';

test('themes share Firestore-only price reads, ignore adjusted-only records and preserve graph input',async()=>{
  const compiled=await build({entryPoints:['src/lib/intelligence/price-performance-service.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external'});
  let priceReads=0;
  const priceQuery={where:(_field:unknown,operator:string,value:string)=>{assert.ok(value.startsWith('US_UNIT_'));if(operator==='<=')assert.equal(value,'US_UNIT_2026-10-05');return priceQuery;},select:()=>priceQuery,get:async()=>{priceReads++;return {docs:[
    {data:()=>({ticker:'UNIT',market:'US',isFinal:true,tradingDate:'2026-10-01',rawClose:100,close:90})},
    {data:()=>({ticker:'UNIT',market:'US',isFinal:true,tradingDate:'2026-10-02',rawClose:110,close:99})},
    {data:()=>({ticker:'UNIT',market:'US',isFinal:true,tradingDate:'2026-10-05',rawClose:121,close:999})},
    {data:()=>({ticker:'UNIT',market:'US',isFinal:true,tradingDate:'2026-10-06',close:888})},
  ]};}};
  const db={collection:(name:string)=>{assert.equal(name,'eod_prices');return priceQuery;}};
  const evaluated={exports:{}};
  new Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(import.meta.url),evaluated,evaluated.exports);
  const service=evaluated.exports as typeof import('../../src/lib/intelligence/price-performance-service');
  const graph:KnowledgeGraph={nodes:[{id:'US:UNIT',kind:'COMPANY',order:0},{id:'ORG:PRIVATE',kind:'COMPANY',order:1}],relationships:[],sources:[],asOf:'2026-10-05'};
  const event:IntelligenceEvent={id:'e',origin:'US:UNIT',companyIds:['US:UNIT'],edgeIds:[],category:'BUSINESS',title:'News',summary:'',published_at:null,publication_date:'2026-10-02',eventDate:null,planned:false,evidence:[]};
  const now=new Date('2026-10-06T16:00:00Z');
  const [first,second]=await Promise.all([service.attachPricePerformance(db as never,graph,[event],now),service.attachPricePerformance(db as never,graph,[event],now)]);
  assert.deepEqual(first,second);assert.equal(priceReads,1);
  assert.equal(first.graph.nodes[0].dailyPrice?.close,121);assert.equal(first.graph.nodes[0].dailyPrice?.tradingDate,'2026-10-05');
  assert.equal(first.eventReturns.e[0].baselineClose,100);assert.equal(first.eventReturns.e[0].latestClose,121);
  assert.equal(first.graph.nodes[1].dailyPrice,undefined);assert.equal(graph.nodes[0].dailyPrice,undefined);
});
