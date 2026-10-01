import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { checkCollector, checkGraphDisabled, canarySummary } from "../../scripts/check-nvda-baseline.mjs";
import { backgroundJobTarget } from "../../scripts/background-job-changes.mjs";

const commit = "592541f6791e7e13906bd679a42cfbbd941b8a15";
const project = "ifindata-80905";
const image = `us-central1-docker.pkg.dev/${project}/ifindata/sec-fundamentals@sha256:${"a".repeat(64)}`;
const collector = () => ({ spec: { template: { spec: { taskCount: 1, parallelism: 1, template: { spec: {
  maxRetries: 1, timeoutSeconds: "1200", serviceAccountName: `directory-sync-runtime@${project}.iam.gserviceaccount.com`,
  containers: [{ image, command: ["node"], env: [{ name: "GIT_SHA", value: commit }, { name: "SEC_FILINGS_COLLECTOR_ENABLED", value: "0" }, { name: "GCP_PROJECT_ID", value: project }] }],
} } } } } });
const graph = (flag = "0") => ({ spec: { template: { spec: { containers: [{ env: [{ name: "COMPANY_GRAPH_PROCESSING_ENABLED", value: flag }] }] } } } });
const summary = () => [{ jsonPayload: { message: "collect-sec-filings: run_completed", companyId: "NVDA", mode: "baseline-only",
  status: "completed", baselined: 12, existing: 1, snapshotFilings: 13, published: 0 } }];

test("canary preflight accepts only the exact bounded disabled worker", () => {
  assert.equal(checkCollector(collector(), { project, commit, image }), true);
  for (const mutate of [
    (v: ReturnType<typeof collector>) => { v.spec.template.spec.taskCount = 2; },
    (v: ReturnType<typeof collector>) => { v.spec.template.spec.parallelism = 2; },
    (v: ReturnType<typeof collector>) => { v.spec.template.spec.template.spec.maxRetries = 2; },
    (v: ReturnType<typeof collector>) => { v.spec.template.spec.template.spec.containers[0].image = "wrong-image"; },
    (v: ReturnType<typeof collector>) => { v.spec.template.spec.template.spec.containers[0].env[0].value = "old-commit"; },
    (v: ReturnType<typeof collector>) => { v.spec.template.spec.template.spec.containers[0].env[1].value = "1"; },
    (v: ReturnType<typeof collector>) => { v.spec.template.spec.template.spec.containers[0].command = ["sh"]; },
    (v: ReturnType<typeof collector>) => { v.spec.template.spec.template.spec.serviceAccountName = "unexpected"; },
    (v: ReturnType<typeof collector>) => { v.spec.template.spec.template.spec.containers[0].env[2].value = "other-project"; },
    (v: ReturnType<typeof collector>) => { v.spec.template.spec.template.spec.containers[0].env.pop(); },
    (v: ReturnType<typeof collector>) => { v.spec.template.spec.template.spec.containers[0].env.push({ name: "GCP_PROJECT_ID", value: project }); },
  ]) {
    const value = collector(); mutate(value);
    assert.throws(() => checkCollector(value, { project, commit, image }), /safety check failed/);
  }
  assert.equal(checkGraphDisabled(graph()), true);
  assert.throws(() => checkGraphDisabled(graph("1")));
});

test("release gate requires successful production, worker deployment and both delivery checks", async () => {
  const workflow = readFileSync(".github/workflows/run-nvda-baseline.yml", "utf8");
  const script = workflow.split("script: |\n")[1].split("\n      - uses:")[0].split("\n").map(line => line.slice(12)).join("\n");
  const passed = { status: "completed", conclusion: "success" };
  const production = { name: "deploy-production", ...passed };
  const worker = { name: "deploy-background-jobs", ...passed, steps: ["Deploy changed background workers",
    "Verify SEC Pub/Sub delivery with cached companies", "Verify graph Pub/Sub delivery without SEC or OpenAI calls"].map(name => ({ name, ...passed })) };
  for (const jobs of [[production, worker], [{ ...production, conclusion: "skipped" }, worker],
    [production, { ...worker, conclusion: "skipped" }], [production, { ...worker, conclusion: "failure" }],
    [production, { ...worker, steps: worker.steps.slice(0, 1) }],
    [production, { ...worker, steps: worker.steps.map(step => ({ ...step, conclusion: "skipped" })) }]]) {
    const failures: string[] = [];
    await runInNewContext(`(async()=>{${script}})()`, { process: { env: { APPROVED_WORKER_COMMIT: commit, CONFIRM_NVDA: "true", WORKFLOW_RUN_ATTEMPT: "1" } },
      context: { repo: { owner: "test", repo: "test" } }, core: { setFailed: (message: string) => failures.push(message) },
      github: { rest: { actions: { listWorkflowRuns: async () => ({ data: { total_count: 1, workflow_runs: [{ id: 1, head_sha: commit, head_branch: "main", event: "workflow_dispatch", status: "completed", conclusion: "success", run_started_at: "2026-10-01T12:00:00Z" }] } }),
        listJobsForWorkflowRun: () => undefined } }, paginate: async () => jobs } });
    assert.equal(failures.length, jobs[0] === production && jobs[1] === worker ? 0 : 1);
  }
});

