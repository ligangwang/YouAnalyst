import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { loadJobHistory, cleanDetails, type CloudRequest } from "../../src/lib/admin-jobs/service";
import { jobHistoryResponse } from "../../src/lib/admin-jobs/http";

function fixture(responses: unknown[]) {
  const calls: { url: string; data?: unknown }[] = [];
  const request: CloudRequest = async <T>(url: string, data?: unknown) => {
    calls.push({ url, data });
    const result = responses.shift();
    if (result instanceof Error) throw result;
    return result as T;
  };
  return { request, calls };
}

test("private valuation check history reads subscriber logs separately from publisher executions", async () => {
  const f = fixture([{ entries: [{ timestamp: "2026-09-29T00:00:00Z", jsonPayload: { runId: "check-attempt" } }] },
    { entries: [{ jsonPayload: { runId: "check-attempt", message: "private-valuation-check: run_completed", completed: 1, company: "ORG:OPENAI" } }] }]);
  const page = await loadJobHistory({ job: "privateValuationChecks", view: "runs" }, f.request, "test-project");
  assert.equal(page.records[0].status, "Succeeded");
  assert.equal(page.records[0].summary.completed, 1);
  assert.match(JSON.stringify(f.calls[0].data), /private-valuation-check/);
  assert.match(JSON.stringify(f.calls[0].data), /cloud_run_revision/);
});

