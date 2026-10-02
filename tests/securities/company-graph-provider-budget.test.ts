import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { extractCompanyGraphRelationships, buildCompanyGraphResponseBody, buildLegacyCompanyGraphResponseBody } from "../../src/lib/company-graph/openai";
import { setGraphBudgetLimit, getGraphBudgetSummary, GraphBudgetExceededError, GraphBudgetUncertainError, graphBudgetFingerprint, findGraphBudgetTicket, GRAPH_LEGACY_PRICE_VERSION } from "../../src/lib/company-graph/budget";
import { budgetFixture } from "../helpers/graph-budget";
const now = Date.parse("2026-10-01T12:00:00Z");
function setup(t: TestContext) {
  const previous = [process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL, process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED];
  process.env.OPENAI_API_KEY = "mock-local-only"; process.env.OPENAI_MODEL = "gpt-5.6-sol"; process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED = "1";
  t.after(() => { ["OPENAI_API_KEY", "OPENAI_MODEL", "COMPANY_GRAPH_PAID_ADMISSION_ENABLED"].forEach((key, i) => {
    if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
  }); });
  const f = budgetFixture();
  return { ...f, input: { companyName: "NVIDIA", ticker: "NVDA", accessionNumber: "0001045810-26-000001", filingDate: "2026-02-01",
    extractionText: "NVIDIA competes with AMD.", budgetRequestId: "graph_test", budgetDb: f.db, budgetNow: () => now } };
}
const count = () => Response.json({ object: "response.input_tokens", input_tokens: 1000 });
const complete = (fields: Record<string, unknown> = {}) => Response.json({ id: "resp_test", model: "gpt-5.6-sol", service_tier: "flex", status: "completed", reasoning: { mode: "standard", effort: "medium" }, prompt_cache_options: { mode: "explicit" },
  output_text: '{"relationships":[]}', usage: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } }, ...fields });
test("shared input semantics are counted as a quality guard before a fixed-reservation Flex request", async t => {
  const f = setup(t), payloads: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    payloads.push(JSON.parse(String(init?.body)));
    if (url.endsWith("/input_tokens")) return count();
    assert.equal((await getGraphBudgetSummary(f.db, now)).reservedUsd, 4.44576);
    return complete();
  });
  await extractCompanyGraphRelationships(f.input);
  assert.equal(payloads.length, 2);
  const body = buildCompanyGraphResponseBody(f.input);
  assert.deepEqual(payloads[0], { model: body.model, input: body.input, text: body.text, reasoning: body.reasoning, truncation: body.truncation });
  assert.deepEqual(payloads[1], body);
  assert.equal(body.max_output_tokens, 16384); assert.equal(body.service_tier, "flex");
  assert.deepEqual(body.reasoning, { mode: "standard", effort: "medium" });
  assert.deepEqual(body.prompt_cache_options, { mode: "explicit" });
  assert.equal(body.text.verbosity, "medium");
  assert.equal(JSON.stringify(body).includes("prompt_cache_breakpoint"), false);
  assert.equal("tools" in body, false); assert.equal("previous_response_id" in body, false);
  assert.equal("conversation" in body, false); assert.equal("context_management" in body, false);
  const budget = await getGraphBudgetSummary(f.db, now);
  assert.equal(budget.spentUsd, 0.003); assert.equal(budget.reservedUsd, 0);
});
test("zero budget blocks generation including direct calls without an explicit request identity", async t => {
  const f = setup(t); await setGraphBudgetLimit(0, f.db, now); let posts = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => { if (url.endsWith("/input_tokens")) return count(); posts++; return complete(); });
  await assert.rejects(extractCompanyGraphRelationships({ ...f.input, budgetRequestId: undefined }), GraphBudgetExceededError);
  assert.equal(posts, 0);
});
test("ambiguous generation retains liability and retry never repeats a POST", async t => {
  const f = setup(t); let posts = 0, allCalls = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => { allCalls++; if (url.endsWith("/input_tokens")) return count(); posts++; throw Error("response lost"); });
  await assert.rejects(extractCompanyGraphRelationships(f.input), /response lost/);
  await assert.rejects(extractCompanyGraphRelationships(f.input), GraphBudgetUncertainError);
  assert.equal(posts, 1); assert.equal(allCalls, 2);
  assert.equal((await getGraphBudgetSummary(f.db, now)).reservedUsd, 4.44576);
});
test("concurrent deliveries for one logical request can create only one paid response", async t => {
  const f = setup(t); let posts = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => { if (url.endsWith("/input_tokens")) return count(); posts++; return complete(); });
  const results = await Promise.allSettled([extractCompanyGraphRelationships(f.input), extractCompanyGraphRelationships(f.input)]);
  assert.equal(posts, 1); assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
});
test("budget receipt recovers a response even when the service checkpoint callback failed", async t => {
  const f = setup(t); const methods: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/input_tokens")) return count(); methods.push(init?.method ?? "GET"); return complete();
  });
  await assert.rejects(extractCompanyGraphRelationships({ ...f.input, onResponseCreated: async () => { throw Error("checkpoint failed"); } }), /checkpoint failed/);
  await extractCompanyGraphRelationships(f.input);
  assert.deepEqual(methods, ["POST", "GET"]);
});
test("missing terminal usage keeps the full liability and cannot authorize another generation", async t => {
  const f = setup(t); let posts = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => { if (url.endsWith("/input_tokens")) return count(); if (init?.method === "POST") posts++; return complete({ usage: null }); });
  await assert.rejects(extractCompanyGraphRelationships(f.input));
  await assert.rejects(extractCompanyGraphRelationships(f.input));
  assert.equal(posts, 1); assert.equal((await getGraphBudgetSummary(f.db, now)).reservedUsd, 4.44576);
});
test("invalid or oversized token counts prevent every generation", async t => {
  const f = setup(t); let tokens: unknown = 100001, posts = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => { if (url.endsWith("/input_tokens")) return Response.json({ object: "response.input_tokens", input_tokens: tokens }); posts++; return complete(); });
  for (tokens of [100001, 0, 1.5, null, "1000"]) await assert.rejects(extractCompanyGraphRelationships(f.input), /token count/);
  assert.equal(posts, 0);
});
test("an unknown model, expired pricing or unavailable budget store prevents any API request", async t => {
  const f = setup(t); let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return count(); });
  process.env.OPENAI_MODEL = "unknown";
  await assert.rejects(extractCompanyGraphRelationships(f.input), /approved budget pricing/);
  process.env.OPENAI_MODEL = "gpt-5.6-sol";
  await assert.rejects(extractCompanyGraphRelationships({ ...f.input, budgetNow: () => Date.parse("2026-11-22T00:00:00Z") }));
  t.mock.method(f.db, "collection", () => { throw Error("datastore unavailable"); });
  await assert.rejects(extractCompanyGraphRelationships(f.input), /datastore unavailable/);
  assert.equal(calls, 0);
});

