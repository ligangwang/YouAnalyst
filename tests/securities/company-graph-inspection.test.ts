import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { inspectCompanyGraphRequest, redactGraphFailure } from "../../src/lib/company-graph/inspection";
import { companyGraphRequestId } from "../../src/lib/company-graph/pubsub";
import { COMPANY_GRAPH_EXTRACTION_VERSION } from "../../src/lib/company-graph/types";

const ticker = "NVDA", accessionNumber = "0001045810-26-000001";
const iso = "2026-10-01T20:00:00.000Z", now = Date.parse(iso);
const requestId = companyGraphRequestId(ticker, 2);
const runId = `graph_${createHash("sha256").update(JSON.stringify([
  ticker, accessionNumber, COMPANY_GRAPH_EXTRACTION_VERSION, requestId,
])).digest("hex")}`;
const requestPath = `company_research_requests/${ticker}`;
const sourcePath = `company_research_runs/_graph_source_${requestId}`;
const runPath = `company_research_runs/_graph_run_${runId}`;
const reservationPath = `company_research_runs/_graph_budget_request_${createHash("sha256").update(runId).digest("hex")}`;
const budgetPath = "company_research_runs/_graph_daily_budget";
const sentinel = "PRIVATE_PROVIDER_CONTENT";
type Data = Record<string, unknown>;

function fixture() {
  const rows = new Map<string, Data>([
    [requestPath, { ticker, requestId, generation: 2, force: true, extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION,
      status: "FAILED", error: "Graph input-token count cannot be verified; no generation was started.", attemptCount: 1,
      queuedAt: iso, dispatchedAt: iso, processingStartedAt: iso, failedAt: iso, updatedAt: iso,
      leaseExpiresAtMs: 0, nextAttemptAtMs: now + 60_000, budgetDeferredUntilMs: 0 }],
    [sourcePath, { company: { ticker, cik: "0001045810", name: sentinel }, filing: { accessionNumber, filingUrl: sentinel } }],
    [runPath, { ticker, accessionNumber, extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION, status: "PROCESSING",
      createdAt: iso, providerResponseId: "resp_private_identity", providerResult: { output: sentinel },
      result: { ticker, runId, filing: { accessionNumber }, extractionVersion: COMPANY_GRAPH_EXTRACTION_VERSION, edges: [sentinel] } }],
    [reservationPath, { requestKey: runId, status: "reserved", reservedMicros: 500_000, responseId: "resp_private_identity",
      createdAt: iso, fingerprint: sentinel, inputTokens: 34_464 }],
    [budgetPath, { day: "2026-10-01", limitMicros: 5_000_000, spentMicros: 100_000, reservedMicros: 500_000 }],
  ]);
  const calls: string[] = [];
  // Deliberately no write, query, transaction, source, or provider APIs.
  const db = { collection(collection: string) { return { doc(id: string) { return {
    get: async () => { const path = `${collection}/${id}`; calls.push(path); return { data: () => rows.get(path) }; },
  }; } }; } } as unknown as Firestore;
  return { rows, calls, db, inspect: () => inspectCompanyGraphRequest(db, ticker, now) };
}

test("failure diagnostics read only the exact request, frozen source, run and reservation with daily budget", async () => {
  const f = fixture(), before = structuredClone([...f.rows]);
  const result = await f.inspect();
  assert.deepEqual([...f.calls].sort(), [requestPath, sourcePath, runPath, reservationPath, budgetPath].sort());
  assert.deepEqual([...f.rows], before);
  assert.equal(result.request.error, f.rows.get(requestPath)!.error);
  assert.equal(result.request.requestId, requestId); assert.equal(result.request.identityMatches, true);
  assert.equal(result.request.attemptCount, 1); assert.equal(result.request.failedAt, iso);
  assert.equal(result.request.nextAttemptAtMs, now + 60_000);
  assert.equal(result.source?.accessionNumber, accessionNumber);
  assert.equal(result.run?.runId, runId); assert.equal(result.run?.identityMatches, true);
  assert.equal(result.run?.providerResultPresent, true); assert.equal(result.run?.providerResponsePresent, true);
  assert.equal(result.run?.resultIdentityMatches, true); assert.equal(result.run?.completed, false);
  assert.equal(result.reservation?.status, "reserved"); assert.equal(result.reservation?.reservedUsd, 0.5);
  assert.equal(result.reservation?.spentUsd, null); assert.equal(result.reservation?.matchesRunResponse, true);
  assert.deepEqual(result.dailyBudget, { limitUsd: 5, spentUsd: 0.1, reservedUsd: 0.5, remainingUsd: 4.4,
    day: "2026-10-01", timezone: "America/New_York", blocked: true, newRequestsPaused: true, requestReservationUsd: 4.44576, pricingValidUntil: "2026-11-22T00:00:00.000Z" });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER_CONTENT|resp_private_identity|fingerprint|inputTokens|filingUrl|edges/);
});