test("A-share and directory processing histories use their own subscriber logs", async () => {
  for (const [job, label] of [["cnFundamentalsChecks", "cn-fundamentals-check"], ["directoryImports", "cni-directory-import"]] as const) {
    const f = fixture([{ entries: [{ timestamp: "2026-09-29T00:00:00Z", jsonPayload: { runId: "attempt" } }] },
      { entries: [{ jsonPayload: { runId: "attempt", message: `${label}: run_completed`, completed: 1 } }] }]);
    const page = await loadJobHistory({ job, view: "runs" }, f.request, "test-project");
    assert.equal(page.records[0].status, "Succeeded");
    assert.match(JSON.stringify(f.calls[0].data), new RegExp(label));
  }
});
test("fundamentals batch history exposes completed and remaining counts from subscriber logs", async () => {
  const f = fixture([{ entries: [{ timestamp: "2026-09-27T00:00:00Z", jsonPayload: { runId: "batch-attempt" } }] },
    { entries: [{ jsonPayload: { runId: "batch-attempt", message: "sec-fundamentals-batch: run_completed", requested: 20, completed: 20, remaining: 0 } }] }]);
  const page = await loadJobHistory({ job: "fundamentalsBatches", view: "runs" }, f.request, "test-project");
  assert.equal(page.records[0].status, "Succeeded");
  assert.equal(page.records[0].summary.completed, 20);
  assert.match(JSON.stringify(f.calls[0].data), /sec-fundamentals-batch/);
});
test("worker history uses bounded provider pagination and authoritative execution status", async () => {
  const f = fixture([{ executions: [
    { name: "jobs/fundamentals/executions/e1", createTime: "2026-09-21T00:00:00Z", completionTime: "2026-09-21T00:01:00Z", conditions: [{ type: "Completed", state: "CONDITION_FAILED", message: "Container failed" }] },
    { name: "jobs/fundamentals/executions/e2", createTime: "2026-09-20T00:00:00Z", conditions: [{ type: "Completed", state: "CONDITION_SUCCEEDED" }] },
  ], nextPageToken: "next-worker-page" }, { entries: [{ labels: { "run.googleapis.com/execution_name": "e1" }, jsonPayload: { failed: 2, processed: 4 } }] }]);
  const page = await loadJobHistory({ job: "fundamentals", view: "runs", pageToken: "opaque+/=" }, f.request, "test-project");
  assert.equal(page.nextPageToken, "next-worker-page");
  assert.deepEqual(page.records.map(r => r.status), ["Failed", "Succeeded"]);
  assert.equal(page.records[0].summary.failed, 2);
  assert.equal(page.records[0].durationMs, 60_000);
  const params = new URL(f.calls[0].url).searchParams;
  assert.equal(params.get("pageSize"), "20");
  assert.equal(params.get("pageToken"), "opaque+/=");
  assert.equal(f.calls.length, 2);
});
test("worker status changes from starting to running only when a start time exists", async () => {
  const execution = { name: "jobs/fundamentals/executions/e1", createTime: "2026-09-21T00:00:00Z", conditions: [{ type: "Completed", state: "CONDITION_PENDING", message: "Waiting for execution to start." }] };
  const f = fixture([{ executions: [execution] }, { entries: [] },
    { executions: [{ ...execution, startTime: "2026-09-21T00:01:00Z" }] }, { entries: [] }]);
  const starting = (await loadJobHistory({ job: "fundamentals", view: "runs" }, f.request, "test-project")).records[0];
  assert.equal(starting.status, "Starting");
  assert.match(starting.message!, /preparing the worker/);
  const running = (await loadJobHistory({ job: "fundamentals", view: "runs" }, f.request, "test-project")).records[0];
  assert.equal(running.status, "Running");
  assert.equal(running.startedAt, "2026-09-21T00:01:00Z");
  assert.match(running.message!, /Execution has started/);
  assert.doesNotMatch(running.message!, /Waiting/);
});
test("EOD pages join outcomes by run ID; incomplete runs never claim success", async () => {
  const f = fixture([{ entries: ["a", "b", "c"].map(runId => ({ timestamp: "2026-01-01T00:00:00Z", jsonPayload: { runId } })), nextPageToken: "next-eod" }, {
    entries: [ { timestamp: "2026-01-01T00:01:00Z", jsonPayload: { runId: "a", message: "daily-eod-maintenance: run_failed", error: { message: "contention" } } },
      { jsonPayload: { runId: "b", message: "daily-eod-maintenance: run_completed", priceLoad: { failed: 1 } } } ],
  }]);
  const page = await loadJobHistory({ job: "china", view: "runs", pageToken: "first-page" }, f.request, "test-project");
  assert.deepEqual(page.records.map(r => r.status), ["Failed", "Completed with errors", "No completion recorded"]);
  assert.equal(page.nextPageToken, "next-eod");
  assert.match(JSON.stringify(f.calls[0].data), /CN_A/);
  assert.equal((f.calls[0].data as { pageSize: number }).pageSize, 20);
  assert.equal((f.calls[0].data as { pageToken: string }).pageToken, "first-page");
  const resultFilter = (f.calls[1].data as { filter: string }).filter;
  assert.match(resultFilter, /timestamp>="2026-01-01T00:00:00Z"/);
  assert.match(resultFilter, /jsonPayload.message=\("daily-eod-maintenance: run_completed" OR "daily-eod-maintenance: run_failed"\)/);
});
test("empty Logging pages retain next cursor, errors include SEC and detailed logs are execution-scoped", async () => {
  const f = fixture([{ entries: [], nextPageToken: "scan-more" }, { entries: [] }]);
  const page = await loadJobHistory({ job: "fundamentals", view: "errors" }, f.request, "test-project");
  assert.equal(page.nextPageToken, "scan-more");
  assert.match((f.calls[0].data as { filter: string }).filter, /sec_request_failed/);
  await loadJobHistory({ job: "fundamentals", view: "logs", execution: "execution-1", pageToken: "next" }, f.request, "test-project");
  assert.match((f.calls[1].data as { filter: string }).filter, /execution_name.*execution-1/);
});
test("scheduler delivery is distinct from the job result and credentials are redacted", async () => {
  const f = fixture([{ entries: [
    { insertId: "a", severity: "INFO", jsonPayload: { "@type": "type.googleapis.com/google.cloud.scheduler.logging.AttemptFinished" } },
    { insertId: "b", severity: "ERROR", jsonPayload: { "@type": "type.googleapis.com/google.cloud.scheduler.logging.AttemptFinished", status: "PERMISSION_DENIED" } },
  ] }]);
  const page = await loadJobHistory({ job: "directory", view: "scheduler" }, f.request, "test-project");
  assert.deepEqual(page.records.map(r => r.status), ["Delivered", "Delivery failed"]);
  assert.match(JSON.stringify(f.calls[0].data), /sync-cni-directory-production/);
  assert.deepEqual(cleanDetails({ authorization: "secret", headers: {}, error: { message: "Bearer abc https://x?token=xyz", code: 429 } }), { error: { message: "Bearer [REDACTED] https://x?token=[REDACTED]", code: 429 } });
});
test("admin API denies anonymous and regular users before cloud access and validates parameters", async () => {
  type Dependencies = NonNullable<Parameters<typeof jobHistoryResponse>[1]>;
  const dependencies: Dependencies = { getUser: async () => null, isAdmin: async () => false, load: async () => { throw new Error("Cloud must not be called"); } };
  const request = (params = "") => new NextRequest(`https://example.test/api/admin/jobs${params}`);
  assert.equal((await jobHistoryResponse(request(), dependencies)).status, 401);
  dependencies.getUser = async () => ({ uid: "regular-user" }) as Awaited<ReturnType<Dependencies["getUser"]>>;
  assert.equal((await jobHistoryResponse(request(), dependencies)).status, 403);
  dependencies.isAdmin = async () => true;
  for (const query of ["?job=__proto__", "?view=delete", "?runId=bad%22%20OR%20true", `?pageToken=${"x".repeat(16001)}`]) {
    assert.equal((await jobHistoryResponse(request(query), dependencies)).status, 400);
  }
  dependencies.load = async input => { assert.equal(input.pageToken, "next"); return { records: [], nextPageToken: "more" }; };
  const response = await jobHistoryResponse(request("?job=us&pageToken=next"), dependencies);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).nextPageToken, "more");
});

