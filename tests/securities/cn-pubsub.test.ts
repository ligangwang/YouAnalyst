import { test } from "node:test";
import assert from "node:assert/strict";
import { pubsubFirestore } from "../helpers/pubsub-firestore";
import { parseCnRequest, publishCnRequests, processCnRequest, type CnRequest } from "../../src/lib/fundamentals/cn-pubsub";
import type { refreshCnFundamentals } from "../../src/lib/fundamentals/cn-refresh";

const company = "XSHG:600584";
const success = () => ({ companies: 1, failed: 0, sourcesIncomplete: false, blockedHosts: {},
  actions: { checked: 1, events: 0, failed: 0, skipped: 0 },
  shares: { refreshed: 1, fresh: 0, unavailable: 0, failed: 0, deferred: 0, skipped: 0 },
  marketCaps: { processed: 1, estimated: 1, unavailable: 0, failed: 0, kept: 0, lastClose: 0, missingUsd: 0 } });
async function setup() {
  const f = pubsubFirestore(), requests: CnRequest[] = [];
  await publishCnRequests(f.db, "execution-1", [company], async r => { requests.push(r); });
  let annualCalls = 0, refreshCalls = 0;
  const annual = async () => { annualCalls++; return { updated: 1, skipped: 0, failed: 0, deferred: 0 }; };
  const refresh = async () => { refreshCalls++; return success(); };
  return { ...f, request: requests[0], annual, refresh, calls: () => ({ annualCalls, refreshCalls }) };
}
test("A-share requests validate IDs and publisher retries reuse the original payload", async () => {
  const f = await setup(), requests: CnRequest[] = [];
  await publishCnRequests(f.db, "execution-1", [company, company], async r => { requests.push(r); });
  assert.deepEqual(requests, [f.request]);
  for (const id of ["AMD", "../_cn_worker", "XSHE:999999"]) assert.throws(() => parseCnRequest({ ...f.request, companyId: id }));
  await assert.rejects(publishCnRequests(f.db, "empty", [], async () => {}), /No A-share/);
});
test("A-share partial failure checkpoints annual work and skips completed redelivery", async () => {
  const f = await setup();
  const failed: typeof refreshCnFundamentals = async () => ({ ...success(), actions: { checked: 0, events: 0, failed: 1, skipped: 0 } });
  await assert.rejects(processCnRequest(f.request, f.db, f.log, { annual: f.annual, refresh: failed }), /incomplete/);
  await processCnRequest(f.request, f.db, f.log, f);
  assert.ok((await processCnRequest(f.request, f.db, f.log, f)).completed);
  assert.deepEqual(f.calls(), { annualCalls: 1, refreshCalls: 1 });
});
test("annual provider cooldown and deferred share sources remain retryable", async () => {
  const f = await setup();
  await assert.rejects(processCnRequest(f.request, f.db, f.log, { ...f,
    annual: async () => ({ updated: 0, skipped: 0, failed: 1, deferred: 0 }) }), /Annual/);
  const deferred: typeof refreshCnFundamentals = async () => ({ ...success(), shares: { ...success().shares, refreshed: 0, deferred: 1 } });
  await assert.rejects(processCnRequest(f.request, f.db, f.log, { ...f, refresh: deferred }), /incomplete/);
  f.rows.set(`company_fundamentals/${company}`, { cnShareStatus: { outcome: "unavailable" } });
  assert.equal((await processCnRequest(f.request, f.db, f.log, { ...f, refresh: deferred })).completed, 1);
});
test("A-share lease and deadline prevent overlapping or unbounded work", async () => {
  const f = await setup();
  f.rows.set("company_fundamentals/_cn_worker", { leaseExpiresAtMs: Date.now() + 60000 });
  await assert.rejects(processCnRequest(f.request, f.db, f.log, f), /busy/);
  f.rows.delete("company_fundamentals/_cn_worker");
  await assert.rejects(processCnRequest(f.request, f.db, f.log, { ...f, deadline: Date.now() }), /budget/);
  assert.equal(f.calls().refreshCalls, 0);
});
