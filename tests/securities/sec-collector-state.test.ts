import { test } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { secCollectorBridge } from "../../src/lib/sec-collector-state";

function fixture() {
  let retired = false, reads = 0, fail = false;
  const db = { collection: () => ({ doc: () => ({ get: async () => {
    reads++;
    if (fail) throw new Error("unavailable");
    return { get: () => retired };
  } }) }) } as unknown as Firestore;
  return { db, retire: () => { retired = true; }, fail: (value: boolean) => { fail = value; }, reads: () => reads };
}

test("active bridge is rechecked, retired bridge is retained per Firestore client", async () => {
  const f = fixture();
  assert.equal(await secCollectorBridge(f.db), true);
  f.retire();
  assert.equal(await secCollectorBridge(f.db), false);
  for (let i = 0; i < 100; i++) assert.equal(await secCollectorBridge(f.db), false);
  assert.equal(f.reads(), 2);
  assert.equal(await secCollectorBridge(fixture().db), true);
});

test("concurrent bridge reads share one request", async () => {
  const f = fixture();
  f.retire();
  assert.deepEqual(await Promise.all(Array.from({ length: 30 }, () => secCollectorBridge(f.db))), Array(30).fill(false));
  assert.equal(f.reads(), 1);
});

test("failed bridge reads are retried without assuming retirement", async () => {
  const f = fixture();
  f.fail(true);
  await assert.rejects(secCollectorBridge(f.db), /unavailable/);
  f.fail(false);
  assert.equal(await secCollectorBridge(f.db), true);
  assert.equal(f.reads(), 2);
});
