import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecBudget, secCooldownMs } from "../../src/lib/sec-budget";
import { sharedFirestore as baseFirestore } from "./shared-firestore-fixture";

function sharedFirestore(){const f=baseFirestore();f.documents.set("sec_collector_state/_sec_request_budget",{bridgeRetired:true});return f;}

test("migration honors the legacy cooldown and writes only operational state", async () => {
  const f = sharedFirestore();
  f.documents.delete("sec_collector_state/_sec_request_budget");
  const legacy = { cooldownUntil: f.now() + 60_000 };
  f.documents.set("company_fundamentals/_sec_request_budget", legacy);
  let calls = 0;
  const budget = createSecBudget(f.db, async ms => { f.advance(ms); });
  await assert.rejects(budget.run(new AbortController().signal, async () => { calls++; }), { code: 429 });
  assert.equal(calls, 0);
  f.advance(60_000);
  await budget.run(new AbortController().signal, async () => { calls++; });
  assert.equal(calls, 1);
  assert.equal(f.documents.get("company_fundamentals/_sec_request_budget")?.owner, null);
  assert.equal(f.documents.get("sec_collector_state/_sec_request_budget")?.owner, null);
});
test("held SEC lease uses bounded backoff and still checks ownership before sending",async()=>{
  const f=sharedFirestore(),start=f.now(),waits:number[]=[];
  f.documents.set('sec_collector_state/_sec_request_budget',{bridgeRetired:true,owner:'other',leaseUntil:start+5000});
  await createSecBudget(f.db,async(ms,signal)=>{signal.throwIfAborted();waits.push(ms);f.advance(ms);},()=>0)
    .run(new AbortController().signal,async()=>{assert.ok(f.now()>=start+5000);});
  assert.deepEqual(waits,[1000,2000,2000,200]);
  assert.equal(f.documents.get('sec_collector_state/_sec_request_budget')?.nextAllowedAt,start+5200);
});

test("bridge serializes with legacy workers, then retirement stops legacy writes",async()=>{
 const f=baseFirestore(),old='company_fundamentals/_sec_request_budget',next='sec_collector_state/_sec_request_budget';
 f.documents.set(old,{owner:'legacy',leaseUntil:f.now()+500});
 const budget=createSecBudget(f.db,async ms=>{f.advance(ms);});
 const start=f.now();
 await budget.run(new AbortController().signal,async()=>{
  assert.ok(f.now()>=start+500);
  assert.equal(f.documents.get(old)?.owner,f.documents.get(next)?.owner);
 });
 const legacy=structuredClone(f.documents.get(old));
 f.documents.set(next,{...f.documents.get(next),bridgeRetired:true});
 await budget.run(new AbortController().signal,async()=>{});
 assert.deepEqual(f.documents.get(old),legacy);
});

test("independent workers share a maximum of five starts in any rolling second", async () => {
  const f = sharedFirestore();
  const sleep = async (ms: number, signal: AbortSignal) => { signal.throwIfAborted(); f.advance(ms); };
  const workers = [createSecBudget(f.db, sleep), createSecBudget(f.db, sleep)];
  const starts: number[] = [];
  let active = 0;
  await Promise.all(Array.from({ length: 20 }, (_, i) => workers[i % 2].run(new AbortController().signal, async () => {
    assert.equal(active++, 0);
    starts.push(f.now());
    await Promise.resolve();
    active--;
  })));
  assert.equal(starts.length, 20);
  starts.forEach((time, i) => {
    if (i) assert.ok(time - starts[i - 1] >= 200);
    assert.ok(starts.filter(start => start >= time && start < time + 1000).length <= 5);
  });
});

test("provider cooldown is shared with other workers and survives the failed call", async () => {
  const f = sharedFirestore();
  await assert.rejects(createSecBudget(f.db).run(new AbortController().signal, async cooldown => {
    cooldown(60_000);
    throw new Error("provider 429");
  }), /provider 429/);
  let calls = 0;
  await assert.rejects(createSecBudget(f.db).run(new AbortController().signal, async () => { calls++; }), { code: 429 });
  assert.equal(calls, 0);
  f.advance(60_000);
  await createSecBudget(f.db).run(new AbortController().signal, async () => { calls++; });
  assert.equal(calls, 1);
});

