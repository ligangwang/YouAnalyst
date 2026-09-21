import assert from "node:assert/strict";
import { test } from "node:test";
import type { Firestore, Transaction, DocumentReference } from "firebase-admin/firestore";
import { createMaintenanceLog, loggedTransaction, maintenanceError } from "../../src/lib/maintenance-log";
import { acquireMaintenanceLease, cloudRunTaskAttempt, releaseMaintenanceLease } from "../../src/lib/maintenance-lease";

test("transaction retries are distinct from commits and document bodies are never logged", async t => {
  const lines: string[] = [];
  t.mock.method(console, "info", (line: string) => lines.push(line));
  t.mock.method(console, "warn", (line: string) => lines.push(line));
  const tx = { get: async () => ({}), update: () => undefined } as unknown as Transaction;
  const db = { runTransaction: async (work: (tx: Transaction) => Promise<unknown>) => { await work(tx); return work(tx); } } as unknown as Firestore;
  await loggedTransaction(db, createMaintenanceLog("test"), {predictionId:"p1"}, async tx => {
    const ref = { path: "predictions/p1" } as DocumentReference;
    await tx.get(ref);
    tx.update(ref, { privateText: "never-log-this" });
  });
  const events = lines.map(line => JSON.parse(line));
  assert.equal(events.filter(e => e.message.endsWith("transaction_committed")).length, 1);
  assert.equal(events.find(e => e.message.endsWith("transaction_retry")).attempt, 2);
  assert.deepEqual(events.at(-1).documents, ["predictions/p1"]);
  assert.equal(events.at(-1).attempts, 2);
  assert.ok(!lines.join("").includes("never-log-this"));
});

test("commit contention retains context and original error, with credentials redacted", async t => {
  const lines: string[] = [];
  t.mock.method(console, "error", (line: string) => lines.push(line));
  const error = Object.assign(new Error("10 ABORTED: contention https://example.com/?api_token=secret-token"), { code: 10 });
  const tx = { get: async () => ({}) } as unknown as Transaction;
  const db = { runTransaction: async (work: (tx: Transaction) => Promise<unknown>) => { await work(tx); throw error; } } as unknown as Firestore;
  await assert.rejects(loggedTransaction(db, createMaintenanceLog("eod"), { predictionId:"p2" }, async tx => { await tx.get({path:"users/u2"} as DocumentReference); }), value => value === error);
  const event = JSON.parse(lines[0]);
  assert.equal(event.error.contention, true);
  assert.equal(event.lastOperation, "commit");
  assert.equal(event.predictionId, "p2");
  assert.deepEqual(event.documents, ["users/u2"]);
  assert.ok(event.error.stack);
  assert.ok(!lines.join("").includes("secret-token"));
  assert.equal(maintenanceError(new Error("permission denied")).contention, false);
});

test("directory lease rejects overlaps, recovers expiry, and only its owner releases it", async () => {
  let data: Record<string, unknown> = {};
  const tx = { get: async () => ({data:()=>data,get:(key:string)=>data[key]}), set: (_ref: unknown, values: Record<string, unknown>) => { data = {...data,...values}; } };
  const ref = {firestore:{runTransaction:async (work:(tx:unknown)=>Promise<unknown>)=>work(tx)}} as DocumentReference;
  assert.equal(await acquireMaintenanceLease(ref,"first",1000),true);
  assert.equal(await acquireMaintenanceLease(ref,"second",1001),false);
  await releaseMaintenanceLease(ref,"second");
  assert.equal(data.leaseOwner,"first");
  assert.equal(await acquireMaintenanceLease(ref,"second",1000 + 31 * 60_000),true);
  await releaseMaintenanceLease(ref,"first");
  assert.equal(data.leaseOwner,"second");
});

test("a retry recovers a crashed attempt without admitting concurrent executions or stale releases", async () => {
  let data: Record<string, unknown> = {};
  const tx = { get: async () => ({data:()=>data,get:(key:string)=>data[key]}), set: (_ref: unknown, values: Record<string, unknown>) => { data = {...data,...values}; } };
  const ref = {firestore:{runTransaction:async (work:(tx:unknown)=>Promise<unknown>)=>work(tx)}} as DocumentReference;
  const task = { execution: "sync-abc", index: 0, attempt: 0 };
  assert.equal(await acquireMaintenanceLease(ref, "crashed", 1000, task), true);
  assert.equal(await acquireMaintenanceLease(ref, "duplicate", 1001, task), false);
  assert.equal(await acquireMaintenanceLease(ref, "other-execution", 1001, {...task, execution: "sync-def", attempt: 1}), false);
  assert.equal(await acquireMaintenanceLease(ref, "other-task", 1001, {...task, index: 1, attempt: 1}), false);
  assert.equal(await acquireMaintenanceLease(ref, "retry", 1001, {...task, attempt: 1}), true);
  assert.equal(data.leaseOwner, "retry");
  assert.equal(await acquireMaintenanceLease(ref, "stale", 1002, task), false);
  await releaseMaintenanceLease(ref, "crashed");
  assert.equal(data.leaseOwner, "retry");
  await releaseMaintenanceLease(ref, "retry");
  assert.equal(await acquireMaintenanceLease(ref, "next", 1003, {...task, execution: "sync-next"}), true);
});

test("retry identity requires complete valid Cloud Run task metadata", () => {
  const env = { CLOUD_RUN_EXECUTION: "sync-abc", CLOUD_RUN_TASK_INDEX: "0", CLOUD_RUN_TASK_ATTEMPT: "1" };
  assert.deepEqual(cloudRunTaskAttempt(env), {execution: "sync-abc", index: 0, attempt: 1});
  assert.equal(cloudRunTaskAttempt({}), undefined);
  assert.equal(cloudRunTaskAttempt({...env, CLOUD_RUN_TASK_INDEX: undefined}), undefined);
  assert.equal(cloudRunTaskAttempt({...env, CLOUD_RUN_TASK_ATTEMPT: ""}), undefined);
  assert.equal(cloudRunTaskAttempt({...env, CLOUD_RUN_TASK_ATTEMPT: "-1"}), undefined);
});
