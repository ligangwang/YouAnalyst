import { test } from "node:test";
import assert from "node:assert/strict";
import { targetDateFromRunStatus } from "../../src/lib/predictions/service";
import { pubsubFirestore } from "../helpers/pubsub-firestore";
import { eodQueueInput, queueEodMaintenance, processEodMaintenance, type EodRequest } from "../../src/lib/predictions/eod-pubsub";
import type { DailyEodMaintenanceInput, DailyEodMaintenanceResult } from "../../src/lib/predictions/eod-prices";
const input = { market: "US" as const, runDate: "2026-01-02" };
const result = (more = false, cursor = "b") => ({ runDate: input.runDate, hasMoreCandidatePredictions: more, nextPredictionId: cursor,
  priceLoad: { failed: 0 }, marking: { missingPrice: 0 }, dailySnapshots: { skippedUsers: 0 } }) as DailyEodMaintenanceResult;
async function fixture() {
  const f = pubsubFirestore();
  let message!: EodRequest;
  await queueEodMaintenance(input, f.db, async value => { message = value; });
  return { ...f, message, ref: `eod_runs/_request_${message.batchId}` };
}
test("publication failures preserve the original request and confirmed retries reuse it", async () => {
  const f = pubsubFirestore();
  const sent: EodRequest[] = [];
  await assert.rejects(queueEodMaintenance(input, f.db, async r => { sent.push(r); throw Error("ambiguous publish"); }));
  await queueEodMaintenance(input, f.db, async r => { sent.push(r); });
  assert.deepEqual(sent[0], sent[1]);
  await queueEodMaintenance({ ...input, runDate: "2026-01-03" }, f.db, async () => {});
});
test("worker checkpoints every page, deduplicates completed delivery, and does not reset completed scheduler requests", async () => {
  const f = await fixture(), calls: DailyEodMaintenanceInput[] = [];
  const run = async (i: DailyEodMaintenanceInput = {}) => { calls.push(i); return result(calls.length === 1); };
  await processEodMaintenance(f.message, f.db, f.log, { run });
  assert.deepEqual(calls.map(c => c.afterPredictionId), [undefined, "b"]);
  assert.equal(f.rows.get(f.ref)?.completed, true);
  assert.ok([...f.rows.entries()].filter(([key]) => key.startsWith("eod_runs/_dispatch_")).every(([, value]) => value.activeRequest === null));
  assert.equal((await processEodMaintenance(f.message, f.db, f.log, { run })).duplicate, true);
  await queueEodMaintenance(input, f.db, async () => {});
  assert.ok([...f.rows.entries()].filter(([key]) => key.startsWith("eod_runs/_dispatch_")).every(([, value]) => value.activeRequest === null));
  assert.equal(calls.length, 2);
});
test("failure retries the unfinished page without repeating checkpointed pages", async () => {
  const f = await fixture(); let calls = 0;
  await assert.rejects(processEodMaintenance(f.message, f.db, f.log, { run: async () => {
    calls++; if (calls === 2) throw Error("provider timeout"); return result(true);
  } }), /provider timeout/);
  assert.equal(f.rows.get(f.ref)?.cursor, "b");
  await processEodMaintenance(f.message, f.db, f.log, { run: async i => { assert.equal(i?.afterPredictionId, "b"); return result(); } });
  assert.equal(f.rows.get(f.ref)?.completed, true);
});
test("partial provider/score results do not advance progress or acknowledge completion", async () => {
  for (const partial of [ { ...result(), priceLoad: { failed: 1 } }, { ...result(), fx: { failed: 1 } }, { ...result(), marking: { missingPrice: 1 } } ]) {
    const f = await fixture();
    await assert.rejects(processEodMaintenance(f.message, f.db, f.log, { run: async () => partial as DailyEodMaintenanceResult }), /incomplete/);
    assert.equal(f.rows.get(f.ref)?.pages, 0);
    assert.notEqual(f.rows.get(f.ref)?.completed, true);
  }
});
test("failed checkpoint replays a page; expired delivery budgets and active leases do not execute", async () => {
  const f = await fixture();
  f.reject((path, data) => path === f.ref && data.pages === 1);
  await assert.rejects(processEodMaintenance(f.message, f.db, f.log, { run: async () => result() }), /transaction failed/);
  assert.equal(f.rows.get(f.ref)?.pages, 0);
  f.reject(() => false);
  const run = async () => { throw Error("must not run"); };
  await assert.rejects(processEodMaintenance(f.message, f.db, f.log, { run, deadline: 0 }), /another delivery/);
  f.rows.set("eod_runs/_queue_US", { ...f.rows.get("eod_runs/_queue_US"), leaseExpiresAtMs: Date.now() + 100000, leaseOwner: "another" });
  await assert.rejects(processEodMaintenance(f.message, f.db, f.log, { run }), /already queued/);
});
test("roll-forward snapshots ordered dates once and restarts the cursor per date", async () => {
  const f = pubsubFirestore(); let message!: EodRequest;
  await queueEodMaintenance({ ...input, rollForward: true, rollForwardBatchSize: 2 }, f.db, async r => { message = r; });
  const dates: string[] = [];
  const output = await processEodMaintenance(message, f.db, f.log, { dates: async () => ["2026-01-02", "2026-01-05", "2026-01-06"],
    run: async i => { dates.push(i!.runDate!); assert.equal(i?.rollForward, false); assert.equal(i?.afterPredictionId, undefined); return result(); } });
  assert.deepEqual(dates, ["2026-01-02", "2026-01-05"]);
  assert.equal(output.nextRunDate, "2026-01-06");
});
test("untrusted payloads cannot inject a cursor, a preview, a mismatched ticker, or invalid date", async () => {
  for (const extra of [{ runDate: "2026-02-30" }, { afterPredictionId: "skip" }, { dryRun: true }, { tickers: ["XSHG:600000"] }, { limit: -1 }])
    assert.throws(() => eodQueueInput({ ...input, ...extra }), /Invalid/);
  const f = await fixture();
  await assert.rejects(processEodMaintenance({ ...f.message, input: { ...f.message.input, recompute: true } }, f.db, f.log), /conflicting/);
});

test("queue acceptance freezes the cutoff even before delivery and does not overwrite a completed run", async () => {
  const f = await fixture();
  assert.equal(f.rows.get("eod_runs/US_2026-01-02")?.status, "QUEUED");
  assert.equal(targetDateFromRunStatus("2026-01-02", f.rows.get("eod_runs/US_2026-01-02")?.status), "2026-01-03");
  assert.equal(targetDateFromRunStatus("2026-01-02", undefined), "2026-01-02");
  f.rows.set("eod_runs/US_2026-01-02", { status: "COMPLETED", priceLoad: { loaded: 4 } });
  await queueEodMaintenance(input, f.db, async () => {});
  assert.deepEqual(f.rows.get("eod_runs/US_2026-01-02"), { status: "COMPLETED", priceLoad: { loaded: 4 } });
});
