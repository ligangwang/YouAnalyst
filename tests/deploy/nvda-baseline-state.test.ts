import { test } from "node:test";
import assert from "node:assert/strict";
import type { Firestore } from "firebase-admin/firestore";
import { captureNvdaState, checkFreshNvdaState, verifyNvdaState, type BaselineSnapshot } from "../../scripts/verify-nvda-baseline";
import { createSecFilingDiscovered } from "../../src/lib/sec-filings/event";
const startTime = "2026-10-01T19:00:00Z";
const completionTime = "2026-10-01T19:01:00Z";
const execution = { execution: "collect-sec-filings-production-one", startTime, completionTime };
const event = createSecFilingDiscovered({ companyId: "NVDA", cik: "0001045810", accessionNumber: "0001045810-26-000001",
  form: "10-K", filingDate: "2026-02-01", primaryDocument: "report.htm", isXbrl: true, discoveredAt: startTime });
const empty = (): BaselineSnapshot => ({ cursor: null, leaseExpiresAtMs: 0, pendingDocuments: 0, records: {}, pending: {} });
const completed = (): BaselineSnapshot => ({ ...empty(), cursor: { version: 1, cik: event.cik, baselineAt: startTime,
  lastCompleteAt: startTime, nextPollAfterMs: Date.parse(completionTime) + 900000, scan: null },
  records: { [event.eventId]: { event, state: "baseline", publishedAt: null, messageId: null } }, pending: { [event.accessionNumber]: false } });

test("durable proof accepts only baseline additions and reports no broker inspection", () => {
  const result = verifyNvdaState(empty(), completed(), execution);
  assert.equal(result.newBaselineRecords, 1);
  assert.equal(result.newPendingOrPublishedRecords, 0);
  assert.equal(result.pubsubBacklog, "not-inspected");
});
test("fresh-state gate rejects a prior cursor or active collector before execution", () => {
  assert.throws(() => checkFreshNvdaState(completed()));
  assert.throws(() => checkFreshNvdaState({ ...empty(), leaseExpiresAtMs: Date.now() + 60000 }));
});
test("durable proof rejects failed, unrelated, partial or publication-affecting state", () => {
  for (const mutate of [
    (s: BaselineSnapshot) => { s.cursor = null; },
    (s: BaselineSnapshot) => { s.cursor!.cik = "0000000001"; },
    (s: BaselineSnapshot) => { s.cursor!.lastCompleteAt = "2026-10-01T18:00:00Z"; },
    (s: BaselineSnapshot) => { s.pendingDocuments = 1; },
    (s: BaselineSnapshot) => { s.pending[event.accessionNumber] = true; },
    (s: BaselineSnapshot) => { s.records[event.eventId].state = "pending"; },
    (s: BaselineSnapshot) => { s.records[event.eventId].state = "published"; },
    (s: BaselineSnapshot) => { s.records[event.eventId].messageId = "unexpected"; },
    (s: BaselineSnapshot) => { s.records[event.eventId].publishedAt = startTime; },
    (s: BaselineSnapshot) => { s.records = {}; },
    (s: BaselineSnapshot) => { s.leaseExpiresAtMs = Date.parse(completionTime) + 60000; },
  ]) { const after = structuredClone(completed()); mutate(after); assert.throws(() => verifyNvdaState(empty(), after, execution)); }
});
test("existing pending and published entries must remain unchanged, including receipts", () => {
  for (const state of ["pending", "published"]) {
    const before = completed(); before.cursor = null;
    before.records[event.eventId].state = state;
    before.records[event.eventId].messageId = state === "published" ? "existing" : null;
    before.pending[event.accessionNumber] = state === "pending";
    before.pendingDocuments = state === "pending" ? 1 : 0;
    const after = structuredClone(before); after.cursor = completed().cursor;
    assert.equal(verifyNvdaState(before, after, execution).unchangedExistingRecords, 1);
    after.records[event.eventId].messageId = "changed";
    assert.throws(() => verifyNvdaState(before, after, execution));
    delete after.records[event.eventId];
    assert.throws(() => verifyNvdaState(before, after, execution));
  }
});
test("snapshot uses only bounded reads of existing collections and excludes graph data", async () => {
  const calls: unknown[][] = [];
  const doc = { id: event.accessionNumber, get: (field: string) => ({ cik: event.cik, discoveryPending: false,
    discoveryEvents: { [event.eventId]: { event, state: "baseline", secretGraphPayload: "DO_NOT_PRINT" } } })[field] };
  const db = { collection(name: string) {
    calls.push(["collection", name]);
    if (name === "company_fundamentals") return { doc(id: string) { calls.push(["doc", id]); return {
      get: async () => ({ get: () => undefined }),
    }; } };
    assert.equal(name, "sec_filings");
    return { where(field: string, op: string, value: unknown) {
      calls.push(["where", field, op, value]);
      if (field === "discoveryPending") return { count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }) };
      return { select(...fields: string[]) { calls.push(["select", ...fields]); return {
        limit(limit: number) { calls.push(["limit", limit]); return { get: async () => ({ size: 1, docs: [doc] }) }; },
      }; } };
    } };
  } } as unknown as Firestore;
  const state = await captureNvdaState(db);
  assert.equal(state.records[event.eventId].state, "baseline");
  assert.doesNotMatch(JSON.stringify(state), /DO_NOT_PRINT|secretGraphPayload/);
  assert.ok(calls.some(call => JSON.stringify(call) === '["limit",5001]'));
  assert.ok(calls.some(call => JSON.stringify(call) === '["where","cik","==","0001045810"]'));
});
