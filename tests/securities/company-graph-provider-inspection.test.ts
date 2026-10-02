import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { budgetFixture } from "../helpers/graph-budget";
import { inspectSavedGraphProviderResponse } from "../../scripts/graph-provider-inspection";
import { companyGraphRequestId } from "../../src/lib/company-graph/pubsub";
import { COMPANY_GRAPH_EXTRACTION_VERSION } from "../../src/lib/company-graph/types";
const requestId = companyGraphRequestId("NVDA", 1), accessionNumber = "0001045810-26-000021";
const runId = `graph_${createHash("sha256").update(JSON.stringify(["NVDA", accessionNumber, COMPANY_GRAPH_EXTRACTION_VERSION, requestId])).digest("hex")}`;
const reservationPath = `company_research_runs/_graph_budget_request_${createHash("sha256").update(runId).digest("hex")}`;
function fixture() {
  const f = budgetFixture();
  f.rows.set("company_research_requests/NVDA", { ticker: "NVDA", status: "FAILED", requestId, generation: 1, force: true,
    extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION, queuedAt: "2026-10-02T00:18:06.790Z" });
  f.rows.set(`company_research_runs/_graph_source_${requestId}`, { company: { ticker: "NVDA", cik: "0001045810" }, filing: { accessionNumber } });
  f.rows.set(`company_research_runs/_graph_run_${runId}`, { ticker: "NVDA", accessionNumber, extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION,
    status: "PROCESSING", providerResponseId: "resp_saved_private" });
  f.rows.set(reservationPath, { requestKey: runId, fingerprint: "private-fingerprint", inputTokens: 11133, reservedMicros: 383345,
    responseId: "resp_saved_private", model: "gpt-5.6-sol", priceVersion: "gpt-5.6-sol-standard-2026-10-01", status: "reserved" });
  return f;
}
const body = () => ({ id: "resp_saved_private", model: "gpt-5.6-sol", status: "completed", service_tier: "default",
  usage: { input_tokens: 11133, output_tokens: 1000, total_tokens: 12133 }, output_text: "PRIVATE_PROVIDER_OUTPUT", input: "PRIVATE_PROMPT" });
test("saved-response inspection performs one GET and cannot publish, settle or expose raw content", async () => {
  const f = fixture(), before = structuredClone([...f.rows]); let calls = 0;
  const result = await inspectSavedGraphProviderResponse(f.db, requestId, "mock-local-secret", (async (url, init) => {
    calls++; assert.equal(url, "https://api.openai.com/v1/responses/resp_saved_private");
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error"); assert.equal(init?.body, undefined);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer mock-local-secret");
    return Response.json(body());
  }) as typeof fetch);
  assert.equal(calls, 1); assert.deepEqual([...f.rows], before);
  assert.equal(result.metadataAvailable, true); assert.equal(result.conservativeUsageUsd, 0.075665);
  assert.equal(result.checks?.costWithinReservation, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|resp_saved_private|mock-local-secret|fingerprint/);
});
test("a missing or superseded saved identity prevents all provider requests", async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => f.rows.get("company_research_requests/NVDA")!.requestId = companyGraphRequestId("NVDA", 2),
    (f: ReturnType<typeof fixture>) => f.rows.get(reservationPath)!.responseId = null,
    (f: ReturnType<typeof fixture>) => f.rows.get(reservationPath)!.requestKey = "wrong",
    (f: ReturnType<typeof fixture>) => f.rows.get(`company_research_runs/_graph_run_${runId}`)!.providerResponseId = "resp_wrong",
  ]) {
    const f = fixture(); change(f); let calls = 0;
    await assert.rejects(inspectSavedGraphProviderResponse(f.db, requestId, "mock-local-secret", (async () => { calls++; return Response.json(body()); }) as typeof fetch));
    assert.equal(calls, 0);
  }
});
test("metadata distinguishes model and usage invariant failures while retaining every reservation", async () => {
  for (const change of [{ model: "unreviewed-model" }, { usage: { input_tokens: 11134, output_tokens: 16385 } }, { usage: null }, { status: "in_progress" }]) {
    const f = fixture(), before = structuredClone([...f.rows]);
    const result = await inspectSavedGraphProviderResponse(f.db, requestId, "mock-local-secret", (async () => Response.json({ ...body(), ...change })) as typeof fetch);
    assert.ok(result.checks && Object.values(result.checks).includes(false));
    assert.deepEqual([...f.rows], before);
  }
});
test("HTTP failures do not inspect or return provider error bodies", async () => {
  const f = fixture();
  const result = await inspectSavedGraphProviderResponse(f.db, requestId, "mock-local-secret", (async () => ({ ok: false, status: 403,
    json: () => { throw Error("must not inspect raw error"); } })) as unknown as typeof fetch);
  assert.deepEqual(result, { providerCalls: 1, method: "GET", httpStatus: 403, metadataAvailable: false });
});
test("provider metadata probe is opt-in and reuses only the existing production secret", () => {
  const workflow = readFileSync(".github/workflows/inspect-sec-graph.yml", "utf8");
  assert.match(workflow, /inputs\.company == 'NVDA' && inputs\.saved_nvda_request != ''/);
  assert.match(workflow, /EXPECTED_GRAPH_REQUEST_ID: \$\{\{ inputs\.saved_nvda_request \}\}/);
  assert.match(workflow, /OPENAI_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \}\}/);
  const script = readFileSync("scripts/inspect-saved-graph-response.ts", "utf8");
  assert.match(script, /process\.env\.COMPANY !== "NVDA"/);
  assert.doesNotMatch(script, /console\.(?:error|log)\(error/);
});
