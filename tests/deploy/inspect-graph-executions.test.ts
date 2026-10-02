import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const job = "refresh-company-graph-production";
const project = "ifindata-80905", region = "us-central1";
const sentinel = "DO_NOT_PRINT_PROVIDER_CONTENT_OR_SECRETS";
const digest = `sha256:${"a".repeat(64)}`;
const createdAt = "2026-10-01T20:00:00.123456789Z";
const execution = () => ({
  apiVersion: "run.googleapis.com/v1", kind: "Execution",
  metadata: { name: `${job}-abc12`, namespace: "123456789", creationTimestamp: createdAt,
    labels: { "run.googleapis.com/job": job, "cloud.googleapis.com/location": region, unrelated: sentinel },
    annotations: { "run.googleapis.com/overrides": JSON.stringify({ env: { SECRET: sentinel } }) } },
  spec: { taskCount: 1, template: { spec: { maxRetries: 1, serviceAccountName: sentinel, containers: [{
    image: `${region}-docker.pkg.dev/${project}/ifindata/sec-fundamentals@${digest}`,
    command: ["node"], args: ["dist/refresh-company-graph.cjs", "--verify-live"],
    env: [{ name: "SECRET", value: sentinel }, { name: "OTHER", valueFrom: { secretKeyRef: { name: sentinel } } }],
  }] } } },
  status: { startTime: "2026-10-01T20:00:01Z", completionTime: "2026-10-01T20:01:00Z",
    failedCount: 1, retriedCount: 1, logUri: sentinel, message: sentinel, conditions: [{
      type: "Completed", status: "False", reason: sentinel, message: sentinel, lastTransitionTime: "2026-10-01T20:01:00Z",
    }] },
});

function inspect(value: unknown, options: { raw?: boolean; fail?: boolean; stderr?: string; env?: Record<string, string | undefined>; args?: string[] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "graph-executions-inspect-"));
  try {
    const file = join(dir, "result.json"), record = join(dir, "calls.json");
    writeFileSync(file, options.raw ? String(value) : JSON.stringify(value));
    writeFileSync(record, "[]");
    writeFileSync(join(dir, "gcloud"), `#!/usr/bin/env node
const {readFileSync,writeFileSync}=require('node:fs');
writeFileSync(process.env.MOCK_RECORD,JSON.stringify(process.argv.slice(2)));
process.stdout.write(readFileSync(process.env.MOCK_FILE));
process.stderr.write(process.env.MOCK_STDERR);
process.exitCode=${options.fail ? 7 : 0};
`, { mode: 0o755 });
    const result = spawnSync(process.execPath, ["scripts/inspect-graph-executions.mjs", ...options.args ?? []], {
      encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, MOCK_FILE: file,
        MOCK_RECORD: record, MOCK_STDERR: options.stderr ?? sentinel, GCP_PROJECT_ID: project, GCP_REGION: region, ...options.env },
    });
    return { ...result, calls: JSON.parse(readFileSync(record, "utf8")) as string[] };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function failsClosed(value: unknown, options: Parameters<typeof inspect>[1] = {}, category = options.fail ? "command-failed" : "invalid-resource") {
  const result = inspect(value, options);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `Could not inspect graph executions (${category}); resource details and command errors were withheld.\n`);
  return result;
}

test("execution inspection only lists the newest five executions in the exact project, region and graph job", () => {
  const result = inspect([execution()]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ["run", "jobs", "executions", "list", "--job", job,
    "--project", project, "--region", region, "--limit=5", "--sort-by=~metadata.creationTimestamp",
    "--format=json", "--verbosity=none", "--quiet"]);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), { job, project, region, executions: [{
    name: `${job}-abc12`, createdAt, startedAt: "2026-10-01T20:00:01Z", completedAt: "2026-10-01T20:01:00Z",
    conditions: [{ type: "Completed", status: "False", reason: null, lastTransitionTime: "2026-10-01T20:01:00Z" }],
    tasks: { configured: 1, running: 0, succeeded: 0, failed: 1, cancelled: 0, retried: 1 },
    maxRetriesPerTask: 1, imageDigest: digest, effectiveArgs: ["dist/refresh-company-graph.cjs", "--verify-live"],
  }] });
  assert.doesNotMatch(result.stdout, new RegExp(`${sentinel}|annotations|env|logUri|serviceAccount`));
});

test("known condition reasons distinguish runtime failure and timeout without exposing arbitrary identifiers", () => {
  for (const reason of ["NonZeroExitCode", "DeadlineExceeded", "Cancelled", sentinel, `Error ${sentinel}`]) {
    const value = execution();
    value.status.conditions[0].reason = reason;
    const result = inspect([value]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).executions[0].conditions[0].reason,
      reason.includes(sentinel) ? null : reason);
    assert.doesNotMatch(result.stdout, new RegExp(sentinel));
  }
});

test("all allowed graph modes and bounded limits are projected as effective args", () => {
  for (const args of [[], ["--apply"], ["--dry-run", "--limit=5"], ["--verify-delivery"], ["--verify-live"],
    [`--resume-live=${"a".repeat(40)}`], ["--limit=1"]]) {
    const value = execution();
    value.spec.template.spec.containers[0].args = ["dist/refresh-company-graph.cjs", ...args];
    const result = inspect([value]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).executions[0].effectiveArgs, value.spec.template.spec.containers[0].args);
  }
});

