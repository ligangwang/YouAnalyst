import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { graphBudgetResponse } from "../../src/lib/company-graph/budget-http";
import type { GraphBudgetSummary } from "../../src/lib/company-graph/budget";

type Dependencies = NonNullable<Parameters<typeof graphBudgetResponse>[1]>;
const summary: GraphBudgetSummary = { limitUsd: 5, spentUsd: 1.25, reservedUsd: 0.5, remainingUsd: 3.25, day: "2026-10-01", timezone: "America/New_York", blocked: false, pricingValidUntil: "2026-10-31T00:00:00Z" };
const request = (method = "GET", body?: string) => new NextRequest("https://example.test/api/admin/company-graph/budget", { method, ...(body === undefined ? {} : { body, headers: { "Content-Type": "application/json" } }) });
const dependencies = (): Dependencies => ({
  getUser: async () => ({ uid: "admin-user" }) as Awaited<ReturnType<Dependencies["getUser"]>>,
  isAdmin: async () => true,
  load: async () => summary,
  update: async limitUsd => ({ ...summary, limitUsd }),
});

test("graph budget read and edit deny anonymous and non-admin callers before accessing the ledger", async () => {
  const deps = dependencies();
  let adminChecks = 0;
  deps.getUser = async () => null;
  deps.isAdmin = async () => { adminChecks++; return false; };
  deps.load = async () => { assert.fail("Anonymous/non-admin callers cannot read the budget"); };
  deps.update = async () => { assert.fail("Anonymous/non-admin callers cannot update the budget"); };
  for (const method of ["GET", "PATCH"]) {
    const response = await graphBudgetResponse(request(method, method === "PATCH" ? "invalid json" : undefined), deps);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(adminChecks, 0);
  deps.getUser = dependencies().getUser;
  for (const method of ["GET", "PATCH"]) {
    const response = await graphBudgetResponse(request(method, method === "PATCH" ? '{"limitUsd":0}' : undefined), deps);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(adminChecks, 2);
});

test("graph budget GET returns the authoritative New York summary without changing the limit", async () => {
  const deps = dependencies();
  deps.update = async () => { assert.fail("GET must not update the limit"); };
  const response = await graphBudgetResponse(request(), deps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), summary);
});

test("graph budget PATCH accepts cents and zero and returns the ledger result when lowering below usage", async () => {
  const deps = dependencies();
  deps.load = async () => { assert.fail("PATCH uses the update result"); };
  const limits: number[] = [];
  deps.update = async limitUsd => {
    limits.push(limitUsd);
    return { ...summary, limitUsd, remainingUsd: Math.max(0, limitUsd - summary.spentUsd - summary.reservedUsd), blocked: limitUsd <= summary.spentUsd + summary.reservedUsd };
  };
  for (const limitUsd of [0, 0.29, 1, 5, 12.34, 1_000_000]) {
    const response = await graphBudgetResponse(request("PATCH", JSON.stringify({ limitUsd })), deps);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const result = await response.json();
    assert.equal(result.limitUsd, limitUsd);
    assert.equal(result.spentUsd, summary.spentUsd);
    assert.equal(result.reservedUsd, summary.reservedUsd);
    assert.equal(result.blocked, limitUsd <= 1.75);
  }
  assert.deepEqual(limits, [0, 0.29, 1, 5, 12.34, 1_000_000]);
});

test("graph budget PATCH rejects malformed, nonnumeric, out-of-range and fractional-cent limits before writes", async () => {
  const deps = dependencies();
  deps.update = async () => { assert.fail("Invalid input must not write"); };
  for (const body of ["", "not json", "null", "[]", "5", '"5"', "{}", '{"limitUsd":"5"}', '{"limitUsd":null}', '{"limitUsd":true}', '{"limitUsd":-0.01}', '{"limitUsd":1000000.01}', '{"limitUsd":1e400}', '{"limitUsd":0.001}', '{"limitUsd":1.234}', '{"limitUsd":0.30000000000000004}']) {
    const response = await graphBudgetResponse(request("PATCH", body), deps);
    assert.equal(response.status, 400, body);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});

test("graph budget failures return retry guidance without exposing backend details or a success result", async () => {
  const deps = dependencies();
  deps.load = deps.update = async () => { throw new Error("private backend failure"); };
  for (const method of ["GET", "PATCH"]) {
    const response = await graphBudgetResponse(request(method, method === "PATCH" ? '{"limitUsd":0}' : undefined), deps);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const payload = await response.json();
    assert.doesNotMatch(payload.error, /private backend failure/);
    assert.equal(payload.limitUsd, undefined);
    assert.match(payload.error, method === "PATCH" ? /Refresh the budget to check the current limit/ : /Retry to see the current limit/);
  }
});
