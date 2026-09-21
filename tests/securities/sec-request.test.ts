import { test } from "node:test";
import assert from "node:assert/strict";
import { secRequest, withSecRequestContext } from "../../src/lib/sec-request";
import { fetchLatest10K, fetchLatest10KSections, resolveSecCompanyByTicker } from "../../src/lib/company-graph/sec";

const url = "https://data.sec.gov/api/xbrl/companyfacts/CIK0000002488.json";
const json = (response: Response) => response.json();

test("all HTTP errors are recorded once with company/run context and preserved numeric status", async t => {
  const logs: Record<string, unknown>[] = [];
  t.mock.method(console, "error", (line: string) => logs.push(JSON.parse(line)));
  for (const status of [400, 403, 404, 429, 500, 503]) {
    t.mock.method(globalThis, "fetch", async () => new Response("do not log body", { status, headers: { "retry-after": "3600", "x-request-id": "provider-id" } }));
    await assert.rejects(withSecRequestContext({ ticker: "AMD", runId: "run-1" }, () => secRequest(`${url}?token=private`, {}, json)), { code: status });
    const entry = logs.at(-1)!;
    assert.equal(entry.event, "sec_request_failed");
    assert.equal(entry.status, status);
    assert.equal(entry.kind, "http");
    assert.equal(entry.ticker, "AMD");
    assert.equal(entry.cik, "0000002488");
    assert.equal(entry.runId, "run-1");
    assert.equal(entry.endpoint, url);
    assert.equal(entry.retryAfter, "3600");
    assert.equal(entry.providerRequestId, "provider-id");
    assert.ok(entry.requestId);
    assert.ok(Number(entry.durationMs) >= 0);
  }
  assert.equal(logs.length, 6);
  assert.equal(new Set(logs.map(log => log.requestId)).size, 6);
  assert.doesNotMatch(JSON.stringify(logs), /private|do not log body/);
});

test("network errors retain underlying cause; timeouts and cancellation are distinguishable", async t => {
  const logs: Record<string, unknown>[] = [];
  t.mock.method(console, "error", (line: string) => logs.push(JSON.parse(line)));
  const failure = new TypeError("fetch failed", { cause: Object.assign(new Error("connection reset"), { code: "ECONNRESET" }) });
  t.mock.method(globalThis, "fetch", async () => { throw failure; });
  await assert.rejects(secRequest(url, {}, json), error => error === failure);
  assert.equal(logs[0].kind, "network");
  assert.equal(logs[0].status, null);
  assert.equal((logs[0].cause as { code: string }).code, "ECONNRESET");
  for (const name of ["TimeoutError", "AbortError"]) {
    const reason = new DOMException("test abort", name);
    t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => { init.signal!.throwIfAborted(); throw new Error("unreachable"); });
    await assert.rejects(secRequest(url, { signal: AbortSignal.abort(reason) }, json), error => error === reason);
    assert.equal(logs.at(-1)!.kind, name === "TimeoutError" ? "timeout" : "aborted");
  }
  assert.equal(logs.length, 3);
});

test("invalid JSON and response body read failures are captured; successful requests are quiet", async t => {
  const logs: Record<string, unknown>[] = [];
  t.mock.method(console, "error", (line: string) => logs.push(JSON.parse(line)));
  t.mock.method(globalThis, "fetch", async () => new Response("private-response-body", { headers: { "content-type": "text/html" } }));
  await assert.rejects(secRequest(url, {}, json), SyntaxError);
  assert.equal(logs[0].kind, "decode");
  assert.equal(logs[0].status, 200);
  assert.equal(logs[0].contentType, "text/html");
  assert.doesNotMatch(JSON.stringify(logs), /private-response-body/);
  const error = new Error("stream disconnected");
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(controller) { controller.error(error); } })));
  await assert.rejects(secRequest(url, {}, response => response.text()), caught => caught === error);
  assert.equal(logs[1].phase, "decode");
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true }));
  assert.deepEqual(await secRequest(url, {}, json), { ok: true });
  assert.equal(logs.length, 2);
});

test("company graph identities, submissions, and filing downloads all use the shared logger", async t => {
  const logs: Record<string, unknown>[] = [];
  t.mock.method(console, "error", (line: string) => logs.push(JSON.parse(line)));
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 403 }));
  await assert.rejects(resolveSecCompanyByTicker("AMD"), { code: 403 });
  await assert.rejects(fetchLatest10K("2488"), { code: 403 });
  await assert.rejects(fetchLatest10KSections("0000002488", {
    accessionNumber: "accession-1", filingDate: "2026-01-01", reportDate: null, primaryDocument: "annual.htm",
    filingUrl: "https://www.sec.gov/Archives/edgar/data/2488/annual.htm",
  }), { code: 403 });
  assert.equal(logs.length, 3);
  assert.equal(logs[0].ticker, "AMD");
  assert.equal(logs[1].cik, "0000002488");
  assert.equal(logs[2].accession, "accession-1");
  assert.equal(logs[2].operation, "filing_download");
});

test("parallel company requests keep separate correlation context", async t => {
  const logs: Record<string, unknown>[] = [];
  t.mock.method(console, "error", (line: string) => logs.push(JSON.parse(line)));
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 500 }));
  await Promise.all(["AMD", "NVDA"].map(ticker => assert.rejects(withSecRequestContext({ ticker, runId: ticker }, async () => {
    await Promise.resolve();
    return secRequest(url, {}, json);
  }))));
  assert.deepEqual(logs.map(log => [log.ticker, log.runId]).sort(), [["AMD", "AMD"], ["NVDA", "NVDA"]]);
});
