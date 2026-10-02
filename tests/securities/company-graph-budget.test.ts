import test from "node:test";
import assert from "node:assert/strict";
import { budgetFixture } from "../helpers/graph-budget";
import { getGraphBudgetSummary, setGraphBudgetLimit, reserveGraphBudget, recordGraphResponse, settleGraphBudget,
  readCompanyGraphBudgetAvailability, GraphBudgetExceededError, GraphBudgetUncertainError, graphReservationMicros, nextGraphBudgetDay, GRAPH_PRICING_VALID_UNTIL } from "../../src/lib/company-graph/budget";

const now = Date.parse("2026-10-01T12:00:00Z");

const request = (requestKey: string, inputTokens = 100_000) => ({ requestKey, fingerprint: "payload", model: "gpt-5.6-sol", inputTokens });
const response = (id: string, input = 100, output = 100) => ({ id, model: "gpt-5.6-sol", service_tier: "default", status: "completed", usage: { input_tokens: input, output_tokens: output } });
test("concurrent workers reserve worst-case cost atomically and never exceed the daily limit", async () => {
  const f = budgetFixture();
  const attempts = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => reserveGraphBudget(request(`job_${i}`), f.db, now)));
  assert.equal(attempts.filter(a => a.status === "fulfilled").length, 6);
  assert.ok(attempts.filter(a => a.status === "rejected").every(a => a.status === "rejected" && a.reason instanceof GraphBudgetExceededError));
  const s = await getGraphBudgetSummary(f.db, now);
  assert.equal(s.limitUsd, 5); assert.equal(s.reservedUsd, 4.96608); assert.equal(s.spentUsd, 0);
  assert.ok(s.reservedUsd + s.spentUsd <= s.limitUsd);
});
test("retry without durable response cannot POST again; valid settlement refunds once", async () => {
  const f = budgetFixture(), ticket = await reserveGraphBudget(request("one"), f.db, now);
  await assert.rejects(reserveGraphBudget(request("one"), f.db, now + 1), GraphBudgetUncertainError);
  await recordGraphResponse(ticket, "resp_one", f.db);
  const saved = { ...ticket, responseId: "resp_one" };
  await settleGraphBudget(saved, response("resp_one"), f.db, now + 2);
  await settleGraphBudget(saved, response("resp_one"), f.db, now + 3);
  const s = await getGraphBudgetSummary(f.db, now + 3);
  assert.equal(s.reservedUsd, 0); assert.equal(s.spentUsd, 0.0025);
});
test("unknown or unbounded usage retains the complete reservation", async () => {
  for (const change of [{ usage: null }, { model: "unknown" }, { service_tier: "priority" }, { service_tier: undefined }, { status: "in_progress" }, { id: "resp_wrong" },
    { usage: { input_tokens: 100001, output_tokens: 1 } }, { usage: { input_tokens: 1, output_tokens: 16385 } }]) {
    const f = budgetFixture(), ticket = await reserveGraphBudget(request("one"), f.db, now);
    await recordGraphResponse(ticket, "resp_one", f.db);
    await assert.rejects(settleGraphBudget({ ...ticket, responseId: "resp_one" }, { ...response("resp_one"), ...change }, f.db, now));
    assert.equal((await getGraphBudgetSummary(f.db, now)).reservedUsd, 0.82768);
  }
});
test("New York midnight carries all unsettled liability and settles it against the new day", async () => {
  const before = Date.parse("2026-10-02T03:59:59Z"), after = Date.parse("2026-10-02T04:00:01Z");
  const f = budgetFixture(), ticket = await reserveGraphBudget(request("overnight"), f.db, before);
  const s = await getGraphBudgetSummary(f.db, after);
  assert.equal(s.day, "2026-10-02"); assert.equal(s.reservedUsd, 0.82768);
  await recordGraphResponse(ticket, "resp_overnight", f.db);
  await settleGraphBudget({ ...ticket, responseId: "resp_overnight" }, response("resp_overnight"), f.db, after);
  assert.equal((await getGraphBudgetSummary(f.db, after)).spentUsd, 0.0025);
});
test("New York budget reset honors both DST transitions", () => {
  assert.equal(new Date(nextGraphBudgetDay(Date.parse("2026-03-08T05:00:00Z"))).toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal(new Date(nextGraphBudgetDay(Date.parse("2026-11-01T04:00:00Z"))).toISOString(), "2026-11-02T05:00:00.000Z");
});
test("admin lowering or zeroing budget preserves liability and blocks new work", async () => {
  const f = budgetFixture(); await reserveGraphBudget(request("one"), f.db, now);
  const s = await setGraphBudgetLimit(0.5, f.db, now);
  assert.equal(s.remainingUsd, 0); assert.equal(s.reservedUsd, 0.82768); assert.equal(s.blocked, true);
  await assert.rejects(reserveGraphBudget(request("two"), f.db, now), GraphBudgetExceededError);
  await setGraphBudgetLimit(0, f.db, now);
  await assert.rejects(reserveGraphBudget(request("three"), f.db, now), GraphBudgetExceededError);
  await setGraphBudgetLimit(10, f.db, now);
  await reserveGraphBudget(request("four"), f.db, now);
});
test("unknown pricing, expired prices, malformed counters and request collisions fail closed", async () => {
  assert.throws(() => graphReservationMicros("other", 10, now));
  assert.throws(() => graphReservationMicros("gpt-5.6-sol", 10, Date.parse(GRAPH_PRICING_VALID_UNTIL)));
  for (const tokens of [0, 100001, NaN, -1, 1.5]) assert.throws(() => graphReservationMicros("gpt-5.6-sol", tokens, now));
  const f = budgetFixture(); await reserveGraphBudget(request("one"), f.db, now);
  await assert.rejects(reserveGraphBudget({ ...request("one"), fingerprint: "changed" }, f.db, now));
  f.rows.set("company_research_runs/_graph_daily_budget", { day: "2026-10-01", limitMicros: 5e6, spentMicros: 0, reservedMicros: "bad" });
  await assert.rejects(reserveGraphBudget(request("two"), f.db, now));
});

test("token-count drift never settles a cost greater than the held dollars", async () => {
  const f = budgetFixture(), ticket = await reserveGraphBudget(request("drift", 11133), f.db, now);
  await recordGraphResponse(ticket, "resp_drift", f.db); const before = structuredClone([...f.rows]);
  await assert.rejects(settleGraphBudget({ ...ticket, responseId: "resp_drift" }, response("resp_drift", 11138, 16384), f.db, now), /actual cost exceeds reservation/);
  assert.deepEqual([...f.rows], before);
});
test("raising the daily budget cannot release the new-paid-admission pause", async t => {
  const previous = process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED; delete process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED;
  t.after(() => { if (previous === undefined) delete process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED; else process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED = previous; });
  const f = budgetFixture();
  assert.equal((await setGraphBudgetLimit(10, f.db, now)).newRequestsPaused, true);
  assert.equal((await readCompanyGraphBudgetAvailability(f.db, now)).available, false);
});

test("settlement replay rejects changed response identity or changed token counts even at the same cost", async () => {
  const f = budgetFixture(), ticket = await reserveGraphBudget(request("replay", 11133), f.db, now);
  await recordGraphResponse(ticket, "resp_original", f.db); const saved = { ...ticket, responseId: "resp_original" };
  await settleGraphBudget(saved, response("resp_original", 11138, 3806), f.db, now);
  const before = structuredClone([...f.rows]);
  await assert.rejects(settleGraphBudget(saved, response("resp_original", 11142, 3805), f.db, now), /settled usage changed/);
  await assert.rejects(settleGraphBudget({ ...ticket, responseId: "resp_other" }, response("resp_other", 11138, 3806), f.db, now), /stored response identity/);
  assert.deepEqual([...f.rows], before);
});