test("coordination failure and aborted waits never reach the provider", async () => {
  const f = sharedFirestore();
  let calls = 0;
  const controller = new AbortController();
  f.documents.set("sec_collector_state/_sec_request_budget", { bridgeRetired:true, leaseUntil: f.now() + 30_000 });
  const budget = createSecBudget(f.db, async () => { controller.abort(); controller.signal.throwIfAborted(); });
  await assert.rejects(budget.run(controller.signal, async () => { calls++; }), { name: "AbortError" });
  f.db.runTransaction = async () => { throw new Error("database unavailable"); };
  await assert.rejects(budget.run(new AbortController().signal, async () => { calls++; }), /database unavailable/);
  assert.equal(calls, 0);
});

test("abandoned leases recover only after expiry and error paths release ownership", async () => {
  const f = sharedFirestore();
  f.documents.set("sec_collector_state/_sec_request_budget", { bridgeRetired:true, owner: "dead-worker", leaseUntil: f.now() + 30_000 });
  const before = f.now();
  const budget = createSecBudget(f.db, async ms => { f.advance(ms); });
  await assert.rejects(budget.run(new AbortController().signal, async () => {
    assert.ok(f.now() >= before + 30_000);
    throw new Error("decode failure");
  }), /decode failure/);
  assert.equal(f.documents.get("sec_collector_state/_sec_request_budget")!.owner, null);
});

test("403/429 cooldowns respect Retry-After seconds and dates", () => {
  assert.equal(secCooldownMs(403, null), 600_000);
  assert.equal(secCooldownMs(429, "120"), 120_000);
  assert.equal(secCooldownMs(429, "bad"), 60_000);
  assert.equal(secCooldownMs(429, new Date(300_000).toUTCString(), 100_000), 200_000);
  assert.equal(secCooldownMs(500, "120"), 0);
});


test("sequential requests do not reread the gate for their own spacing", async () => {
 const f=sharedFirestore();let transactions=0;
 const original=f.db.runTransaction.bind(f.db);
 f.db.runTransaction=((...args:Parameters<typeof f.db.runTransaction>)=>{
   transactions++;
   return original(...args);
 }) as typeof f.db.runTransaction;
 const starts:number[]=[];
 for(let i=0;i<3;i++)await createSecBudget(f.db,async ms=>{f.advance(ms);})
   .run(new AbortController().signal,async()=>{starts.push(f.now());});
 assert.equal(transactions,6); // One acquisition and one ownership-checked release each.
 assert.deepEqual(starts,[1000000,1000200,1000400]);
});


test("contended requests bound reads while preserving shared cooldown checks", async () => {
  const f = sharedFirestore(), key = "sec_collector_state/_sec_request_budget";
  f.documents.set(key, { bridgeRetired: true, owner: "other", leaseUntil: f.now() + 30_000 });
  let transactions = 0, calls = 0;
  const original = f.db.runTransaction.bind(f.db);
  f.db.runTransaction = ((...args: Parameters<typeof f.db.runTransaction>) => {
    transactions++;
    return original(...args);
  }) as typeof f.db.runTransaction;
  const waits: number[] = [];
  const budget = createSecBudget(f.db, async ms => {
    waits.push(ms); f.advance(ms);
    if (waits.length === 2) f.documents.set(key, {
      bridgeRetired: true, owner: null, leaseUntil: 0, cooldownUntil: f.now() + 60_000,
    });
  }, () => 0.5);
  await assert.rejects(budget.run(new AbortController().signal, async () => { calls++; }), { code: 429 });
  assert.deepEqual(waits, [1500, 3000]);
  assert.equal(transactions, 3);
  assert.equal(calls, 0);
});

test("spacing waits are exact even with maximum contention jitter", async () => {
  const f = sharedFirestore(), waits: number[] = [];
  f.documents.set("sec_collector_state/_sec_request_budget", {
    bridgeRetired: true, nextAllowedAt: f.now() + 200,
  });
  await createSecBudget(f.db, async ms => { waits.push(ms); f.advance(ms); }, () => 1)
    .run(new AbortController().signal, async () => {});
  assert.deepEqual(waits, [200, 200]);
});
