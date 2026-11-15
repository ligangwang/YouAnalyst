import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {Firestore,Timestamp} from 'firebase-admin/firestore';
import {observeFirestore} from '../../src/lib/firebase/firestore-observability';
import {createPriceFixture} from '../helpers/price-store';
import {readHead,saveHead} from '../../src/lib/price-store/storage';
import {attachPricePerformance} from '../../src/lib/intelligence/price-performance-service';
import {loadPriceCache,createCachedPriceBatch,writeCachedPrice,writeCachedPrices} from '../../src/lib/intelligence/price-cache';
import type {KnowledgeGraph} from '../../src/lib/knowledge-graph/model';
import type {IntelligenceEvent} from '../../src/lib/intelligence/model';
async function fixture(t:TestContext){
 const f=createPriceFixture(),raw=new Firestore({projectId:'demo-parquet-prices'}),operations:unknown[]=[];
 const db=observeFirestore(raw,e=>operations.push(e));
 await saveHead(f.bucket,await readHead(f.bucket),{version:1,ready:true,files:[]});
 globalThis.__youAnalystParquetStore=Promise.resolve(f.store);
 t.after(async()=>{globalThis.__youAnalystParquetStore=undefined;globalThis.__youAnalystPriceHead=undefined;await f.store.close();await raw.terminate();assert.deepEqual(operations,[],'price features must not use Firestore');});
 const input=(date:string,rawClose:number)=>({ref:db.collection('eod_prices').doc(`US_UNIT_${date}`),patch:{ticker:'UNIT',market:'US',tradingDate:date,rawClose,close:rawClose,isFinal:true,updatedAt:new Timestamp(1,0)}});
 return {...f,db,input,publish:async(date:string,close:number)=>{const r=input(date,close);await writeCachedPrice(db,r.ref,r.patch);}};
}
const graph:KnowledgeGraph={nodes:[{id:'US:UNIT',kind:'COMPANY',order:0},{id:'ORG:PRIVATE',kind:'COMPANY',order:1}],relationships:[],sources:[],asOf:'2026-10-05'};
const now=new Date('2026-10-06T16:00:00Z');
const event:IntelligenceEvent={id:'e',origin:'US:UNIT',companyIds:['US:UNIT'],edgeIds:[],category:'BUSINESS',title:'News',summary:'',published_at:null,publication_date:'2026-10-02',eventDate:null,planned:false,evidence:[]};
test('graph prices and event baselines use Parquet and corrections invalidate the manifest version',async t=>{
 const f=await fixture(t);await writeCachedPrices(f.db,[f.input('2026-10-01',100),f.input('2026-10-02',110),f.input('2026-10-05',121)]);
 const before=await loadPriceCache(f.db,['UNIT']);
 const first=await attachPricePerformance(f.db,graph,[event],now,before);
 assert.equal(first.graph.nodes[0].dailyPrice?.close,121);assert(Math.abs(first.graph.nodes[0].dailyPrice!.change!-.1)<1e-12);
 assert.equal(first.eventReturns.e[0].baselineDate,'2026-10-01');
 await f.publish('2026-10-01',90);
 const after=await loadPriceCache(f.db,['UNIT']);assert.notEqual(after.version,before.version);
 const corrected=await attachPricePerformance(f.db,graph,[event],now,after);
 assert.equal(corrected.eventReturns.e[0].baselineClose,90);
});
test('missing-only history preserves existing values and concurrent batches create each ID once',async t=>{
 const f=await fixture(t);await f.publish('2026-10-01',99);
 const results=await Promise.all([createCachedPriceBatch(f.db,[f.input('2026-10-01',10),f.input('2026-10-02',20)]),createCachedPriceBatch(f.db,[f.input('2026-10-02',30),f.input('2026-10-05',40)])]);
 assert.equal(results.reduce((n,r)=>n+r.created,0),2);assert.equal((await f.db.collection('eod_prices').doc('US_UNIT_2026-10-01').get()).get('rawClose'),99);
});
test('large history batches remain bounded and persist all 1500 rows without Firestore',async t=>{
 const f=await fixture(t),rows=Array.from({length:1500},(_,i)=>f.input(new Date(Date.UTC(2020,0,1+i)).toISOString().slice(0,10),100+i));
 assert.deepEqual(await createCachedPriceBatch(f.db,rows),{created:1500,existing:0});
 assert.equal((await f.store.query([{method:'limit',args:[2000]}])).length,1500);
 assert.deepEqual(await createCachedPriceBatch(f.db,rows),{created:0,existing:1500});
});
test('an empty price demand does not initialize storage',async()=>{assert.deepEqual(await loadPriceCache({} as Firestore,[]),{version:'',entries:{}});});