test("already admitted responses remain recoverable after the reviewed pricing window expires", async t => {
  const f = setup(t); const methods: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/input_tokens")) return count(); methods.push(init?.method ?? "GET"); return complete();
  });
  const beforeExpiry = Date.parse("2026-11-21T23:59:50Z"), afterExpiry = Date.parse("2026-11-22T00:00:01Z");
  await assert.rejects(extractCompanyGraphRelationships({ ...f.input, budgetNow: () => beforeExpiry,
    onResponseCreated: async () => { throw Error("checkpoint failed"); } }), /checkpoint failed/);
  await extractCompanyGraphRelationships({ ...f.input, budgetNow: () => afterExpiry });
  assert.deepEqual(methods, ["POST", "GET"]);
  const state = await getGraphBudgetSummary(f.db, afterExpiry);
  assert.equal(state.reservedUsd, 0); assert.equal(state.blocked, true);
});

test("the rollout pause blocks every new paid admission before any provider call", async t => {
  const f = setup(t); delete process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED; let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return complete(); });
  await assert.rejects(extractCompanyGraphRelationships(f.input), /New paid graph requests are paused/);
  assert.equal(calls, 0); assert.equal(f.rows.size, 0);
  assert.equal((await getGraphBudgetSummary(f.db, now)).newRequestsPaused, true);
});
test("real NVDA token-count drift settles within held dollars using only its saved response GET", async t => {
  const f = setup(t);
  const id = `_graph_budget_request_${createHash("sha256").update(f.input.budgetRequestId).digest("hex")}`;
  f.rows.set("company_research_runs/_graph_daily_budget", { day: "2026-10-01", limitMicros: 5e6, spentMicros: 0, reservedMicros: 383345 });
  f.rows.set(`company_research_runs/${id}`, { id, requestKey: f.input.budgetRequestId, model: "gpt-5.6-sol", inputTokens: 11133,
    fingerprint: graphBudgetFingerprint(buildLegacyCompanyGraphResponseBody(f.input)), reservedMicros: 383345,
    responseId: "resp_test", status: "reserved", priceVersion: GRAPH_LEGACY_PRICE_VERSION });
  const ticket = (await findGraphBudgetTicket(f.input.budgetRequestId, f.db))!;
  delete process.env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls++; assert.equal(url, "https://api.openai.com/v1/responses/resp_test"); assert.equal(init?.method, "GET");
    return complete({ service_tier: "default", reasoning: undefined, prompt_cache_options: undefined, usage: { input_tokens: 11138, output_tokens: 3806, total_tokens: 14944 } });
  });
  await extractCompanyGraphRelationships({ ...f.input, responseId: "resp_test" });
  assert.equal(calls, 1); const budget = await getGraphBudgetSummary(f.db, now);
  assert.equal(budget.spentUsd, 0.13181); assert.equal(budget.reservedUsd, 0);
  assert.equal(budget.remainingUsd, 4.86819); assert.equal(budget.newRequestsPaused, true);
  const receipt = f.rows.get(`company_research_runs/${ticket.id}`)!;
  assert.equal(receipt.inputTokens, 11133); assert.equal(receipt.usageInputTokens, 11138); assert.equal(receipt.inputTokenDelta, 5);
  assert.equal(receipt.usageOutputTokens, 3806);
  assert.equal(receipt.priceVersion, GRAPH_LEGACY_PRICE_VERSION); assert.equal(receipt.ticketVersion, undefined);
  const settled = structuredClone([...f.rows]);
  await extractCompanyGraphRelationships({ ...f.input, responseId: "resp_test" });
  assert.deepEqual([...f.rows], settled);
});