test("outcome lookup follows partial Logging pages instead of declaring a completed run missing", async () => {
  const f = fixture([{ entries: [{ timestamp: "2026-01-01T00:00:00Z", jsonPayload: { runId: "a" } }] },
    { entries: [], nextPageToken: "scan-2" }, { entries: [], nextPageToken: "scan-3" },
    { entries: [{ jsonPayload: { runId: "a", message: "daily-eod-maintenance: run_completed" } }] },
  ]);
  const page = await loadJobHistory({ job: "us", view: "runs" }, f.request, "test-project");
  assert.equal(page.records[0].status, "Succeeded");
  assert.equal((f.calls[2].data as { pageToken: string }).pageToken, "scan-2");
  assert.equal((f.calls[3].data as { pageToken: string }).pageToken, "scan-3");
});

test("EOD result scan starts at the oldest run on the requested page and keeps subsecond precision", async () => {
  const since = "2026-09-18T17:10:52.123456Z";
  const f = fixture([{ entries: [
    { timestamp: "2026-09-21T17:10:52.987654Z", jsonPayload: { runId: "new" } },
    { timestamp: since, jsonPayload: { runId: "old" } },
  ], nextPageToken: "older-runs" }, { entries: ["new", "old"].map(runId => ({ jsonPayload: { runId, message: "daily-eod-maintenance: run_completed", priceLoad: { loaded: 52, failed: 0 } } })) }]);
  const result = await loadJobHistory({ job: "us", view: "runs", pageToken: "page-two" }, f.request, "test-project");
  assert.ok((f.calls[1].data as { filter: string }).filter.includes(`timestamp>=${JSON.stringify(since)}`));
  assert.deepEqual(result.records.map(r => r.status), ["Succeeded", "Succeeded"]);
  assert.equal(result.nextPageToken, "older-runs");
  assert.equal(result.records[0].summary.priceLoad && (result.records[0].summary.priceLoad as {loaded:number}).loaded, 52);
});

test("exhausted result scans remain unknown rather than claiming success", async () => {
  const f = fixture([{ entries: [{timestamp: "2026-09-21T17:10:52Z", jsonPayload: {runId: "missing"}}] },
    ...[1,2,3].map(page => ({entries: [], nextPageToken: `scan-${page}`}))]);
  const result = await loadJobHistory({job: "us", view: "runs"}, f.request, "test-project");
  assert.equal(result.records[0].status, "Unknown");
  assert.ok(result.warning);
  assert.equal(f.calls.length, 4);
});

test("failed worker retains detailed results and failure from the same attempt across log pages", async () => {
  const labels = { "run.googleapis.com/execution_name": "e1" };
  const f = fixture([{ executions: [{ name: "jobs/fundamentals/executions/e1", createTime: "2026-09-21T00:00:00Z", conditions: [{ type: "Completed", state: "CONDITION_FAILED" }] }] },
    { entries: [{ labels, jsonPayload: { taskAttempt: "1", message: "refresh-sec-fundamentals: run_failed", error: { message: "2 requests failed" } } }], nextPageToken: "more-results" },
    { entries: [
      { labels, jsonPayload: { taskAttempt: "1", message: "refresh-sec-fundamentals: run_completed", processed: 11, failed: 2, remaining: 4, coverage: { cached: 67 } } },
      { labels, jsonPayload: { taskAttempt: "0", message: "refresh-sec-fundamentals: run_completed", processed: 99, failed: 1 } },
    ] },
  ]);
  const page = await loadJobHistory({ job: "fundamentals", view: "runs" }, f.request, "test-project");
  assert.equal(page.records[0].status, "Failed");
  assert.equal(page.records[0].summary.processed, 11);
  assert.equal(page.records[0].summary.failed, 2);
  assert.deepEqual(page.records[0].summary.error, { message: "2 requests failed" });
  assert.deepEqual(page.records[0].summary.coverage, { cached: 67 });
  assert.equal((f.calls[2].data as { pageToken: string }).pageToken, "more-results");
});
