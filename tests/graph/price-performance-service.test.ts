import test from 'node:test';
import assert from 'node:assert/strict';
import type {Firestore} from 'firebase-admin/firestore';
import {attachPricePerformance} from '../../src/lib/intelligence/price-performance-service';
import {createCachedPriceBatch,writeCachedPrice} from '../../src/lib/intelligence/price-cache';
import type {KnowledgeGraph} from '../../src/lib/knowledge-graph/model';
import type {IntelligenceEvent} from '../../src/lib/intelligence/model';

function fixture(){
 type Row=Record<string,unknown>;type Ref={path:string};
 const data=new Map<string,Row>(),queries:Array<{limit:number;through:string}>=[];
 let chain=Promise.resolve(),fail=false,versions=0;
 const snap=(r:Ref)=>{const row=structuredClone(data.get(r.path));return {id:r.path.split('/').at(-1)!,exists:!!row,data:()=>row,get:(k:string)=>row?.[k]};};
 function client(){
  function collection(name:string){
   function query(filters:Array<[string,string]>=[],limit=100,after=''){
    return {doc:(id:string)=>({path:`${name}/${id}`,get:async()=>snap({path:`${name}/${id}`})}),
     where:(_f:unknown,op:string,v:string)=>query([...filters,[op,v]],limit,after),orderBy:()=>query(filters,limit,after),
     limit:(n:number)=>query(filters,n,after),select:()=>query(filters,limit,after),startAfter:(d:{id:string})=>query(filters,limit,d.id),
     get:async()=>{queries.push({limit,through:filters.find(([op])=>op==='<=')![1]});
      const docs=[...data.keys()].filter(p=>p.startsWith(name+'/')).map(p=>p.slice(name.length+1)).filter(id=>(!after||id<after)&&filters.every(([op,v])=>op==='>='?id>=v:id<=v)).sort().reverse().slice(0,limit).map(id=>snap({path:`${name}/${id}`}));
      return {docs,size:docs.length};}};
   }return query();
  }
  return {collection,getAll:async(...refs:Ref[])=>refs.map(snap),runTransaction:<T>(fn:(tx:unknown)=>Promise<T>)=>{
   const task=chain.then(async()=>{
    const writes:Array<()=>void>=[];
    const tx={get:async(r:Ref&{get?:()=>unknown})=>r.path?snap(r):r.get!(),getAll:async(...refs:Ref[])=>refs.map(snap),
     set:(r:Ref,row:Row,opts?:{merge:boolean})=>{const copy=structuredClone(row);writes.push(()=>{if(r.path==='collectors/_graph_prices_v1')versions++;const previous=data.get(r.path)??{};data.set(r.path,opts?.merge?{...previous,...copy,...(copy.buckets?{buckets:{...(previous.buckets as Row),...(copy.buckets as Row)}}:{})}:copy);});},
     create:(r:Ref,row:Row)=>{if(data.has(r.path))throw {code:6};writes.push(()=>data.set(r.path,structuredClone(row)));},
     update:(r:Ref,row:Row)=>writes.push(()=>data.set(r.path,{...data.get(r.path),...row})),};
    const result=await fn(tx);if(fail){fail=false;throw Error('commit failed');}writes.forEach(w=>w());return result;
   });chain=task.then(()=>{},()=>{});return task;}} as unknown as Firestore;
 }
 const seed=(day:string,close:number)=>data.set(`eod_prices/US_UNIT_${day}`,{ticker:'UNIT',market:'US',isFinal:true,tradingDate:day,rawClose:close});
 return {data,queries,client,seed,fail:()=>{fail=true;},versions:()=>versions};
}
const graph:KnowledgeGraph={nodes:[{id:'US:UNIT',kind:'COMPANY',order:0},{id:'ORG:PRIVATE',kind:'COMPANY',order:1}],relationships:[],sources:[],asOf:'2026-10-05'};
const now=new Date('2026-10-06T16:00:00Z');
const event:IntelligenceEvent={id:'e',origin:'US:UNIT',companyIds:['US:UNIT'],edgeIds:[],category:'BUSINESS',title:'News',summary:'',published_at:null,publication_date:'2026-10-02',eventDate:null,planned:false,evidence:[]};
const publish=(db:Firestore,date:string,rawClose:number)=>writeCachedPrice(db,db.collection('eod_prices').doc(`US_UNIT_${date}`),{ticker:'UNIT',market:'US',isFinal:true,tradingDate:date,rawClose});