test("absence, uncertain reservations and settlement remain distinguishable without provider retrieval", async () => {
  for (const mode of ["no-reservation", "uncertain", "settled"] as const) {
    const f = fixture();
    if (mode === "no-reservation") f.rows.delete(reservationPath);
    else if (mode === "uncertain") { f.rows.get(reservationPath)!.responseId = null; delete f.rows.get(runPath)!.providerResponseId; }
    else Object.assign(f.rows.get(reservationPath)!, { status: "settled", spentMicros: 123_456, settledAt: iso });
    const result = await f.inspect();
    assert.equal(result.reservation?.exists, mode !== "no-reservation");
    assert.equal(result.reservation?.providerResponsePresent, mode === "settled");
    assert.equal(result.reservation?.spentUsd, mode === "settled" ? 0.123456 : null);
    assert.equal(result.reservation?.settledAt, mode === "settled" ? iso : null);
    assert.equal(f.calls.length, 5);
  }
});

test("invalid request or source identity cannot expand inspection to another company's work", async () => {
  for (const patch of [null, { ticker: "AMD" }, { requestId: "../other/secret" }, { generation: 3 },
    { force: "yes" }, { queuedAt: sentinel }, { extractionVersion: "old" }]) {
    const f = fixture();
    if (patch === null) f.rows.delete(requestPath); else Object.assign(f.rows.get(requestPath)!, patch);
    const result = await f.inspect();
    assert.equal(result.request.identityMatches, false); assert.equal(result.run, null);
    assert.deepEqual([...f.calls].sort(), [requestPath, budgetPath].sort());
    assert.doesNotMatch(JSON.stringify(result), /\.\.\/other\/secret|PRIVATE_PROVIDER_CONTENT/);
  }
  for (const source of [{ company: { ticker: "AMD", cik: "0001045810" }, filing: { accessionNumber } },
    { company: { ticker, cik: "bad" }, filing: { accessionNumber } },
    { company: { ticker, cik: "0001045810" }, filing: { accessionNumber: "../other" } }, null]) {
    const f = fixture();
    if (source === null) f.rows.delete(sourcePath); else f.rows.set(sourcePath, source);
    const result = await f.inspect();
    assert.equal(result.source?.identityMatches, false); assert.equal(result.run, null);
    assert.deepEqual([...f.calls].sort(), [requestPath, budgetPath, sourcePath].sort());
  }
  const f = fixture();
  await assert.rejects(inspectCompanyGraphRequest(f.db, "NVDA/AMD", now), /explicit US ticker/);
  assert.deepEqual(f.calls, []);
});

test("diagnostics expose mismatched checkpoints and suppress invalid amounts and arbitrary field values", async () => {
  const f = fixture();
  Object.assign(f.rows.get(runPath)!, { ticker: "AMD", status: sentinel, createdAt: sentinel, result: { runId: "wrong" } });
  Object.assign(f.rows.get(reservationPath)!, { requestKey: "wrong", status: sentinel, responseId: "other",
    reservedMicros: -1, spentMicros: "123", settledAt: sentinel });
  const result = await f.inspect();
  assert.equal(result.run?.identityMatches, false); assert.equal(result.run?.resultIdentityMatches, false);
  assert.equal(result.reservation?.requestKeyMatches, false); assert.equal(result.reservation?.matchesRunResponse, false);
  assert.equal(result.reservation?.reservedUsd, null); assert.equal(result.reservation?.spentUsd, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER_CONTENT|wrong|other/);
});

test("saved failure redaction retains bounded useful messages but never objects, bodies, stacks or credentials", () => {
  assert.equal(redactGraphFailure("Graph budget request payload changed; paid processing is blocked."),
    "Graph budget request payload changed; paid processing is blocked.");
  for (const message of [
    "Failure Bearer privateBearer; retry", "Failure Basic privateBasic", "api_key=privateApiKey",
    "access_token: privateAccessToken", "password='private password phrase'", "client-secret=privateClientSecret",
    "OPENAI_API_KEY=privateProviderKey", "CLIENT_SECRET=privateClientSecret", "secret: privateSecret",
    "?key=privateQueryKey&operation=get", "token=privateToken", "sk-proj-privateApiKey", "ghp_privateGithubKey",
    "https://name:privatePassword@example.test/path?api_key=privateQueryKey", "prompt: privatePrompt",
    "fingerprint: privateFingerprint", 'Provider failed: {"error":"privateRawBody"}',
    "Error\n    at privateStack", "Authorization: Bearer privateBearer", "api_token=privateToken",
    "Bearer " + "privateToken".repeat(200), "opaque=" + "privateOpaque".repeat(4),
    'Unexpected token \'P\', "PRIVATE PAYLOAD" is not valid JSON',
    "Unexpected token 'privatePayload'", 'Expected property name or \'}\' in JSON at position 1: privatePayload',
  ]) assert.doesNotMatch(redactGraphFailure(message), /private/i, message);
  assert.equal(redactGraphFailure(new SyntaxError("private provider body")),
    "Saved failure: JSON or syntax parsing failed; raw content withheld");
  assert.equal(redactGraphFailure(new Error("Useful failure\n    at privateStack")), "Useful failure");
  assert.equal(redactGraphFailure({ message: "privateRawObject", stack: "privateStack" }), "No saved error message");
  assert.equal(redactGraphFailure(""), "No saved error message");
  assert.equal(redactGraphFailure("safe error ".repeat(300)).length, 1000);
  const f = fixture(); f.rows.get(requestPath)!.error = "Authorization: Bearer privateBearer";
  return f.inspect().then(result => assert.doesNotMatch(JSON.stringify(result), /privateBearer/));
});