test("a newer failed or running release attempt cannot be masked by an older success", async () => {
  const workflow = readFileSync(".github/workflows/run-nvda-baseline.yml", "utf8");
  const script = workflow.split("script: |\n")[1].split("\n      - uses:")[0].split("\n").map(line => line.slice(12)).join("\n");
  const old = { id: 5, head_sha: commit, head_branch: "main", event: "push", status: "completed", conclusion: "success", run_started_at: "2026-10-01T12:00:00Z" };
  for (const status of ["completed", "in_progress", "queued"]) {
    const failures: string[] = [];
    await runInNewContext(`(async()=>{${script}})()`, { process: { env: { APPROVED_WORKER_COMMIT: commit, CONFIRM_NVDA: "true", WORKFLOW_RUN_ATTEMPT: "1" } },
      context: { repo: { owner: "test", repo: "test" } }, core: { setFailed: (message: string) => failures.push(message) },
      github: { rest: { actions: { listWorkflowRuns: async () => ({ data: { total_count: 2, workflow_runs: [old,
        { ...old, id: 1, status, conclusion: "failure", run_started_at: "2026-10-01T13:00:00Z" }] } }), listJobsForWorkflowRun: () => undefined } },
        paginate: async () => { throw new Error("Must not fall back to old successful jobs"); } } });
    assert.equal(failures.length, 1);
  }
});
test("canary summary is issuer-bound, bounded, and contains no unrelated fields", () => {
  assert.equal(canarySummary([]), null);
  const rows = summary(); Object.assign(rows[0].jsonPayload, { unrelated: "DO_NOT_PRINT" });
  assert.deepEqual(canarySummary(rows), { companyId: "NVDA", mode: "baseline-only", status: "completed",
    baselined: 12, existing: 1, snapshotFilings: 13, published: 0 });
  for (const change of [{ companyId: "AMD" }, { mode: "collector" }, { status: "partial" }, { published: 1 }, { snapshotFilings: 2001 }, { baselined: 15 }]) {
    const invalid = summary(); Object.assign(invalid[0].jsonPayload, change);
    assert.throws(() => canarySummary(invalid));
  }
});

