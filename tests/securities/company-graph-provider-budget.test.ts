import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { extractCompanyGraphRelationships, buildCompanyGraphResponseBody } from "../../src/lib/company-graph/openai";
import { setGraphBudgetLimit, getGraphBudgetSummary, GraphBudgetExceededError, GraphBudgetUncertainError } from "../../src/lib/company-graph/budget";
import { budgetFixture } from "../helpers/graph-budget";
const now = Date.parse("2026-10-01T12:00:00Z");
function setup(t: TestContext) {
  const previous = [process.env.OPENAI_API_KEY, process.env.OPENAI_MODEL];
  process.env.OPENAI_API_KEY = "mock-local-only"; process.env.OPENAI_MODEL = "gpt-5.6-sol";
  t.after(() => { ["OPENAI_API_KEY", "OPENAI_MODEL"].forEach((key, i) => {
    if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
  }); });
  const f = budgetFixture();
  return { ...f, input: { companyName: "NVIDIA", ticker: "NVDA", accessionNumber: "0001045810-26-000001", filingDate: "2026-02-01",
    extractionText: "NVIDIA competes with AMD.", budgetRequestId: "graph_test", budgetDb: f.db, budgetNow: () => now } };
}
const count = () => Response.json({ object: "response.input_tokens", input_tokens: 1000 });
const complete = (fields: Record<string, unknown> = {}) => Response.json({ id: "resp_test", model: "gpt-5.6-sol", status: "completed",
  output_text: '{"relationships":[]}', usage: { input_tokens: 1000, output_tokens: 100 }, ...fields });
test("the exact messages and structured-output schema are counted before a reserved Standard request", async t => {
  const f = setup(t), payloads: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    payloads.push(JSON.parse(String(init?.body)));
    if (url.endsWith("/input_tokens")) return count();
    assert.equal((await getGraphBudgetSummary(f.db, now)).reservedUsd, 0.33268);
    return complete();
  });
  await extractCompanyGraphRelationships(f.input);
  assert.equal(payloads.length, 2);
  const body = buildCompanyGraphResponseBody(f.input);
  assert.deepEqual(payloads[0], { model: body.model, input: body.input, text: body.text });
  assert.deepEqual(payloads[1], body);
  assert.equal(body.max_output_tokens, 16384); assert.equal(body.service_tier, "default");
  assert.equal("tools" in body, false); assert.equal("previous_response_id" in body, false);
  const budget = await getGraphBudgetSummary(f.db, now);
  assert.equal(budget.spentUsd, 0.007); assert.equal(budget.reservedUsd, 0);
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
  assert.equal((await getGraphBudgetSummary(f.db, now)).reservedUsd, 0.33268);
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
  assert.equal(posts, 1); assert.equal((await getGraphBudgetSummary(f.db, now)).reservedUsd, 0.33268);
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