test('history batch preserves existing prices and changes the graph cache version once',async()=>{
 const f=fixture(),db=f.client();f.seed('2026-10-01',100);f.seed('2026-10-02',110);f.seed('2026-10-05',121);
 await attachPricePerformance(db,graph,[event],now);const versions=f.versions();
 const rows=[['2026-09-30',90],['2026-10-01',999],['2026-10-06',130]].map(([date,close])=>({
  ref:db.collection('eod_prices').doc(`US_UNIT_${date}`),patch:{ticker:'UNIT',market:'US',isFinal:true,tradingDate:date,rawClose:close}
 }));
 const result=await createCachedPriceBatch(db,rows);assert.deepEqual(result,{created:2,existing:1});
 assert.equal(f.data.get('eod_prices/US_UNIT_2026-10-01')?.rawClose,100);assert.equal(f.versions(),versions+1);
 const next=await attachPricePerformance(f.client(),graph,[event],new Date('2026-10-07T16:00:00Z'));
 assert.equal(next.graph.nodes[0].dailyPrice?.close,130);assert.equal(next.eventReturns.e[0].baselineClose,100);
 const afterRead=f.versions();
 f.fail();await assert.rejects(createCachedPriceBatch(db,[{ref:db.collection('eod_prices').doc('US_UNIT_2026-10-07'),patch:{ticker:'UNIT',market:'US',isFinal:true,tradingDate:'2026-10-07',rawClose:140}}]),/commit failed/);
 assert.equal(f.data.has('eod_prices/US_UNIT_2026-10-07'),false);assert.equal(f.versions(),afterRead);
});

test('graph reads exactly two closes once; cache survives elapsed time, weekends, concurrent clients and restarts',async()=>{
 const f=fixture();f.seed('2026-10-01',100);f.seed('2026-10-02',110);f.seed('2026-10-05',121);
 const a=f.client(),b=f.client();
 const [first,second]=await Promise.all([attachPricePerformance(a,graph,[],now),attachPricePerformance(b,graph,[],now)]);
 assert.deepEqual(first,second);assert.equal(f.queries.length,1);assert.equal(f.queries[0].limit,2);
 assert.equal(first.graph.nodes[0].dailyPrice?.previousTradingDate,'2026-10-02');assert.equal(first.graph.nodes[0].dailyPrice?.close,121);
 await attachPricePerformance(a,graph,[],new Date('2026-10-06T18:00:00Z'));
 await attachPricePerformance(f.client(),graph,[],new Date('2026-10-11T18:00:00Z'));
 assert.equal(f.queries.length,1);assert.equal(graph.nodes[0].dailyPrice,undefined);
});

test('an event gets only its needed baseline and shares it persistently',async()=>{
 const f=fixture();f.seed('2026-10-01',100);f.seed('2026-10-02',110);f.seed('2026-10-05',121);
 const first=await attachPricePerformance(f.client(),graph,[event],now);
 assert.equal(first.eventReturns.e[0].baselineClose,100);assert.equal(first.eventReturns.e[0].latestClose,121);
 assert.deepEqual(f.queries.map(q=>q.limit),[2,1]);
 await attachPricePerformance(f.client(),graph,[event],now);assert.equal(f.queries.length,2);
});

