import { test } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { auditMapFundamentals, drainFundamentalsQueue, seedMapFundamentals, usMapTickers } from "../../src/lib/fundamentals/batch";
import type { MaintenanceLog } from "../../src/lib/maintenance-log";

test("all US map nodes, including ADRs and share classes, are cached or requested", async () => {
  const tickers = usMapTickers({ nodes: [
    {id:"US:NVDA",kind:"COMPANY",order:0}, {id:"US:TSM",kind:"COMPANY",country:"TW",order:1},
    {id:"US:BRK.B",kind:"COMPANY",order:2}, {id:"US:NVDA",kind:"COMPANY",order:3},
    {id:"XSHG:688041",kind:"COMPANY",order:4}, {id:"ORG:OPENAI",kind:"COMPANY",order:5},
    {id:"stage:compute",kind:"STAGE",order:6},
  ] });
  assert.deepEqual(tickers, ["BRK.B", "NVDA", "TSM"]);
  const data = new Map<string, Record<string, unknown>>([
    ["NVDA", {version:1, value:{fetchedAt:new Date().toISOString(),shareAssessment:{basis:null,reason:"unsupported"}}, refreshAfter:Date.now()+86400000}],
  ]);
  const snapshot = (ref: {id:string}) => ({id:ref.id, data:()=>data.get(ref.id)});
  const db = {
    collection: () => ({doc:(id:string)=>({id,get:async()=>snapshot({id})})}),
    getAll: async (...refs: {id:string}[]) => refs.map(snapshot),
    runTransaction: async (fn:(tx:unknown)=>Promise<unknown>) => fn({
      get: async (ref:{id:string})=>snapshot(ref),
      set: (ref:{id:string}, value:Record<string,unknown>)=>data.set(ref.id,{...data.get(ref.id),...value}),
    }),
  } as unknown as Firestore;
  await assert.rejects(auditMapFundamentals(db, tickers), /coverage missing/);
  const coverage = await seedMapFundamentals(db, tickers);
  assert.deepEqual(coverage, {companies:3,cached:1,pending:2,unavailable:0,missing:[]});
  assert.deepEqual(await seedMapFundamentals(db, tickers), coverage);
  assert.ok(data.get("BRK.B")?.requestedAt);
  assert.ok(data.get("TSM")?.requestedAt);
});

function queueFixture(data: Map<string, Record<string, unknown>>) {
  const db = { collection: () => ({
    doc: (id:string) => ({ get:async()=>({get:(key:string)=>data.get(id)?.[key]}), set:async(value:Record<string,unknown>)=>{data.set(id,{...data.get(id),...value});} }),
    where: () => {
    let after = "", limit = Infinity;
    const rows = () => [...data].filter(([id, value]) => value.pending === true && id > after).sort(([a],[b]) => a.localeCompare(b));
    const query = {
      orderBy: () => query, startAfter: (value: string) => { after = value; return query; },
      limit: (value: number) => { limit = value; return query; },
      count: () => ({get:async()=>({data:()=>({count:rows().length})})}),
      get: async () => { const docs = rows().slice(0,limit).map(([id,value])=>({id,data:()=>value})); return {docs,size:docs.length,empty:!docs.length}; },
    };
    return query;
  } }) } as unknown as Firestore;
  const log = {emit:()=>undefined} as unknown as MaintenanceLog;
  return {db,log};
}

test("fresh legacy fundamentals reach the share upgrade worker while completed assessments and retry cooldowns wait", async () => {
  const data = new Map<string,Record<string,unknown>>([
    ["AMD", {pending:true,value:{fetchedAt:"2026-09-21"},refreshAfter:Date.now()+86400000}],
    ["MU", {pending:true,outcome:"ready",value:{shareAssessment:{basis:null,reason:"unsupported"}},refreshAfter:Date.now()+86400000}],
    ["NVDA", {pending:true,outcome:"retry",value:{fetchedAt:"2026-09-21"},refreshAfter:Date.now()+3600000}],
  ]);
  const {db,log}=queueFixture(data);
  const refreshed:string[]=[];
  const result=await drainFundamentalsQueue(db,log,Date.now()+10000,async ticker=>{refreshed.push(ticker);data.set(ticker,{pending:false});return null;});
  assert.deepEqual(refreshed,["AMD"]);
  assert.equal(result.processed,1);
  assert.equal(result.deferred,2);
  assert.equal(result.failed,1);
});

test("queue pagination does not skip requests when completed entries disappear", async () => {
  const data = new Map(Array.from({length:105},(_,i)=>[`T${String(i).padStart(3,"0")}`,{pending:true}]));
  const {db,log} = queueFixture(data);
  const result = await drainFundamentalsQueue(db,log,Date.now()+10000,async ticker=>{data.set(ticker,{pending:false});return null;});
  assert.equal(result.processed,105);
  assert.equal(result.remaining,0);
});

test("rate-limit responses stop the batch and leave untouched requests queued", async () => {
  const data = new Map<string,Record<string,unknown>>([ ["AMD",{pending:true}], ["MU",{pending:true}] ]);
  const {db,log} = queueFixture(data);
  let calls=0;
  const result=await drainFundamentalsQueue(db,log,Date.now()+10000,async()=>{calls++;throw Object.assign(new Error("SEC status 429"),{code:429});});
  assert.equal(calls,1);
  assert.equal(result.failed,1);
  assert.equal(result.remaining,2);
  data.set("AAPL",{pending:true});
  const retried=await drainFundamentalsQueue(db,log,Date.now()+10000,async()=>{calls++;return null;});
  assert.equal(calls,1);
  assert.equal(retried.failed,1);
  assert.equal(retried.remaining,3);
});

test("a saved per-company SEC block stops a retry before other queued tickers", async () => {
  const data=new Map<string,Record<string,unknown>>([
    ["AMD",{pending:true,outcome:"retry",refreshAfter:Date.now()+3600000,lastError:{code:403}}],
    ["MU",{pending:true}],
  ]);
  const {db,log}=queueFixture(data);
  let calls=0;
  const result=await drainFundamentalsQueue(db,log,Date.now()+10000,async()=>{calls++;return null;});
  assert.equal(calls,0);
  assert.equal(result.failed,1);
  assert.ok(Number(data.get("_worker")?.providerRetryAfter)>Date.now());
});

test("a retry during provider cooldown still reports the unresolved failure", async () => {
  const data = new Map([ ["AMD",{pending:true,outcome:"retry",refreshAfter:Date.now()+3600000}] ]);
  const {db,log} = queueFixture(data);
  const result=await drainFundamentalsQueue(db,log,Date.now()+10000,async()=>{throw Error("should not fetch during cooldown");});
  assert.equal(result.failed,1);
  assert.equal(result.deferred,1);
  assert.equal(result.remaining,1);
});
