import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import type {KnowledgeGraph} from '../../src/lib/knowledge-graph/model';
import type {IntelligenceEvent} from '../../src/lib/intelligence/model';

test('themes share stored price reads, keep raw/adjusted conventions separate and preserve graph input',async()=>{
  const compiled=await build({entryPoints:['src/lib/intelligence/price-performance-service.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',external:['../firebase/admin']});
  let historyReads=0,cacheReads=0,priceReads=0;
  const priceQuery={
    where:()=>priceQuery,select:()=>priceQuery,
    get:async()=>{priceReads++;return {docs:[
      {data:()=>({ticker:'UNIT',market:'US',isFinal:true,tradingDate:'2026-10-05',rawClose:121,close:999})},
      {data:()=>({ticker:'UNIT',market:'US',isFinal:true,tradingDate:'2026-10-06',close:888})},
    ]};},
  };
  const db={collection:(name:string)=>name==='collectors'?{
    doc:(id:string)=>{assert.equal(id,'eod-history_US_UNIT');return {
      get:async()=>{historyReads++;return {data:()=>({status:'completed',from:'2025-12-31',through:'2026-10-02'})};},
    };},
  }:priceQuery};
  const realRequire=createRequire(import.meta.url),evaluated={exports:{}};
  const previous=process.env.EODHD_BULK_EOD_BUCKET;process.env.EODHD_BULK_EOD_BUCKET='test-price-cache';
  try{
    new Function('require','module','exports',compiled.outputFiles[0].text)((name:string)=>name==='../firebase/admin'?{getAdminStorageBucket:(name:string)=>{assert.equal(name,'test-price-cache');return {file:(path:string)=>{assert.equal(path,'eod-history/US/UNIT/2025-12-31_2026-10-02.json');return {download:async()=>{cacheReads++;return [Buffer.from(JSON.stringify([{date:'2026-10-01',open:100,high:101,low:99,close:100,adjusted_close:90,volume:100},{date:'2026-10-02',open:110,high:111,low:109,close:110,adjusted_close:99,volume:100}]))];}};}};}}:realRequire(name),evaluated,evaluated.exports);
    const service=evaluated.exports as typeof import('../../src/lib/intelligence/price-performance-service');
    const graph:KnowledgeGraph={nodes:[{id:'US:UNIT',kind:'COMPANY',order:0},{id:'ORG:PRIVATE',kind:'COMPANY',order:1}],relationships:[],sources:[],asOf:'2026-10-05'};
    const event:IntelligenceEvent={id:'e',origin:'US:UNIT',companyIds:['US:UNIT'],edgeIds:[],category:'BUSINESS',title:'News',summary:'',published_at:null,publication_date:'2026-10-02',eventDate:null,planned:false,evidence:[]};
    const now=new Date('2026-10-06T16:00:00Z');
    const [first,second]=await Promise.all([service.attachPricePerformance(db as never,graph,[event],now),service.attachPricePerformance(db as never,graph,[event],now)]);
    assert.deepEqual(first,second);assert.equal(historyReads,1);assert.equal(cacheReads,1);assert.equal(priceReads,1);
    assert.equal(first.graph.nodes[0].dailyPrice?.close,121);assert.equal(first.graph.nodes[0].dailyPrice?.tradingDate,'2026-10-05');
    assert.equal(first.eventReturns.e[0].baselineClose,100);assert.equal(first.eventReturns.e[0].latestClose,121);
    assert.equal(first.graph.nodes[1].dailyPrice,undefined);assert.equal(graph.nodes[0].dailyPrice,undefined);
  }finally{if(previous===undefined)delete process.env.EODHD_BULK_EOD_BUCKET;else process.env.EODHD_BULK_EOD_BUCKET=previous;}
});