function run(overrides: { collector?: unknown; graph?: unknown; paused?: boolean; logAccess?: boolean; ambiguous?: boolean; drift?: boolean; delayed?: boolean; logRows?: unknown; malformed?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nvda-baseline-canary-"));
  try {
    for (const [file, value] of Object.entries({ collector: overrides.collector ?? collector(), graph: overrides.graph ?? graph(), drift: graph("1"), summary: overrides.logRows ?? summary() })) {
      writeFileSync(join(dir, `${file}.json`), JSON.stringify(value));
    }
    writeFileSync(join(dir, "gcloud"), `#!/bin/sh
printf '%s\\n' "$*" >> "$MOCK_DIR/calls"
case "$1 $2 $3" in
  'artifacts docker images') printf '%s\\n' "$MOCK_IMAGE" ;;
  'run jobs describe') cat "$MOCK_DIR/collector.json" ;;
  'run services describe') ${overrides.drift ? 'if [ "$(grep -c "^run services describe" "$MOCK_DIR/calls")" -gt 1 ]; then cat "$MOCK_DIR/drift.json"; else cat "$MOCK_DIR/graph.json"; fi' : 'cat "$MOCK_DIR/graph.json"'} ;;
  'scheduler jobs describe') echo '${overrides.paused === false ? "ENABLED" : "PAUSED"}' ;;
  *)
    if [ "$1 $2" = 'logging read' ]; then
      ${overrides.logAccess === false ? "exit 9" : `case "$*" in *execution_name*) ${overrides.malformed ? 'echo malformed-DO_NOT_PRINT' : overrides.delayed ? 'if [ ! -f "$MOCK_DIR/log-read" ]; then touch "$MOCK_DIR/log-read"; echo "[]"; else cat "$MOCK_DIR/summary.json"; fi' : 'cat "$MOCK_DIR/summary.json"'} ;; *) echo timestamp ;; esac`}
    elif [ "$1 $2 $3" = 'run jobs execute' ]; then
      ${overrides.ambiguous ? "exit 8" : "echo collect-sec-filings-production-canary1"}
    else exit 7; fi ;;
esac
`, { mode: 0o755 });
    writeFileSync(join(dir, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const result = spawnSync("bash", ["scripts/run-nvda-baseline.sh"], { encoding: "utf8", env: { ...process.env,
      PATH: `${dir}:${process.env.PATH}`, MOCK_DIR: dir, MOCK_IMAGE: image,
      GCP_PROJECT_ID: project, GCP_REGION: "us-central1", APPROVED_WORKER_COMMIT: commit } });
    return { ...result, calls: readFileSync(join(dir, "calls"), "utf8").trim().split("\n") };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test("canary invokes exactly one NVDA baseline execution and rechecks persistent disabled state", () => {
  const result = run(); assert.equal(result.status, 0, result.stderr);
  const executes = result.calls.filter(line => line.startsWith("run jobs execute"));
  assert.equal(executes.length, 1);
  assert.match(executes[0], /--args=dist\/collect-sec-filings.cjs,--apply,--baseline-only,--company=NVDA/);
  assert.match(executes[0], /--update-env-vars=SEC_FILINGS_COLLECTOR_ENABLED=1/);
  assert.equal(result.calls.filter(line => line.startsWith("run jobs describe")).length, 2);
  assert.equal(result.calls.filter(line => line.startsWith("scheduler jobs describe")).length, 4);
  assert.ok(result.stdout.includes('"published":0'));
  assert.ok(result.calls.every(line => !/^(run (jobs|services) (update|deploy)|scheduler jobs (create|update|resume)|iam )/.test(line)));
});
test("unsafe runtime state or missing log-read access blocks before execution", () => {
  for (const overrides of [{ graph: graph("1") }, { collector: {} }, { paused: false }, { logAccess: false }]) {
    const result = run(overrides); assert.notEqual(result.status, 0);
    assert.equal(result.calls.filter(line => line.startsWith("run jobs execute")).length, 0);
  }
});
test("an uncertain execution is never retried by the workflow script", () => {
  const result = run({ ambiguous: true }); assert.notEqual(result.status, 0);
  assert.equal(result.calls.filter(line => line.startsWith("run jobs execute")).length, 1);
});
test("post-execution drift and delayed or invalid logs never cause another execute", () => {
  const invalid = summary(); invalid[0].jsonPayload.companyId = "AMD";
  for (const options of [{ drift: true }, { logRows: invalid }, { malformed: true }, { delayed: true }]) {
    const result = run(options);
    assert.equal(result.calls.filter(line => line.startsWith("run jobs execute")).length, 1);
    assert.equal(result.status === 0, "delayed" in options);
    assert.doesNotMatch(result.stderr + result.stdout, /DO_NOT_PRINT/);
  }
});
test("canary workflow is explicit, main-only, non-repeatable and does not change worker selection", () => {
  const workflow = readFileSync(".github/workflows/run-nvda-baseline.yml", "utf8");
  assert.match(workflow, /WORKFLOW_RUN_ATTEMPT !== '1'/);
  assert.match(workflow, /CONFIRM_NVDA !== 'true'/);
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /run.conclusion === 'success'/);
  assert.match(workflow, /git merge-base --is-ancestor 592541f/);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY|--apply|workflow_call|schedule:/);
  assert.equal(backgroundJobTarget([".github/workflows/run-nvda-baseline.yml", "scripts/run-nvda-baseline.sh", "scripts/check-nvda-baseline.mjs", "tests/deploy/nvda-baseline-canary.test.ts"]), "none");
});
