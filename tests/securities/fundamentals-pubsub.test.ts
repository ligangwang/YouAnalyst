import { rerunFundamentalsBatch } from '../../src/lib/fundamentals/admin-rerun';
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import type { MaintenanceLog } from "../../src/lib/maintenance-log";
import { processFundamentalsBatch, publishPendingFundamentals, verifyFundamentalsDelivery } from "../../src/lib/fundamentals/pubsub-batch";
import { fundamentalsVersion, parseFundamentalsRequest, type FundamentalsRequest, type FundamentalsUpdate } from "../../src/lib/fundamentals/pubsub";
import { liveCompanyReads } from '../../src/lib/local-cache/company-directory';

type Data = Record<string, unknown>;
function fixture(initial: Record<string, Data> = {}, staleLedger = false) {
  const rows = new Map<string, Data>(Object.entries(initial));
  const snap = (id: string) => ({ id, ref:ref(id), data: () => rows.has(id) ? structuredClone(rows.get(id)) : undefined,
    get: (key: string) => rows.get(id)?.[key] });
  const ref = (id: string) => ({ id, firestore: db, get: async () => staleLedger && id.startsWith('_batch_') && !liveCompanyReads()
    ? { ...snap(id), data: () => undefined, get: () => undefined } : snap(id),
    set: async (data: Data) => { rows.set(id, { ...rows.get(id), ...data }); },
    create: async (data: Data) => { assert.ok(!rows.has(id)); rows.set(id, data); } });
  const db = { collection: () => ({ doc: ref, where: (field: string, _operator: string, value: unknown) => {
    let after = "", lower = "", upper = "\uffff", limit = 100;
    const q = { orderBy: () => q, startAt: (v:string) => {lower=v;return q;}, endBefore: (v:string) => {upper=v;return q;}, startAfter: (v: string) => { after = v; return q; }, limit: (v: number) => { limit = v; return q; },
      get: async () => { const docs = [...rows].filter(([id, d]) => d[field] === value && id > after && id >= lower && id < upper).sort(([a], [b]) => a.localeCompare(b))
        .slice(0, limit).map(([id]) => snap(id)); return { docs, size: docs.length }; } };
    return q;
  } }), runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ get: async (r: ReturnType<typeof ref>) => r.get(),
    set: (r: ReturnType<typeof ref>, data: Data) => r.set(data), update: (r: ReturnType<typeof ref>, data: Data) => r.set(data) }) } as unknown as Firestore;
  const events: FundamentalsUpdate[] = [], calls: string[] = [];
  const logs: Data[] = [];
  const log = { runId: "attempt-1", emit: (_level: string, event: string, data: Data) => logs.push({ event, ...data }) } as unknown as MaintenanceLog;
  const refresh = async (ticker: string) => { calls.push(ticker); rows.set(`US:${ticker}`, { pending: false, outcome: "ready", value: { metrics: { revenue: 10 }, fetchedAt: new Date().toISOString() } }); return null; };
  const marketCaps = async () => ({ processed: 0, failed: 0 });
  const publish = async (e: FundamentalsUpdate) => { events.push(e); };
  return { rows, db, log, events, calls, logs, refresh, marketCaps, publish };
}
const request = (companyIds = ["AMD", "NVDA"]): FundamentalsRequest => ({ version: 1, type: "fundamentals.refresh.requested",
  batchId: "batch-1", companyIds, reason: "scheduled_or_manual", requestedAt: "2026-09-27T00:00:00Z" });

