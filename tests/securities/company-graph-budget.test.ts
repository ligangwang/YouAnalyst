import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { budgetFixture } from "../helpers/graph-budget";
import { getGraphBudgetSummary, setGraphBudgetLimit, reserveGraphBudget, recordGraphResponse, settleGraphBudget,
  findGraphBudgetTicket, readCompanyGraphBudgetAvailability, GraphBudgetExceededError, GraphBudgetUncertainError,
  graphReservationMicros, nextGraphBudgetDay, GRAPH_PRICING_VALID_UNTIL, GRAPH_FLEX_RESERVATION_MICROS,
  GRAPH_FLEX_PRICE_VERSION, GRAPH_LEGACY_PRICE_VERSION, GRAPH_MODEL_CONTEXT_TOKENS } from "../../src/lib/company-graph/budget";

const now = Date.parse("2026-10-01T12:00:00Z");
const request = (requestKey: string, inputTokens = 100_000) => ({ requestKey, fingerprint: "payload", model: "gpt-5.6-sol", inputTokens });
const usage = (input = 100, output = 100) => ({ input_tokens: input, output_tokens: output, total_tokens: input + output,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } });
const response = (id: string, input = 100, output = 100) => ({ id, model: "gpt-5.6-sol", service_tier: "flex", status: "completed",
  reasoning: { mode: "standard", effort: "medium" }, prompt_cache_options: { mode: "explicit" }, usage: usage(input, output) });
async function legacyTicket(f: ReturnType<typeof budgetFixture>, requestKey: string, inputTokens = 11133) {
  const id = `_graph_budget_request_${createHash("sha256").update(requestKey).digest("hex")}`;
  const reservedMicros = inputTokens * 5 + 16384 * 20;
  f.rows.set("company_research_runs/_graph_daily_budget", { day: "2026-10-01", limitMicros: 5e6, spentMicros: 0, reservedMicros });
  f.rows.set(`company_research_runs/${id}`, { id, requestKey, fingerprint: "payload", model: "gpt-5.6-sol", inputTokens,
    reservedMicros, responseId: null, status: "reserved", priceVersion: GRAPH_LEGACY_PRICE_VERSION });
  return (await findGraphBudgetTicket(requestKey, f.db))!;
}