test('new EOD and corrected closes push into cache without re-querying graph history',async()=>{
 const f=fixture(),db=f.client();f.seed('2026-10-02',110);f.seed('2026-10-05',121);
 await attachPricePerformance(db,graph,[],now);const reads=f.queries.length;
 await publish(db,'2026-10-06',133.1);
 const later=new Date('2026-10-07T16:00:00Z');
 const next=await attachPricePerformance(db,graph,[],later);
 assert.equal(next.graph.nodes[0].dailyPrice?.previousTradingDate,'2026-10-05');assert.equal(next.graph.nodes[0].dailyPrice?.close,133.1);
 await publish(db,'2026-10-05',120);
 const corrected=await attachPricePerformance(f.client(),graph,[],later);
 assert.equal(corrected.graph.nodes[0].dailyPrice?.change,133.1/120-1);assert.equal(f.queries.length,reads);
});

test('historical correction invalidates an event baseline but leaves the two latest closes intact',async()=>{
 const f=fixture(),db=f.client();f.seed('2026-10-01',100);f.seed('2026-10-02',110);f.seed('2026-10-05',121);
 await attachPricePerformance(db,graph,[event],now);
 await publish(db,'2026-10-01',101);
 const next=await attachPricePerformance(db,graph,[event],now);
 assert.equal(next.eventReturns.e[0].baselineClose,101);assert.equal(next.graph.nodes[0].dailyPrice?.close,121);
 assert.deepEqual(f.queries.map(q=>q.limit),[2,1,1]);
});

test('new sessions retain older event baselines and irrelevant backfills do not rewrite cache versions',async()=>{
 const f=fixture(),db=f.client();f.seed('2026-10-01',100);f.seed('2026-10-02',110);f.seed('2026-10-05',121);
 await attachPricePerformance(db,graph,[event],now);
 await publish(db,'2026-10-06',130);
 const reads=f.queries.length;
 const next=await attachPricePerformance(f.client(),graph,[event],new Date('2026-10-07T16:00:00Z'));
 assert.equal(next.eventReturns.e[0].baselineClose,100);assert.equal(f.queries.length,reads);
 // With no affected baseline left, older inserts should not invalidate graph prices.
 await publish(db,'2026-09-01',90);
 const before=JSON.stringify(f.data.get('collectors/_graph_prices_v1'));
 await publish(db,'2026-09-02',91);
 assert.equal(JSON.stringify(f.data.get('collectors/_graph_prices_v1')),before);
});

test('empty prices do not expire, but first arrival wakes the cache; failed writes are atomic',async()=>{
 const f=fixture(),db=f.client();await attachPricePerformance(db,graph,[],now);
 await attachPricePerformance(f.client(),graph,[],now);assert.equal(f.queries.length,1);
 f.fail();await assert.rejects(publish(db,'2026-10-05',100),/commit failed/);
 assert.equal(f.data.has('eod_prices/US_UNIT_2026-10-05'),false);
 await publish(db,'2026-10-05',100);
 const next=await attachPricePerformance(db,graph,[],now);
 assert.equal(next.graph.nodes[0].dailyPrice?.close,100);assert.equal(next.graph.nodes[0].dailyPrice?.change,null);assert.equal(f.queries.length,1);
});

test('bootstrap skips invalid adjusted-only records and future sessions',async()=>{
 const f=fixture();f.seed('2026-10-01',100);f.seed('2026-10-02',110);
 f.data.set('eod_prices/US_UNIT_2026-10-05',{ticker:'UNIT',market:'US',tradingDate:'2026-10-05',isFinal:true,close:999});
 f.seed('2026-10-06',120);
 const next=await attachPricePerformance(f.client(),graph,[],now);
 assert.equal(next.graph.nodes[0].dailyPrice?.close,110);assert.equal(next.graph.nodes[0].dailyPrice?.previousTradingDate,'2026-10-01');
 assert(f.queries.every(q=>q.limit===2));
});
