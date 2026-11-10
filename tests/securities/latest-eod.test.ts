import test from "node:test";
import assert from "node:assert/strict";
import {shouldReplaceLatest,readLatestUsPrices,saveLatestEodPrice,saveLatestEodPrices} from "../../src/lib/predictions/latest-eod";
import {pubsubFirestore} from '../helpers/pubsub-firestore';
import type {Firestore} from "firebase-admin/firestore";
const price={ticker:"MU",market:"US",tradingDate:"2026-09-18",close:100,currency:"USD",source:"test",loadedAt:"now"};
test('bulk latest pointers preserve newer closes and exchange-specific listings',async()=>{
 const f=pubsubFirestore(),collection=f.db.collection.bind(f.db);let queries=0;
 f.rows.set('tickers/US_MU',{symbol:'MU',country:'United States',currency:'USD',latestEodPrice:{...price,tradingDate:'2026-09-21'}});
 f.rows.set('tickers/US_AMD',{symbol:'AMD',country:'United States',currency:'USD'});
 f.rows.set('tickers/OTHER_AMD',{symbol:'AMD',country:'Canada',currency:'CAD'});
 f.db.collection=((name:string)=>({...collection(name),where:(_key:string,_op:string,symbols:string[])=>({get:async()=>{
   queries++;return {docs:await Promise.all([...f.rows.entries()].filter(([path,row])=>path.startsWith(name+'/')&&symbols.includes(String(row.symbol)))
    .map(async([path])=>{const ref=collection(name).doc(path.split('/')[1]);return {...await ref.get(),ref};}))};
 }})})) as typeof f.db.collection;
 await saveLatestEodPrices(f.db,[price,{...price,ticker:'AMD'},{...price,ticker:'NEW'}]);
 assert.equal(queries,1);
 assert.equal((f.rows.get('tickers/US_MU')?.latestEodPrice as typeof price).tradingDate,'2026-09-21');
 assert.equal((f.rows.get('tickers/US_AMD')?.latestEodPrice as typeof price).close,100);
 assert.equal(f.rows.get('tickers/OTHER_AMD')?.latestEodPrice,undefined);
 assert.equal(f.rows.get('tickers/US_NEW')?.predictionSupported,false);
 const writes=f.writes.length;await saveLatestEodPrices(f.db,[price,{...price,ticker:'AMD'}]);assert.equal(f.writes.length,writes);
});
test("latest prices accept same-date corrections but never roll backward or mix markets",()=>{
 assert.equal(shouldReplaceLatest(price,{...price,tradingDate:"2026-09-17"}),false);
 assert.equal(shouldReplaceLatest(price,{...price,close:101}),true);
 assert.equal(shouldReplaceLatest(price,{...price,tradingDate:"2026-09-21"}),true);
 assert.equal(shouldReplaceLatest(price,{...price,market:"FX"}),false);
 assert.equal(shouldReplaceLatest(undefined,{...price,close:NaN}),false);
 assert.equal(shouldReplaceLatest(price,{...price}),false);
 assert.equal(shouldReplaceLatest(price,{...price,loadedAt:"later"}),true);
});

test("duplicate ticker inputs use a single query batch",async()=>{
 let queries=0;
 const db={collection:()=>({where:(_field:string,_op:string,ids:string[])=>{
  queries++;assert.deepEqual(ids,["MU"]);
  return {select:()=>({get:async()=>({docs:[{data:()=>({latestEodPrice:price})}]})})};
 }})} as unknown as Firestore;
 assert.equal((await readLatestUsPrices(db,Array(61).fill("MU"))).size,1);
 assert.equal(queries,1);
});

test("latest price writes reuse query snapshots and skip identical payloads",async()=>{
 let reads=0,writes=0;
 let current={...price};
 const ref={id:"MU",path:"tickers/MU",get:async()=>{reads++;throw Error("Redundant read");},
  update:async(value:{latestEodPrice:typeof price},condition:unknown)=>{
   assert.deepEqual(condition,{lastUpdateTime:"query-version"});writes++;current=value.latestEodPrice;
  }};
 const db={collection:()=>({where:()=>({get:async()=>({docs:[{ref,exists:true,updateTime:"query-version",data:()=>({currency:"USD",country:"United States",latestEodPrice:current})}]})})})} as unknown as Firestore;
 await saveLatestEodPrice(db,price);
 assert.equal(writes,0);
 await saveLatestEodPrice(db,{...price,close:101});
 assert.equal(writes,1);assert.equal(reads,0);
});