test("batch validation rejects empty, oversized, duplicate and unsafe company lists", () => {
  for (const ids of [[], ["AMD", "AMD"], ["../_worker"], Array.from({ length: 21 }, (_, i) => `T${i}`)]) {
    assert.throws(() => parseFundamentalsRequest(request(ids)));
  }
  assert.throws(() => parseFundamentalsRequest({ ...request(), batchId: "../x" }));
  assert.deepEqual(parseFundamentalsRequest(request()), request());
});
test("batch publisher chunks all eligible companies and leaves fresh caches deferred", async () => {
  const f = fixture(Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`US:T${String(i).padStart(3, "0")}`, { pending: true }])));
  f.rows.set("US:FRESH", { pending: true, refreshAfter: Date.now() + 86400000 });
  const messages: FundamentalsRequest[] = [];
  const result = await publishPendingFundamentals(f.db, "run-1", async r => { messages.push(r); }, f.log);
  assert.equal(result.requested, 45);
  assert.deepEqual(messages.map(m => m.companyIds.length), Array(45).fill(1));
  assert.equal(new Set(messages.flatMap(m => m.companyIds)).size, 45);
  assert.ok(messages.every(m => f.rows.has(`_batch_${m.batchId}`)));
});
test("redelivery skips completed companies and duplicate result publication", async () => {
  const f = fixture();
  const a = await processFundamentalsBatch(request(), f.db, f.log, f.publish, f);
  const b = await processFundamentalsBatch(request(), f.db, f.log, f.publish, f);
  assert.equal(a.completed, 2); assert.equal("duplicate" in b && b.duplicate, true);
  assert.deepEqual(f.calls, ["AMD", "NVDA"]); assert.equal(f.events.length, 1);
});
test('duplicate verification uses authoritative ledger reads even when the snapshot is stale', async () => {
  const f = fixture(Object.fromEntries(['AMD','NVDA'].map(ticker => [`US:${ticker}`, {outcome:'ready',pending:false,value:{metrics:{revenue:10}}}])), true);
  const probe = {...request(),reason:'verification' as const};
  assert.equal((await processFundamentalsBatch(probe, f.db, f.log, f.publish, f)).completed, 2);
  const result = await processFundamentalsBatch(probe, f.db, {...f.log,runId:'00000000-0000-0000-0000-000000000002'}, f.publish, f);
  assert.equal('duplicate' in result && result.duplicate, true);
  assert.equal(f.rows.get('_batch_batch-1')?.verificationDuplicateRunId, '00000000-0000-0000-0000-000000000002');
  assert.equal(f.rows.get('_batch_batch-1')?.manualRequired, false);
  assert.equal(f.rows.get('US:AMD')?.outcome, 'ready');
});
test('failed verification records the batch for admin without changing cached companies', async () => {
  const f = fixture({ 'US:AMD': {outcome:'ready',pending:false,value:{metrics:{revenue:10}}}, _worker:{leaseExpiresAtMs:Date.now()+60000} });
  const before = structuredClone(f.rows.get('US:AMD'));
  const result = await processFundamentalsBatch({...request(['AMD']),reason:'verification'}, f.db, f.log, f.publish, f);
  assert.equal(result.status, 'needs_admin');
  assert.deepEqual(f.rows.get('US:AMD'), before);
  assert.equal(f.rows.get('_batch_batch-1')?.manualRequired, true);
});
test('verification does not rewrite an already failed company', async () => {
  const f=fixture({'US:AMD':{outcome:'retry',pending:true,lastError:{message:'existing failure'}}});
  const before=structuredClone(f.rows.get('US:AMD'));
  const result=await processFundamentalsBatch({...request(['AMD']),reason:'verification'},f.db,f.log,f.publish,f);
  assert.equal(result.status,'needs_admin');
  assert.deepEqual(f.rows.get('US:AMD'),before);
});
test('admin rerun repairs only company errors proven to be from the completed duplicate probe', async () => {
  const probe = {...request(['AMD']),reason:'verification' as const};
  const value = {metrics:{revenue:10}};
  const message = '6 ALREADY_EXISTS: Document already exists: projects/p/databases/(default)/documents/company_fundamentals/_batch_batch-1';
  const f = fixture({ 'US:AMD':{outcome:'error',pending:false,value,lastError:{message}},
    '_batch_batch-1':{request:probe,manualRequired:true,completed:true,result:{status:'verified'},lastError:{code:6,message},progress:{AMD:{completed:true,version:fundamentalsVersion(value)}}} });
  let sent: FundamentalsRequest | undefined;
  assert.equal(await rerunFundamentalsBatch(f.db,'batch-1','admin',async r=>{sent=r;}),true);
  assert.equal(f.rows.get('US:AMD')?.outcome,'ready');
  assert.equal(f.rows.get('_batch_batch-1')?.completed,true);
  assert.deepEqual(sent,probe);
  const duplicate = await processFundamentalsBatch(sent,f.db,{...f.log,runId:'00000000-0000-0000-0000-000000000003'},f.publish,f);
  assert.equal('duplicate' in duplicate && duplicate.duplicate,true);
  assert.deepEqual(f.calls,[]);
});
test('admin verification rerun refuses to overwrite unrelated company failures', async () => {
  const probe = {...request(['AMD']),reason:'verification' as const};
  const value={metrics:{revenue:10}}, message='6 ALREADY_EXISTS: /company_fundamentals/_batch_batch-1';
  const f=fixture({'US:AMD':{outcome:'error',pending:false,value,lastError:{message:'different failure'}},
    '_batch_batch-1':{request:probe,manualRequired:true,completed:true,result:{status:'verified'},lastError:{code:6,message},progress:{AMD:{completed:true,version:fundamentalsVersion(value)}}} });
  await assert.rejects(rerunFundamentalsBatch(f.db,'batch-1','admin',async()=>{}),/review company failures/);
  assert.equal(f.rows.get('US:AMD')?.outcome,'error');
  assert.equal(f.rows.get('_batch_batch-1')?.manualRequired,true);
});
test('verification retry with a publish failure restores the admin hold without changing healthy companies', async () => {
  const probe={...request(['AMD']),reason:'verification' as const};
  const company={outcome:'ready',pending:false,value:{metrics:{revenue:10}}};
  const f=fixture({'US:AMD':company,'_batch_batch-1':{request:probe,manualRequired:true,progress:{}}});
  await assert.rejects(rerunFundamentalsBatch(f.db,'batch-1','admin',async()=>{throw Error('offline');}),/offline/);
  assert.deepEqual(f.rows.get('US:AMD'),company);
  assert.equal(f.rows.get('_batch_batch-1')?.manualRequired,true);
});
test("partial failure publishes successful changes and holds failures for admin", async () => {
 const f=fixture();const refresh=async(ticker:string)=>{if(ticker==='NVDA')throw Error('temporary failure');return f.refresh(ticker);};
 const result=await processFundamentalsBatch(request(),f.db,f.log,f.publish,{...f,refresh});
 assert.equal(result.failed,1);assert.equal(result.remaining,0);
 assert.deepEqual(f.events[0].companyIds,['AMD']);
 await processFundamentalsBatch(request(),f.db,f.log,f.publish,f);
 assert.deepEqual(f.calls,['AMD']);assert.equal(f.rows.get('US:NVDA')?.outcome,'error');
});