test("fixed full-context reservation is independent of every accepted preflight count", () => {
  assert.equal(GRAPH_FLEX_RESERVATION_MICROS, 4_445_760);
  for (const tokens of [1, 11133, 100_000]) assert.equal(graphReservationMicros("gpt-5.6-sol", tokens, now), 4_445_760);
});
test("concurrent workers reserve worst-case cost atomically and never exceed the daily limit", async () => {
  const f = budgetFixture();
  const attempts = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => reserveGraphBudget(request(`job_${i}`, i + 1), f.db, now)));
  assert.equal(attempts.filter(a => a.status === "fulfilled").length, 1);
  assert.ok(attempts.filter(a => a.status === "rejected").every(a => a.status === "rejected" && a.reason instanceof GraphBudgetExceededError && a.reason.retryAtMs === now + 60_000));
  const s = await getGraphBudgetSummary(f.db, now);
  assert.equal(s.limitUsd, 5); assert.equal(s.reservedUsd, 4.44576); assert.equal(s.requestReservationUsd, 4.44576);
  assert.equal(s.spentUsd, 0); assert.equal(s.blocked, true);
  assert.ok(s.reservedUsd + s.spentUsd <= s.limitUsd);
  assert.equal((await readCompanyGraphBudgetAvailability(f.db, now)).retryAtMs, now + 60_000);
});
test("retry without durable response cannot POST again; concurrent valid settlement refunds once", async () => {
  const f = budgetFixture(), ticket = await reserveGraphBudget(request("one"), f.db, now);
  await assert.rejects(reserveGraphBudget(request("one"), f.db, now + 1), GraphBudgetUncertainError);
  await recordGraphResponse(ticket, "resp_one", f.db);
  const saved = { ...ticket, responseId: "resp_one" };
  await Promise.all(Array.from({ length: 10 }, () => settleGraphBudget(saved, response("resp_one"), f.db, now + 2)));
  const s = await getGraphBudgetSummary(f.db, now + 3);
  assert.equal(s.reservedUsd, 0); assert.equal(s.spentUsd, 0.0012);
  const receipt = f.rows.get(`company_research_runs/${ticket.id}`)!;
  assert.equal(receipt.ticketVersion, 2); assert.equal(receipt.priceVersion, GRAPH_FLEX_PRICE_VERSION);
  assert.equal(receipt.serviceTier, "flex"); assert.equal(receipt.cacheWriteTokens, 0);
  assert.equal(receipt.promptCacheMode, "explicit"); assert.equal(receipt.reasoningMode, "standard");
});
test("unknown policy, unbounded usage and cache writes retain the complete reservation", async () => {
  const changes = [
    { usage: null }, { model: "unknown" }, { service_tier: "default" }, { service_tier: "priority" }, { service_tier: undefined },
    { status: "in_progress" }, { id: "resp_wrong" }, { reasoning: undefined }, { reasoning: { mode: "pro" } },
    { prompt_cache_options: undefined }, { prompt_cache_options: { mode: "implicit" } }, { tools: [{ type: "web_search" }] },
    { usage: usage(GRAPH_MODEL_CONTEXT_TOKENS + 1, 0) }, { usage: usage(1, 16385) },
    { usage: usage(GRAPH_MODEL_CONTEXT_TOKENS, 1) }, { usage: { ...usage(), total_tokens: 1 } },
    { usage: { ...usage(), total_tokens: undefined } }, { usage: { ...usage(), input_tokens: "100" } },
    { usage: { ...usage(), input_tokens_details: undefined } },
    { usage: { ...usage(), input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1 } } },
    { usage: { ...usage(), input_tokens_details: { cached_tokens: 1, cache_write_tokens: 0 } } },
    { usage: { ...usage(), output_tokens_details: { reasoning_tokens: 101 } } },
  ];
  for (const change of changes) {
    const f = budgetFixture(), ticket = await reserveGraphBudget(request("one"), f.db, now);
    await recordGraphResponse(ticket, "resp_one", f.db);
    const before = structuredClone([...f.rows]);
    await assert.rejects(settleGraphBudget({ ...ticket, responseId: "resp_one" }, { ...response("resp_one"), ...change }, f.db, now));
    assert.deepEqual([...f.rows], before);
    assert.equal((await getGraphBudgetSummary(f.db, now)).reservedUsd, 4.44576);
  }
});
test("actual usage beyond the quality guard settles at the reviewed short or long Flex rate", async () => {
  for (const [input, output, expectedMicros] of [[100001, 1, 200012], [272000, 16384, 707840], [272001, 16384, 1333764], [1033616, 16384, 4380224]]) {
    const f = budgetFixture(), ticket = await reserveGraphBudget(request("drift", 1), f.db, now);
    await recordGraphResponse(ticket, "resp_drift", f.db);
    await settleGraphBudget({ ...ticket, responseId: "resp_drift" }, response("resp_drift", input, output), f.db, now);
    assert.equal((await getGraphBudgetSummary(f.db, now)).spentUsd, expectedMicros / 1e6);
    assert.equal((await getGraphBudgetSummary(f.db, now)).reservedUsd, 0);
  }
});
test("New York midnight carries all unsettled liability and settles it against the new day", async () => {
  const before = Date.parse("2026-10-02T03:59:59Z"), after = Date.parse("2026-10-02T04:00:01Z");
  const f = budgetFixture(), ticket = await reserveGraphBudget(request("overnight"), f.db, before);
  const s = await getGraphBudgetSummary(f.db, after);
  assert.equal(s.day, "2026-10-02"); assert.equal(s.reservedUsd, 4.44576);
  await assert.rejects(reserveGraphBudget(request("other"), f.db, after), GraphBudgetExceededError);
  await recordGraphResponse(ticket, "resp_overnight", f.db);
  await settleGraphBudget({ ...ticket, responseId: "resp_overnight" }, response("resp_overnight"), f.db, after);
  await settleGraphBudget({ ...ticket, responseId: "resp_overnight" }, response("resp_overnight"), f.db, after + 86400_000);
  assert.equal((await getGraphBudgetSummary(f.db, after)).spentUsd, 0.0012);
});
test("New York budget reset honors both DST transitions", () => {
  assert.equal(new Date(nextGraphBudgetDay(Date.parse("2026-03-08T05:00:00Z"))).toISOString(), "2026-03-09T04:00:00.000Z");
  assert.equal(new Date(nextGraphBudgetDay(Date.parse("2026-11-01T04:00:00Z"))).toISOString(), "2026-11-02T05:00:00.000Z");
});
test("admin lowering or zeroing budget preserves liability and blocks new work", async () => {
  const f = budgetFixture(); await reserveGraphBudget(request("one"), f.db, now);
  const s = await setGraphBudgetLimit(0.5, f.db, now);
  assert.equal(s.remainingUsd, 0); assert.equal(s.reservedUsd, 4.44576); assert.equal(s.blocked, true);
  await assert.rejects(reserveGraphBudget(request("two"), f.db, now), GraphBudgetExceededError);
  assert.equal((await readCompanyGraphBudgetAvailability(f.db, now)).retryAtMs, nextGraphBudgetDay(now));
  await setGraphBudgetLimit(0, f.db, now);
  await assert.rejects(reserveGraphBudget(request("three"), f.db, now), GraphBudgetExceededError);
  await setGraphBudgetLimit(10, f.db, now);
  await reserveGraphBudget(request("four"), f.db, now);
});
test("availability requires the entire fixed hold even when positive dollars remain", async t => {
  const previous = process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED; process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED = "1";
  t.after(() => { if (previous === undefined) delete process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED; else process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED = previous; });
  const f = budgetFixture();
  f.rows.set("company_research_runs/_graph_daily_budget", { day: "2026-10-01", limitMicros: 5e6, spentMicros: 554241, reservedMicros: 0 });
  assert.equal((await getGraphBudgetSummary(f.db, now)).blocked, true);
  assert.deepEqual(await readCompanyGraphBudgetAvailability(f.db, now), { available: false, retryAtMs: nextGraphBudgetDay(now) });
  f.rows.get("company_research_runs/_graph_daily_budget")!.spentMicros = 554240;
  assert.equal((await readCompanyGraphBudgetAvailability(f.db, now)).available, true);
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
test("tampering with the persisted pricing policy cannot release any hold", async () => {
  for (const changed of [{ priceVersion: "future" }, { ticketVersion: 1 }, { promptCacheMode: "implicit" }, { promptCacheBreakpoints: 1 }, { reasoningMode: "pro" }, { reservedMicros: 1 }]) {
    const f = budgetFixture(), ticket = await reserveGraphBudget(request("one"), f.db, now);
    await recordGraphResponse(ticket, "resp_one", f.db);
    Object.assign(f.rows.get(`company_research_runs/${ticket.id}`)!, changed);
    const before = structuredClone([...f.rows]);
    await assert.rejects(findGraphBudgetTicket("one", f.db));
    await assert.rejects(settleGraphBudget({ ...ticket, responseId: "resp_one" }, response("resp_one"), f.db, now));
    assert.deepEqual([...f.rows], before);
  }
});
test("legacy token-count drift cannot settle a cost greater than its originally held dollars", async () => {
  const f = budgetFixture(), ticket = await legacyTicket(f, "drift");
  await recordGraphResponse(ticket, "resp_drift", f.db); const before = structuredClone([...f.rows]);
  await assert.rejects(settleGraphBudget({ ...ticket, responseId: "resp_drift" }, { ...response("resp_drift", 11138, 16384), service_tier: "default" }, f.db, now), /actual cost exceeds reservation/);
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
  await assert.rejects(settleGraphBudget(saved, response("resp_original", 11143, 3805), f.db, now), /settled usage changed/);
  await assert.rejects(settleGraphBudget({ ...ticket, responseId: "resp_other" }, response("resp_other", 11138, 3806), f.db, now), /stored response identity/);
  assert.deepEqual([...f.rows], before);
});