test("a stale query snapshot is reread after a write conflict",async t=>{
 t.mock.method(console,"warn",()=>{});
 let reads=0,writes=0;
 const ref={id:"MU",path:"tickers/MU",get:async()=>{reads++;return {exists:true,updateTime:"new-version",data:()=>({latestEodPrice:{...price,tradingDate:"2026-09-21"}})};},
  update:async()=>{writes++;throw Object.assign(new Error("changed"),{code:9});}};
 const db={collection:()=>({where:()=>({get:async()=>({docs:[{ref,exists:true,updateTime:"old-version",data:()=>({currency:"USD",country:"United States",latestEodPrice:{...price,tradingDate:"2026-09-17"}})}]})})})} as unknown as Firestore;
 await saveLatestEodPrice(db,price);
 assert.equal(reads,1);assert.equal(writes,1);
});
test("market-cap price reads use ticker snapshots, never price history",async()=>{
 const db={collection:(name:string)=>{assert.equal(name,"tickers");return {where:()=>({select:()=>({get:async()=>({docs:[{data:()=>({latestEodPrice:price})},{data:()=>({latestEodPrice:{...price,market:"FX",close:7}})}]})})})};}} as unknown as Firestore;
 assert.equal((await readLatestUsPrices(db,["MU"])).get("MU")?.close,100);
});
test("a conflicting writer's newer price survives a retried version-checked write",async t=>{
 t.mock.method(console,"warn",()=>{});
 let current={...price,market:"FX",ticker:"USD_CNY",tradingDate:"2026-09-17"};
 let writes=0;
 const ref={id:"FX_USD_CNY",get:async()=>({exists:true,updateTime:"version1",data:()=>({latestEodPrice:current})}),
 update:async(_v:unknown,precondition:unknown)=>{assert.deepEqual(precondition,{lastUpdateTime:"version1"});writes++;current={...current,tradingDate:"2026-09-21"};throw Object.assign(new Error("changed"),{code:9});}};
 const db={collection:()=>({doc:()=>ref})} as unknown as Firestore;
 await saveLatestEodPrice(db,{...current,tradingDate:"2026-09-18"});
 assert.equal(writes,1);
 assert.equal(current.tradingDate,"2026-09-21");
});

test("bulk catalog snapshots guard the page and only a conflicting page is reread", async () => {
  for (const conflict of [false, true]) {
    const f = pubsubFirestore(), ref = f.db.collection("tickers").doc("US_MU");
    const current = {...price, tradingDate: "2026-09-21"};
    f.rows.set(ref.path, {symbol: "MU", country: "United States", currency: "USD"});
    const catalog = {ref, updateTime: "catalog-version", get: (field: string) => f.rows.get(ref.path)?.[field]};
    const collection = f.db.collection.bind(f.db);
    f.db.collection = ((name: string) => ({...collection(name), where: () => ({get: async () => ({docs: [catalog]})})})) as unknown as typeof f.db.collection;
    let transactionReads = 0, commits = 0;
    const transaction = f.db.runTransaction.bind(f.db);
    f.db.runTransaction = ((...args: Parameters<typeof transaction>) => {
      transactionReads++;
      return transaction(...args);
    }) as typeof transaction;
    f.db.batch = (() => ({
      update: (target: typeof ref, patch: unknown, condition: unknown) => {
        assert.equal(target.path, ref.path);
        assert.deepEqual(patch, {latestEodPrice: price});
        assert.deepEqual(condition, {lastUpdateTime: "catalog-version"});
      },
      commit: async () => {
        commits++;
        f.rows.set(ref.path, {...f.rows.get(ref.path), latestEodPrice: conflict ? current : price});
        if (conflict) throw Object.assign(new Error("version changed"), {code: 9});
      },
    })) as unknown as typeof f.db.batch;
    await saveLatestEodPrices(f.db, [price]);
    assert.equal(commits, 1);
    assert.equal(transactionReads, conflict ? 1 : 0);
    assert.deepEqual(f.rows.get(ref.path)?.latestEodPrice, conflict ? current : price);
  }
});