test("result publish failure resumes the durable outbox without another SEC fetch", async () => {
  const f = fixture();
  assert.equal((await processFundamentalsBatch(request(), f.db, f.log, async () => { throw new Error("publish outage"); }, f)).status,'needs_admin');
  await processFundamentalsBatch(request(),f.db,f.log,f.publish,f);assert.equal(f.events.length,0);
  assert.equal(await rerunFundamentalsBatch(f.db,'batch-1','admin',async()=>{}),true);
  await processFundamentalsBatch(request(), f.db, f.log, f.publish, f);
  assert.equal(f.calls.length, 2); assert.equal(f.events.length, 1);
});
test("an exception after saving data is retained for admin without automatic re-execution", async () => {
 const f=fixture();const refresh=async(ticker:string)=>{await f.refresh(ticker);throw Error('interrupted after save');};
 const result=await processFundamentalsBatch(request(['AMD']),f.db,f.log,f.publish,{...f,refresh});
 assert.equal(result.failed,1);assert.ok(f.rows.get('US:AMD')?.value);
 await processFundamentalsBatch(request(['AMD']),f.db,f.log,f.publish,{...f,refresh});
 assert.equal(f.calls.length,1);assert.equal(f.events.length,0);
});

test("freshness-only changes do not publish fundamentals.updated", async () => {
  const f = fixture({ "US:AMD": { value: { fetchedAt: "old", metrics: { revenue: 10 } } } });
  await processFundamentalsBatch(request(["AMD"]), f.db, f.log, f.publish, f);
  assert.equal(f.events.length, 0);
  assert.equal(fundamentalsVersion({ b: 2, a: 1 }), fundamentalsVersion({ a: 1, b: 2 }));
});
test("SEC provider blocks stop other companies and respect persisted cooldown", async () => {
  const f = fixture();
  const refresh = async () => { throw Object.assign(new Error("blocked"), { code: 429 }); };
  assert.equal((await processFundamentalsBatch(request(), f.db, f.log, f.publish, { ...f, refresh })).status,'needs_admin');
  assert.ok(Number(f.rows.get("_worker")?.providerRetryAfter) > Date.now());
  assert.equal((await processFundamentalsBatch(request(), f.db, f.log, f.publish, f)).status,'needs_admin');
  assert.equal(f.calls.length, 0);
});
test("delivery verification reuses stale cached data even during an SEC cooldown", async () => {
  const f = fixture({ "US:AMD": { outcome: "ready", pending: false, refreshAfter: 0, value: { metrics: { revenue: 10 } } },
    _worker: { providerRetryAfter: Date.now() + 3600000 } });
  const result = await processFundamentalsBatch({ ...request(["AMD"]), reason: "verification" }, f.db, f.log, f.publish, f);
  assert.equal(result.completed, 1); assert.equal(f.calls.length, 0); assert.equal(f.events.length, 0);
});
test("leased worker and exhausted time budget save errors for admin without redelivery", async () => {
  const f = fixture({ _worker: { leaseExpiresAtMs: Date.now() + 60000 } });
  assert.equal((await processFundamentalsBatch(request(), f.db, f.log, f.publish, f)).status,'needs_admin');
  assert.match(String((f.rows.get('_batch_batch-1')?.lastError as Data).message),/busy/);
  f.rows.delete("_worker");
  await rerunFundamentalsBatch(f.db,'batch-1','admin',async()=>{});
  assert.equal((await processFundamentalsBatch(request(), f.db, f.log, f.publish, { ...f, deadline: Date.now() })).status,'needs_admin');
  assert.match(String((f.rows.get('_batch_batch-1')?.lastError as Data).message),/incomplete/);
  assert.equal(f.calls.length, 0);
});
test("reusing a batch identifier with different contents is rejected", async () => {
  const f = fixture();
  await processFundamentalsBatch(request(), f.db, f.log, f.publish, f);
  await assert.rejects(processFundamentalsBatch(request(["MU"]), f.db, f.log, f.publish, f), /different contents/);
});

