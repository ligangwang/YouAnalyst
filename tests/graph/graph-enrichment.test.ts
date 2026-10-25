import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {loadKnowledgeGraphStructure,loadGraphValuations} from '../../src/lib/knowledge-graph/service';
import {companyResearchGraph} from '../../src/lib/knowledge-graph/company-research-projection';

test('company identity/relationships finish before valuations; US and CN enrichment overlap without mutating metadata',async()=>{
 let release!:()=>void,started!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}),bothStarted=new Promise<void>(resolve=>{started=resolve;});
 const reads:string[][]=[];
 const cap=(id:string)=>id.startsWith('US:')?{status:'estimated',currency:'USD',value:100,priceDate:'2026-10-23'}:
  {status:'estimated',currency:'CNY',value:700,priceDate:'2026-10-23',usd:{value:100,rateDate:'2026-10-23'}};
 const db={collection:(name:string)=>({doc:(id:string)=>({id}),where:(field:string,op:string,value:string)=>{assert.deepEqual([field,op,value],['status','==','PUBLISHED']);return {get:async()=>{assert.equal(name,'company_relationships');return {docs:[]};}};}}),
  getAll:async(...refs:{id:string}[])=>{reads.push(refs.map(ref=>ref.id));if(reads.length===2)started();await gate;return refs.map(ref=>({id:ref.id,exists:true,data:()=>({marketCap:cap(ref.id)})}));},
 } as unknown as Firestore;
 const companies=['US:A','XSHE:000001'].map(id=>({id,data:()=>({name:id,status:'PUBLISHED',symbol:id.split(':')[1],inGraph:{status:'PUBLISHED',stageIds:[],stages:[],memberships:[],sources:[],order:1,asOf:'2026-10-23'}})}));
 const structure=await loadKnowledgeGraphStructure({db,companies:companies as never});
 assert.equal(structure.nodes.filter(n=>n.kind==='COMPANY').length,2);
 assert.equal(reads.length,0,'identity reads never wait for unrelated financial documents');
 const metadata=companyResearchGraph(structure);
 const pending=loadGraphValuations(db,structure);
 await bothStarted;
 assert.deepEqual(reads,[['US:A'],['XSHE:000001']]);
 assert(structure.nodes.every(node=>node.marketCap===undefined));
 release();const enriched=await pending;
 assert.equal(enriched.nodes.find(n=>n.id==='US:A')?.marketCap?.value,100);
 assert.equal(enriched.nodes.find(n=>n.id==='XSHE:000001')?.marketCap?.local?.value,700);
 assert.deepEqual(companyResearchGraph(enriched),metadata,'identity, relationships and source evidence stay identical');
 assert(structure.nodes.every(node=>node.marketCap===undefined),'shared metadata stays immutable after enrichment');
});

test('one unavailable valuation region does not discard the other region or alter source data',async t=>{
 const errors:unknown[][]=[];t.mock.method(console,'error',(...args:unknown[])=>{errors.push(args);});
 const structure={nodes:[{id:'US:A',kind:'COMPANY' as const,order:0,name:'Alpha'},{id:'XSHE:000001',kind:'COMPANY' as const,order:1,name:'China'}],relationships:[],sources:[],asOf:'2026-10-23'};
 const db={collection:()=>({doc:(id:string)=>({id})}),getAll:async(...refs:{id:string}[])=>{
  if(refs[0].id.startsWith('XSHE:'))throw Error('CN read failed');
  return refs.map(ref=>({id:ref.id,exists:true,data:()=>({marketCap:{status:'estimated',currency:'USD',value:123,priceDate:'2026-10-23'}})}));
 }} as unknown as Firestore;
 const result=await loadGraphValuations(db,structure);
 assert.equal(result.nodes[0].marketCap?.value,123);assert.equal(result.nodes[1].marketCap,undefined);
 assert.equal(errors.length,1);assert.equal(errors[0][0],'A-share market cap summaries unavailable');
 assert.deepEqual(structure.nodes.map(n=>Object.keys(n)),[['id','kind','order','name'],['id','kind','order','name']]);
});