test("409 and 429 rejections retain the full hold with no paid retry or Standard fallback", async t => {
  for (const status of [409, 429]) {
    const f = setup(t); let posts = 0;
    const mock = t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("/input_tokens")) return count();
      assert.equal(init?.method, "POST"); assert.equal(JSON.parse(String(init?.body)).service_tier, "flex");
      posts++;
      return Response.json({ error: { message: "Resource Unavailable", code: "resource_unavailable" } }, { status });
    });
    await assert.rejects(extractCompanyGraphRelationships(f.input), /Resource Unavailable/);
    await assert.rejects(extractCompanyGraphRelationships(f.input), GraphBudgetUncertainError);
    assert.equal(posts, 1); assert.equal((await getGraphBudgetSummary(f.db, now)).reservedUsd, 4.44576);
    mock.mock.restore();
  }
});
test("a timed-out paid POST retains its full hold and cannot be retried", async t => {
  const f = setup(t); let posts = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/input_tokens")) return count();
    posts++; throw new DOMException("Provider request timed out", "TimeoutError");
  });
  await assert.rejects(extractCompanyGraphRelationships(f.input), /timed out/);
  await assert.rejects(extractCompanyGraphRelationships(f.input), GraphBudgetUncertainError);
  assert.equal(posts, 1); assert.equal((await getGraphBudgetSummary(f.db, now)).reservedUsd, 4.44576);
});
test("new receipts fail closed on missing or conflicting Flex metadata and recover only with GET", async t => {
  for (const changed of [{ service_tier: "default" }, { reasoning: { mode: "pro" } }, { reasoning: undefined },
    { prompt_cache_options: undefined }, { prompt_cache_options: { mode: "implicit" } },
    { usage: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1000 } } }]) {
    const f = setup(t); const methods: string[] = [];
    const mock = t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("/input_tokens")) return count();
      methods.push(init?.method ?? "GET"); return complete(changed);
    });
    await assert.rejects(extractCompanyGraphRelationships(f.input));
    await assert.rejects(extractCompanyGraphRelationships(f.input));
    assert.deepEqual(methods, ["POST", "GET"]);
    assert.equal((await getGraphBudgetSummary(f.db, now)).reservedUsd, 4.44576);
    mock.mock.restore();
  }
});
test("preflight undercount does not reduce the reservation or cap valid terminal input usage", async t => {
  const f = setup(t); let posts = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/input_tokens")) return Response.json({ object: "response.input_tokens", input_tokens: 1 });
    posts++; assert.equal((await getGraphBudgetSummary(f.db, now)).reservedUsd, 4.44576);
    return complete({ usage: { input_tokens: 300000, output_tokens: 100, total_tokens: 300100,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } } });
  });
  await extractCompanyGraphRelationships(f.input);
  assert.equal(posts, 1); assert.equal((await getGraphBudgetSummary(f.db, now)).spentUsd, 1.2015);
  assert.equal((await getGraphBudgetSummary(f.db, now)).blocked, true);
});
test("changing a resumed request payload prevents every provider call", async t => {
  const f = setup(t); let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => { calls++; return url.endsWith("/input_tokens") ? count() : complete(); });
  await extractCompanyGraphRelationships(f.input);
  assert.equal(calls, 2);
  await assert.rejects(extractCompanyGraphRelationships({ ...f.input, extractionText: "A different filing" }), /payload changed/);
  assert.equal(calls, 2);
});