test("delivery probe waits for the completed duplicate receipt before reporting success", async () => {
  const f = fixture(Object.fromEntries(["AMD", "NVDA"].map(ticker => [`US:${ticker}`,
    { outcome: "ready", pending: false, value: { metrics: { revenue: 10 } } }])));
  let now = 0;
  let deliveries = 0;
  let duplicate: FundamentalsRequest | undefined;
  await verifyFundamentalsDelivery(f.db, "probe", async message => {
    deliveries++;
    if (deliveries === 1) await processFundamentalsBatch(message, f.db, f.log, f.publish, f);
    else duplicate = message;
  }, f.log, { now: () => now, sleep: async ms => {
    now += ms;
    assert.equal(f.logs.some(log => log.event === "pubsub_delivery_verified"), false);
    if (duplicate) await processFundamentalsBatch(duplicate, f.db,
      { ...f.log, runId: "00000000-0000-0000-0000-000000000002" }, f.publish, f);
  } });
  assert.equal(deliveries, 2);
  assert.equal(f.logs.at(-1)?.duplicateVerified, true);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.events, []);
});

test("confirmed republication without a duplicate delivery fails the probe", async () => {
  const f = fixture(Object.fromEntries(["AMD", "NVDA"].map(ticker => [`US:${ticker}`,
    { outcome: "ready", pending: false, value: { metrics: { revenue: 10 } } }])));
  let now = 0;
  let deliveries = 0;
  await assert.rejects(verifyFundamentalsDelivery(f.db, "probe", async message => {
    if (++deliveries === 1) await processFundamentalsBatch(message, f.db, f.log, f.publish, f);
  }, f.log, { now: () => now, sleep: async ms => { now += ms; } }), /confirm duplicate delivery/);
  assert.equal(deliveries, 2);
  assert.equal(f.logs.some(log => log.event === "pubsub_delivery_verified"), false);
});

 test('manual rerun is claimed once and failed publication remains visible',async()=>{
 const f=fixture({_worker:{providerRetryAfter:Date.now()+3600000}});
 await processFundamentalsBatch(request(),f.db,f.log,f.publish,f);
 assert.equal(f.rows.get('US:AMD')?.outcome,'error');
 await assert.rejects(rerunFundamentalsBatch(f.db,'batch-1','admin',async()=>{throw Error('offline');}),/offline/);
 assert.equal(f.rows.get('_batch_batch-1')?.manualRequired,true);
 let sent:FundamentalsRequest|undefined;
 assert.equal(await rerunFundamentalsBatch(f.db,'batch-1','admin',async r=>{sent=r;}),true);
 assert.deepEqual(sent,request());
 assert.equal(await rerunFundamentalsBatch(f.db,'batch-1','admin',async()=>{}),false);
 f.rows.delete('_worker');
 assert.equal((await processFundamentalsBatch(sent,f.db,f.log,f.publish,f)).completed,2);
 });
