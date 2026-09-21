import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { rerunEodResponse } from "../../src/lib/admin-jobs/rerun";

type Dependencies = NonNullable<Parameters<typeof rerunEodResponse>[1]>;
const request = (body: unknown) => new NextRequest("https://example.test/api/admin/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const admin = async () => ({ uid: "admin-1" }) as Awaited<ReturnType<Dependencies["getUser"]>>;
test("rerun requires an administrator and rejects invalid dates or non-EOD jobs before executing", async () => {
  const deps: Dependencies = { getUser: async () => null, isAdmin: async () => false, run: async () => { throw new Error("Must not execute"); } };
  assert.equal((await rerunEodResponse(request({ job: "us", runDate: "2026-01-02" }), deps)).status, 401);
  deps.getUser = admin;
  assert.equal((await rerunEodResponse(request({ job: "us", runDate: "2026-01-02" }), deps)).status, 403);
  deps.isAdmin = async () => true;
  for (const body of [{ job: "fundamentals", runDate: "2026-01-02" }, { job: "us", runDate: "2026-02-30" }, { job: "china", runDate: "9999-01-01" }, { job: "us", runDate: "bad" }, null]) {
    assert.equal((await rerunEodResponse(request(body), deps)).status, 400);
  }
});
test("rerun passes exact market/date and admin identity, ignores unsafe options, and returns results", async () => {
  const deps: Dependencies = { getUser: admin, isAdmin: async () => true, run: async input => {
    assert.deepEqual(input, { market: "CN_A", runDate: "2026-01-02", limit: 500, trigger: "admin", requestedBy: "admin-1" });
    return { runId: "run-1", priceLoad: { loaded: 3, failed: 0 } } as Awaited<ReturnType<Dependencies["run"]>>;
  } };
  const response = await rerunEodResponse(request({ job: "china", runDate: "2026-01-02", recompute: true, rollForward: true, tickers: ["NVDA"], requestedBy: "forged" }), deps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).result.runId, "run-1");
});
test("overlapping runs return conflict and errors never return credential-bearing provider messages", async t => {
  t.mock.method(console, "error", () => undefined);
  const deps: Dependencies = { getUser: admin, isAdmin: async () => true, run: async () => { throw Object.assign(new Error("running"), { code: "EOD_ALREADY_RUNNING" }); } };
  assert.equal((await rerunEodResponse(request({ job: "us", runDate: "2026-01-02" }), deps)).status, 409);
  deps.run = async () => { throw new Error("https://provider?token=secret"); };
  const response = await rerunEodResponse(request({ job: "us", runDate: "2026-01-02" }), deps);
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /secret/);
});