test("unrecognized and conflicting args fail closed without printing their values", () => {
  for (const args of [[sentinel], ["--company=NVDA"], ["--limit=6"], ["--apply", "--dry-run"],
    ["--verify-live", "--limit=1"], ["--verify-delivery", "--apply"], ["--limit=1", "--limit=2"], ["--apply", "--apply"],
    ["--resume-live=main"], [`--resume-live=${"a".repeat(40)}`, "--verify-live"], [`--resume-live=${"a".repeat(40)}`, "--limit=1"]]) {
    const value = execution();
    value.spec.template.spec.containers[0].args = ["dist/refresh-company-graph.cjs", ...args];
    failsClosed([value]);
  }
});

test("malformed, unrelated and oversized execution documents fail closed atomically", () => {
  const invalid = [null, {}, { metadata: { name: sentinel } },
    ...[
      (value: ReturnType<typeof execution>) => { value.kind = "Job"; },
      (value: ReturnType<typeof execution>) => { value.apiVersion = sentinel; },
      (value: ReturnType<typeof execution>) => { value.metadata.name = `other-job-${sentinel}`; },
      (value: ReturnType<typeof execution>) => { value.metadata.labels["run.googleapis.com/job"] = sentinel; },
      (value: ReturnType<typeof execution>) => { value.metadata.labels["cloud.googleapis.com/location"] = "europe-west1"; },
      (value: ReturnType<typeof execution>) => { value.metadata.namespace = "other-project"; },
      (value: ReturnType<typeof execution>) => { value.metadata.creationTimestamp = sentinel; },
      (value: ReturnType<typeof execution>) => { value.spec.template.spec.containers[0].image = `${sentinel}@${digest}`; },
      (value: ReturnType<typeof execution>) => { value.spec.template.spec.containers[0].command = [sentinel]; },
      (value: ReturnType<typeof execution>) => { value.spec.template.spec.containers.push(value.spec.template.spec.containers[0]); },
      (value: ReturnType<typeof execution>) => { value.spec.taskCount = -1; },
      (value: ReturnType<typeof execution>) => { value.spec.template.spec.maxRetries = 11; },
      (value: ReturnType<typeof execution>) => { value.status.retriedCount = 2; },
      (value: ReturnType<typeof execution>) => { value.status.conditions[0].status = sentinel; },
      (value: ReturnType<typeof execution>) => { value.status.conditions[0].lastTransitionTime = sentinel; },
      (value: ReturnType<typeof execution>) => { value.status.conditions.push(value.status.conditions[0]); },
    ].map(change => { const value = execution(); change(value); return value; }),
  ];
  for (const value of invalid) failsClosed([execution(), value]);
  failsClosed({ items: [execution()], [sentinel]: sentinel });
  failsClosed([execution(), execution()]);
  failsClosed(Array.from({ length: 6 }, (_, index) => {
    const value = execution(); value.metadata.name = `${job}-${index}`; return value;
  }));
  failsClosed(`malformed: ${sentinel}`, { raw: true });
  for (const status of [{ conditions: null }, { runningCount: null }, { retriedCount: sentinel }]) {
    failsClosed([{ ...execution(), status }]);
  }
  failsClosed(" ".repeat(1_048_577) + sentinel, { raw: true }, "command-failed");
});

test("no executions and pending executions remain useful without printing unknown condition text", () => {
  const empty = inspect([]);
  assert.equal(empty.status, 0, empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout), { job, project, region, executions: [] });
  const pending = execution();
  const value = { ...pending, status: { conditions: [{ type: sentinel, status: sentinel, message: sentinel }] } };
  const result = inspect([value]);
  assert.equal(result.status, 0, result.stderr);
  const projected = JSON.parse(result.stdout).executions[0];
  assert.equal(projected.startedAt, null); assert.equal(projected.completedAt, null);
  assert.deepEqual(projected.conditions, []);
  assert.doesNotMatch(result.stdout, new RegExp(sentinel));
});

test("gcloud permission failures and invalid invocation produce no raw errors or fallback calls", () => {
  const failed = failsClosed([execution()], { fail: true });
  assert.equal(failed.calls[3], "list");
  const permission = failsClosed([execution()], { fail: true, stderr: `ERROR: PERMISSION_DENIED ${sentinel}` }, "permission-denied");
  assert.deepEqual(permission.calls, failed.calls);
  for (const options of [{ env: { GCP_PROJECT_ID: "" } }, { env: { GCP_PROJECT_ID: "--other-project" } },
    { env: { GCP_REGION: sentinel } }, { args: ["--run-job"] }]) {
    assert.deepEqual(failsClosed([], options).calls, []);
  }
});

test("the inspection workflow reuses its existing identity and does not request new permissions", () => {
  const workflow = readFileSync(".github/workflows/inspect-sec-graph.yml", "utf8");
  assert.match(workflow, /run: node scripts\/inspect-graph-executions\.mjs/);
  assert.ok(workflow.indexOf("google-github-actions/setup-gcloud@v2") < workflow.indexOf("run: node scripts/inspect-graph-executions.mjs"));
  assert.ok(workflow.indexOf("scripts/collect-sec-filings.ts --dry-run") < workflow.indexOf("run: node scripts/inspect-graph-executions.mjs"));
  assert.equal(workflow.match(/google-github-actions\/auth@v2/g)?.length, 1);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.doesNotMatch(workflow.replace(/^\s*#.*$/gm, ""), /id-token:|impersonate|add-iam-policy-binding|set-iam-policy|gcloud run jobs execute/);
});
