import { test } from "node:test";
import assert from "node:assert/strict";
import { createSecBudget, secCooldownMs } from "../../src/lib/sec-budget";
import { sharedFirestore } from "./shared-firestore-fixture";

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
  f.documents.set("company_fundamentals/_sec_request_budget", { leaseUntil: f.now() + 30_000 });
  const budget = createSecBudget(f.db, async () => { controller.abort(); controller.signal.throwIfAborted(); });
  await assert.rejects(budget.run(controller.signal, async () => { calls++; }), { name: "AbortError" });
  f.db.runTransaction = async () => { throw new Error("database unavailable"); };
  await assert.rejects(budget.run(new AbortController().signal, async () => { calls++; }), /database unavailable/);
  assert.equal(calls, 0);
});

test("abandoned leases recover only after expiry and error paths release ownership", async () => {
  const f = sharedFirestore();
  f.documents.set("company_fundamentals/_sec_request_budget", { owner: "dead-worker", leaseUntil: f.now() + 30_000 });
  const before = f.now();
  const budget = createSecBudget(f.db, async ms => { f.advance(ms); });
  await assert.rejects(budget.run(new AbortController().signal, async () => {
    assert.ok(f.now() >= before + 30_000);
    throw new Error("decode failure");
  }), /decode failure/);
  assert.equal(f.documents.get("company_fundamentals/_sec_request_budget")!.owner, null);
});

test("403/429 cooldowns respect Retry-After seconds and dates", () => {
  assert.equal(secCooldownMs(403, null), 600_000);
  assert.equal(secCooldownMs(429, "120"), 120_000);
  assert.equal(secCooldownMs(429, "bad"), 60_000);
  assert.equal(secCooldownMs(429, new Date(300_000).toUTCString(), 100_000), 200_000);
  assert.equal(secCooldownMs(500, "120"), 0);
});
