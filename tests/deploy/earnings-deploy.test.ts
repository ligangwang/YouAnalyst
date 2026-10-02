import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { backgroundJobTarget } from "../../scripts/background-job-changes.mjs";

const require = createRequire(import.meta.url);
const sha = "a".repeat(40);
const mutations = /builds submit|run deploy|run jobs (deploy|update|execute)|add-iam-policy-binding|(?:topics|subscriptions) (create|update)|scheduler jobs (create|update|pause|resume)/;

function run(extra: Record<string, string> = {}, script = "scripts/deploy-earnings.sh", arg = "") {
  const dir = mkdtempSync(path.join(tmpdir(), "earnings-deploy-"));
  try {
    const result = spawnSync("bash", ["-c", `
      gcloud() {
        echo "$*" >> "$CALLS"
        if [[ -n "\${MISSING_RESOURCE:-}" && "$*" == *"describe $MISSING_RESOURCE "* ]]; then return 1; fi
        case "$*" in
          *"get-iam-policy"*)
            if [[ "\${MISSING_IAM:-0}" == 1 ]]; then return 0; fi
            local arg
            for arg in "$@"; do
              if [[ "$arg" == *"AND bindings.members="* ]]; then printf '%s\\n' "\${arg##*AND bindings.members=}"; fi
            done ;;
          "pubsub subscriptions describe"*)
            if [[ "\${NEW_RESOURCES:-0}" == 1 ]]; then return 1; fi
            if [[ "$*" == *"value(topic)"* ]]; then
              local topic="$4"
              case "$4" in
                earnings-worker) topic=earnings-sources-discovered ;;
                sec-filings-fundamentals|company-graph-filings) topic=sec-filings-discovered ;;
                company-graph-worker) topic=company-graph-requests ;;
                *-audit) topic="\${4%-audit}" ;;
              esac
              echo "projects/demo/topics/\${WRONG_TOPIC:-$topic}"
            fi ;;
          "pubsub topics describe"*) if [[ "\${NEW_RESOURCES:-0}" == 1 ]]; then return 1; fi ;;
          "scheduler jobs describe"*)
            if [[ "$*" == *"value(state)"* ]]; then echo "\${SCHEDULE_STATE:-PAUSED}";
            elif [[ "\${NEW_RESOURCES:-0}" == 1 ]]; then return 1; fi ;;
          "run services describe"*) echo https://subscriber.example.run.app ;;
          "run jobs describe"*) echo directory-sync-runtime@demo.iam.gserviceaccount.com ;;
          "projects describe"*) echo 123456789 ;;
          "run deploy earnings-subscriber"*|"run jobs deploy collect-earnings-production"*)
            local previous='' arg
            for arg in "$@"; do
              if [[ "$previous" == --env-vars-file ]]; then
                cat "$arg" >> "$ENV_CAPTURE"; echo >> "$ENV_CAPTURE"; echo "$arg" >> "$ENV_PATHS"
              fi
              previous="$arg"
            done ;;
          "builds submit"*) echo build-id ;;
          "builds describe"*) echo SUCCESS ;;
          "artifacts docker images describe"*) echo example/image@sha256:abcdef ;;
          *"add-iam-policy-binding"*|"pubsub topics create"*|"pubsub subscriptions create"*|"pubsub subscriptions update"*|"run deploy"*|"run jobs deploy"*|"run jobs update"*|"scheduler jobs create"*|"scheduler jobs update"*|"scheduler jobs pause"*|"services enable"*|"beta services identity create"*) ;;
          *) echo "Unexpected mock gcloud command: $*" >&2; return 2 ;;
        esac
      }
      export -f gcloud
      if [[ -n "$ARG" ]]; then bash "$SCRIPT" "$ARG"; else bash "$SCRIPT"; fi
    `], { encoding: "utf8", timeout: 10000, env: {
      ...process.env, CALLS: path.join(dir, "calls"), ENV_CAPTURE: path.join(dir, "env"), ENV_PATHS: path.join(dir, "env-paths"),
      SCRIPT: script, ARG: arg, GCP_PROJECT_ID: "demo", GIT_SHA: sha,
      FUNDAMENTALS_IMAGE: "example/image@sha256:abcdef", SEC_USER_AGENT: "test contact",
      WEB_RUNTIME_SERVICE_ACCOUNT: "web@demo.iam.gserviceaccount.com",
      EARNINGS_PIPELINE_ENABLED: "1", EARNINGS_BOOTSTRAP_IAM: "0", EARNINGS_COLLECTION_ENABLED: "0", EARNINGS_PROCESSING_ENABLED: "0",
      ENABLE_SEC_FILING_PIPELINE: "0", PUBSUB_BOOTSTRAP_IAM: "0", FILING_PIPELINE_BOOTSTRAP_IAM: "0", ...extra,
    } });
    assert.ifError(result.error);
    const read = (name: string) => existsSync(path.join(dir, name)) ? readFileSync(path.join(dir, name), "utf8") : "";
    return { ...result, calls: read("calls"), configs: read("env").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as Record<string, string>),
      envFilesRemoved: read("env-paths").trim().split("\n").filter(Boolean).every(file => !existsSync(file)) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("approved earnings setup grants only five resource bindings and leaves a disabled paused pipeline", () => {
  const r = run({ EARNINGS_BOOTSTRAP_IAM: "1", EARNINGS_SETUP_APPROVED_SHA: sha, NEW_RESOURCES: "1" });
  assert.equal(r.status, 0, r.stderr);
  const bindings = r.calls.split("\n").filter(line => line.includes("add-iam-policy-binding"));
  assert.equal(bindings.length, 5);
  for (const [resource, name, member, role] of [
    ["pubsub topics", "earnings-sources-discovered", "directory-sync-runtime@demo.iam.gserviceaccount.com", "pubsub.publisher"],
    ["pubsub topics", "earnings-dead-letter", "service-123456789@gcp-sa-pubsub.iam.gserviceaccount.com", "pubsub.publisher"],
    ["pubsub subscriptions", "earnings-worker", "service-123456789@gcp-sa-pubsub.iam.gserviceaccount.com", "pubsub.subscriber"],
    ["run services", "earnings-subscriber", "directory-sync-scheduler@demo.iam.gserviceaccount.com", "run.invoker"],
    ["run jobs", "collect-earnings-production", "directory-sync-scheduler@demo.iam.gserviceaccount.com", "run.invoker"],
  ]) {
    assert.ok(bindings.some(line => line.startsWith(`${resource} add-iam-policy-binding ${name} `)
      && line.includes(`--member serviceAccount:${member} --role roles/${role}`)), `${name} exact binding`);
  }
  assert.match(r.calls, /subscriptions create earnings-dead-letter-audit .*--topic earnings-dead-letter.*--message-retention-duration 7d --expiration-period never/);
  assert.match(r.calls, /run deploy earnings-subscriber.*--no-allow-unauthenticated.*--args dist\/serve-earnings.cjs.*--max-instances 1 --concurrency 1 --timeout 600/);
  assert.match(r.calls, /subscriptions create earnings-worker --topic earnings-sources-discovered.*--push-auth-service-account directory-sync-scheduler@demo.iam.gserviceaccount.com.*--push-auth-token-audience https:\/\/subscriber.example.run.app.*--ack-deadline 600.*--dead-letter-topic earnings-dead-letter.*--max-delivery-attempts 100/);
  assert.match(r.calls, /run jobs deploy collect-earnings-production.*--tasks 1 --parallelism 1.*--args dist\/collect-earnings.cjs,--apply/);
  assert.match(r.calls, /scheduler jobs create http collect-earnings-production.*--schedule \*\/15 \* \* \* \* --time-zone UTC/);
  assert.match(r.calls, /scheduler jobs pause collect-earnings-production/);
  assert.match(r.calls, /scheduler jobs describe collect-earnings-production.*value\(state\)/);
  assert.equal(r.configs.length, 2);
  for (const config of r.configs) {
    assert.equal(config.EARNINGS_COLLECTION_ENABLED, "0");
    assert.equal(config.EARNINGS_PROCESSING_ENABLED, "0");
    assert.equal(config.EARNINGS_CANARY_ONLY, "0");
    assert.equal(config.EARNINGS_TOPIC, "earnings-sources-discovered");
    assert.equal(config.EARNINGS_SUBSCRIPTION, "earnings-worker");
    assert.ok(!Object.keys(config).some(key => /OPENAI|COMPANY_GRAPH|API_KEY/.test(key)));
  }
  assert.equal(r.envFilesRemoved, true);
  assert.ok(r.calls.indexOf("subscriptions create earnings-worker") < r.calls.indexOf("run jobs deploy collect-earnings-production"));
  assert.doesNotMatch(r.calls, /iam service-accounts|projects add-iam|secrets |serviceAccount:web@|scheduler jobs resume|run jobs execute|sec-filings|company-graph/);
});

test("routine earnings deployment verifies all scoped IAM before revisions and preserves explicit enabled config and schedule state", () => {
  const r = run({ EARNINGS_COLLECTION_ENABLED: "1", EARNINGS_PROCESSING_ENABLED: "1", EARNINGS_CANARY_ONLY: "1" });
  assert.equal(r.status, 0, r.stderr);
  const checks = r.calls.split("\n").filter(line => line.includes("get-iam-policy"));
  assert.equal(checks.length, 5);
  assert.ok(checks.every(line => r.calls.indexOf(line) < r.calls.indexOf("run deploy earnings-subscriber")));
  for (const config of r.configs) {
    assert.equal(config.EARNINGS_COLLECTION_ENABLED, "1");
    assert.equal(config.EARNINGS_PROCESSING_ENABLED, "1");
    assert.equal(config.EARNINGS_CANARY_ONLY, "0");
  }
  assert.match(r.calls, /scheduler jobs update http collect-earnings-production/);
  assert.doesNotMatch(r.calls, /add-iam-policy-binding|iam service-accounts|projects add-iam|(?:topics|subscriptions) create|scheduler jobs (create|pause|resume|delete)|run jobs execute/);
});

test("earnings preflight refuses invalid switches, unapproved setup, wrong topics, missing resources or IAM before any mutation", () => {
  for (const extra of [
    { EARNINGS_PIPELINE_ENABLED: "0" }, { EARNINGS_PIPELINE_ENABLED: "yes" }, { EARNINGS_COLLECTION_ENABLED: "true" },
    { EARNINGS_PROCESSING_ENABLED: "yes" }, { EARNINGS_BOOTSTRAP_IAM: "yes" }, { SEC_USER_AGENT: "" },
    { EARNINGS_BOOTSTRAP_IAM: "1" }, { EARNINGS_BOOTSTRAP_IAM: "1", EARNINGS_SETUP_APPROVED_SHA: "b".repeat(40) },
    { EARNINGS_BOOTSTRAP_IAM: "1", EARNINGS_SETUP_APPROVED_SHA: sha, EARNINGS_COLLECTION_ENABLED: "1" },
    { EARNINGS_BOOTSTRAP_IAM: "1", EARNINGS_SETUP_APPROVED_SHA: sha, EARNINGS_PROCESSING_ENABLED: "1" },
    { FUNDAMENTALS_IMAGE: "example/image:latest" }, { WRONG_TOPIC: "other-pipeline" }, { MISSING_IAM: "1" },
    ...["earnings-sources-discovered", "earnings-dead-letter", "earnings-worker", "earnings-dead-letter-audit", "earnings-subscriber", "collect-earnings-production"].map(MISSING_RESOURCE => ({ MISSING_RESOURCE })),
  ] as Record<string, string>[]) {
    const r = run(extra);
    assert.notEqual(r.status, 0, JSON.stringify(extra));
    assert.doesNotMatch(r.calls, mutations, JSON.stringify(extra));
  }
  const check = run({ FUNDAMENTALS_IMAGE: "" }, "scripts/deploy-earnings.sh", "--check");
  assert.equal(check.status, 0, check.stderr);
  assert.doesNotMatch(check.calls, mutations);
});

test("setup pauses an existing earnings schedule first and fails if pause cannot be verified", () => {
  const r = run({ EARNINGS_BOOTSTRAP_IAM: "1", EARNINGS_SETUP_APPROVED_SHA: sha });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.calls.indexOf("scheduler jobs pause") < r.calls.indexOf("run deploy earnings-subscriber"));
  const bad = run({ EARNINGS_BOOTSTRAP_IAM: "1", EARNINGS_SETUP_APPROVED_SHA: sha, SCHEDULE_STATE: "ENABLED" });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /did not leave its schedule paused/);
  assert.doesNotMatch(bad.calls, /run deploy|run jobs deploy/);
});

test("earnings integration is default off and explicit earnings target preflights before the shared build", () => {
  const enabled = run({}, "scripts/deploy-background-jobs.sh", "earnings");
  assert.equal(enabled.status, 0, enabled.stderr);
  assert.equal(enabled.calls.match(/builds submit/g)?.length, 1);
  assert.ok(enabled.calls.indexOf("run jobs get-iam-policy collect-earnings-production") < enabled.calls.indexOf("builds submit"));
  assert.doesNotMatch(enabled.calls, /add-iam-policy-binding|run deploy (?:sec-|company-graph)|run jobs deploy (?:refresh-|collect-sec-)/);
  for (const extra of [{ EARNINGS_PIPELINE_ENABLED: "0" }, { MISSING_IAM: "1" }, { EARNINGS_PROCESSING_ENABLED: "bad" }] as Record<string, string>[]) {
    const r = run(extra, "scripts/deploy-background-jobs.sh", "earnings");
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.calls, mutations);
  }
  const disabled = run({ EARNINGS_PIPELINE_ENABLED: "0" }, "scripts/deploy-background-jobs.sh", "fundamentals");
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.doesNotMatch(disabled.calls, /earnings/);
  const isolated = run({ EARNINGS_BOOTSTRAP_IAM: "1", EARNINGS_SETUP_APPROVED_SHA: sha }, "scripts/deploy-background-jobs.sh", "all");
  assert.notEqual(isolated.status, 0);
  assert.doesNotMatch(isolated.calls, mutations);
});

test("earnings observation follows the existing SEC collector without changing its enabled switch or schedule", () => {
  for (const [pipeline, expected] of [["1", "1"], ["0", "0"]]) {
    const r = run({ ENABLE_SEC_FILING_PIPELINE: "1", SEC_FILINGS_COLLECTOR_ENABLED: "1", EARNINGS_PIPELINE_ENABLED: pipeline, EARNINGS_COLLECTION_ENABLED: "1" }, "scripts/deploy-sec-filings.sh");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.calls, new RegExp(`SEC_FILINGS_COLLECTOR_ENABLED=1\\|EARNINGS_COLLECTION_ENABLED=${expected}`));
    assert.match(r.calls, /scheduler jobs update http collect-sec-filings-production/);
    assert.doesNotMatch(r.calls, /scheduler jobs (pause|resume)|add-iam-policy-binding|earnings-subscriber|run deploy company-graph|OPENAI/);
  }
});

test("manual earnings operations require explicit exact-main approval and isolated live-operation approval", () => {
  const workflow = require("js-yaml").load(readFileSync(".github/workflows/setup-earnings.yml", "utf8"));
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  const inputs = workflow.on.workflow_dispatch.inputs;
  assert.equal(inputs.action.default, "dry-run");
  assert.equal(inputs.approve_resource_iam.default, false);
  assert.equal(inputs.approve_live_operation.default, false);
  const job = workflow.jobs["earnings-operation"];
  assert.equal(job.if, "github.ref == 'refs/heads/main'");
  assert.equal(job.environment, "production");
  const guard = job.steps[0].with.script;
  assert.match(guard, /APPROVED_COMMIT !== context.sha/);
  assert.match(guard, /OPERATION === 'setup-paused'.*APPROVE_RESOURCE_IAM !== 'true'/);
  assert.match(guard, /branch.commit.sha !== context.sha/);
  assert.match(guard, /workflow_id: 'deploy.yml', head_sha: context.sha/);
  assert.match(guard, /run.head_sha === context.sha/);
  assert.match(guard, /latest.status !== 'completed' \|\| latest.conclusion !== 'success'/);
  assert.match(guard, /b.run_number - a.run_number \|\| b.run_attempt - a.run_attempt/);
  assert.match(guard, /\['canary', 'activate', 'rollback'\].*APPROVE_LIVE_OPERATION !== 'true'/);
  assert.equal(job.env.EARNINGS_COLLECTION_ENABLED, "0");
  assert.equal(job.env.EARNINGS_PROCESSING_ENABLED, "0");
  assert.equal(job.env.EARNINGS_BOOTSTRAP_IAM, undefined);
  const setup = job.steps.find((step: { env?: Record<string, string> }) => step.env?.EARNINGS_BOOTSTRAP_IAM === "1");
  assert.equal(setup.if, "inputs.action == 'setup-paused'");
  assert.equal(setup.env.EARNINGS_SETUP_APPROVED_SHA, "${{ inputs.approved_commit }}");
  const commands = job.steps.map((step: { run?: string }) => step.run ?? "").join("\n");
  assert.match(commands, /deploy-background-jobs.sh earnings/);
  assert.match(commands, /run jobs describe collect-earnings-production/);
  assert.match(commands, /run services describe earnings-subscriber/);
  for (const flag of ["dry-run", "verify-delivery", "diagnostics"]) assert.ok(commands.includes(`--args dist/collect-earnings.cjs,--${flag}`));
  assert.match(commands, /operate-earnings.sh "\$EARNINGS_OPERATION"/);
  assert.doesNotMatch(commands, /scheduler jobs resume|EARNINGS_(?:COLLECTION|PROCESSING)_ENABLED=1|OPENAI|COMPANY_GRAPH|SEC_FILINGS_COLLECTOR_ENABLED/);
});

test("routine workflow preserves SEC/graph settings and never bootstraps earnings access", () => {
  const workflow = require("js-yaml").load(readFileSync(".github/workflows/deploy.yml", "utf8"));
  const job = workflow.jobs["deploy-background-jobs"];
  for (const key of ["EARNINGS_PIPELINE_ENABLED", "EARNINGS_COLLECTION_ENABLED", "EARNINGS_PROCESSING_ENABLED",
    "ENABLE_SEC_FILING_PIPELINE", "SEC_FILINGS_COLLECTOR_ENABLED", "COMPANY_GRAPH_PROCESSING_ENABLED", "COMPANY_GRAPH_PAID_ADMISSION_ENABLED", "COMPANY_GRAPH_QUEUE_BATCH_SIZE", "SEC_GRAPH_ACTIVATE_TREE", "SEC_GRAPH_RECOVERY_SOURCE_TREE", "OPENAI_MODEL"]) {
    assert.equal(job.env[key], `\${{ vars.${key} }}`);
  }
  assert.equal(job.env.EARNINGS_BOOTSTRAP_IAM, "0");
  assert.equal(job.env.EARNINGS_SETUP_APPROVED_SHA, undefined);
  assert.equal(job.env.OPENAI_API_KEY, "${{ vars.ENABLE_SEC_FILING_PIPELINE == '1' && secrets.OPENAI_API_KEY || '' }}");
  const probe = job.steps.find((step: { name?: string }) => step.name === "Verify earnings delivery without provider calls");
  assert.match(probe.if, /EARNINGS_PIPELINE_ENABLED == '1'/);
  assert.match(probe.run, /--args dist\/collect-earnings.cjs,--verify-delivery/);
});

test("shared image bundles earnings and official PDF extraction; earnings sources select financial releases", () => {
  const docker = readFileSync("Dockerfile.fundamentals", "utf8");
  for (const entry of ["collect-earnings", "serve-earnings"]) {
    assert.ok(docker.includes(`scripts/${entry}.ts --bundle --platform=node --packages=external --outfile=dist/${entry}.cjs`));
    assert.equal(backgroundJobTarget([`scripts/${entry}.ts`]), "fundamentals");
  }
  assert.match(docker, /apt-get install -y --no-install-recommends python3 python3-venv poppler-utils/);
  assert.equal(backgroundJobTarget(["scripts/deploy-earnings.sh"]), "fundamentals");
});

function operationFixture() {
  const env = (values: Record<string, string>) => Object.entries(values).map(([name, value]) => ({ name, value }));
  const runtime = "directory-sync-runtime@demo.iam.gserviceaccount.com";
  const job = (entry: string, values: Record<string, string>) => ({ spec: { template: { spec: {
    taskCount: 1, parallelism: 1, template: { spec: { serviceAccountName: runtime, maxRetries: 0, timeoutSeconds: "1200",
      containers: [{ image: "example/image@sha256:abcdef", args: [`dist/${entry}.cjs`, "--apply"], env: env({ GIT_SHA: sha, ...values }) }] } },
  } } } });
  return {
    collector: job("collect-earnings", { EARNINGS_COLLECTION_ENABLED: "0" }),
    worker: { spec: { template: { spec: { serviceAccountName: runtime,
      containers: [{ image: "example/image@sha256:abcdef", args: ["dist/serve-earnings.cjs"], env: env({ GIT_SHA: sha, EARNINGS_PROCESSING_ENABLED: "0", EARNINGS_CANARY_ONLY: "0" }) }] } } } },
    sec: job("collect-sec-filings", { EARNINGS_COLLECTION_ENABLED: "0", SEC_FILINGS_COLLECTOR_ENABLED: "1", SEC_FILINGS_TOPIC: "sec-filings-discovered", SEC_USER_AGENT: "preserve-contact" }),
    schedule: { state: "PAUSED", httpTarget: { uri: "https://run.googleapis.com/v2/projects/demo/locations/us-central1/jobs/collect-earnings-production:run",
      oauthToken: { serviceAccountEmail: "directory-sync-scheduler@demo.iam.gserviceaccount.com" } } },
    marker: false,
  };
}
type OperationState = ReturnType<typeof operationFixture>;
function getOperationFlag(state: OperationState, which: "collector" | "worker" | "sec", name: string) {
  const row = which === "worker" ? state.worker.spec.template.spec.containers[0] : state[which].spec.template.spec.template.spec.containers[0];
  return row.env.find(value => value.name === name)?.value;
}
function runOperation(operation: "canary" | "activate" | "rollback", extra: Record<string, string> = {}, change?: (state: OperationState) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "earnings-operation-"));
  try {
    mkdirSync(path.join(dir, "bin"));
    const initial = operationFixture();
    if (operation === "activate") {
      initial.marker = true;
      initial.collector.spec.template.spec.template.spec.containers[0].env.find(row => row.name === "EARNINGS_COLLECTION_ENABLED")!.value = "1";
      initial.worker.spec.template.spec.containers[0].env.find(row => row.name === "EARNINGS_PROCESSING_ENABLED")!.value = "1";
      initial.worker.spec.template.spec.containers[0].env.find(row => row.name === "EARNINGS_CANARY_ONLY")!.value = "1";
    }
    change?.(initial);
    writeFileSync(path.join(dir, "state.json"), JSON.stringify(initial));
    writeFileSync(path.join(dir, "bin", "gcloud"), String.raw`#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2), e = process.env, state = JSON.parse(fs.readFileSync(e.OP_STATE, 'utf8'));
fs.appendFileSync(e.OP_CALLS, JSON.stringify(a) + '\n');
const value = name => a[a.indexOf(name) + 1];
const save = () => fs.writeFileSync(e.OP_STATE, JSON.stringify(state));
const fail = text => { process.stderr.write(text + '\n'); process.exit(1); };
const setFlag = (which, name, flag) => {
  const spec = which === 'worker' ? state.worker.spec.template.spec : state[which].spec.template.spec.template.spec;
  const row = spec.containers[0].env.find(row => row.name === name);
  if (row) row.value = flag; else spec.containers[0].env.push({name, value: flag});
};
if (a[0] === 'run' && a[2] === 'describe') {
  const which = a[3] === 'collect-earnings-production' ? 'collector' : a[3] === 'collect-sec-filings-production' ? 'sec' : a[3] === 'earnings-subscriber' ? 'worker' : '';
  if (!which) fail('Unexpected resource');
  process.stdout.write(JSON.stringify(state[which]));
} else if (a[0] === 'run' && a[2] === 'update') {
  const which = a[3] === 'collect-earnings-production' ? 'collector' : a[3] === 'collect-sec-filings-production' ? 'sec' : a[3] === 'earnings-subscriber' ? 'worker' : '';
  if (!which) fail('Unexpected mutation target');
  const flags = value('--update-env-vars').split(',').map(pair => pair.split('='));
  for (const [name, flag] of flags) {
    if (!['EARNINGS_COLLECTION_ENABLED', 'EARNINGS_PROCESSING_ENABLED', 'EARNINGS_CANARY_ONLY'].includes(name)) fail('Unexpected flag mutation');
    if (name === 'EARNINGS_CANARY_ONLY' && e.IGNORE_CANARY_ONLY === '1') continue;
    setFlag(which, name, flag);
    if (e.SEC_DRIFT === '1' && which === 'sec' && flag === '1') setFlag('sec', 'SEC_FILINGS_COLLECTOR_ENABLED', '0');
  }
  save();
  if (e.FAIL_UPDATE === which && flags.some(pair => pair[1] === '1')) fail('Uncertain update failure');
} else if (a[0] === 'run' && a[2] === 'execute') {
  if (a[3] !== 'collect-earnings-production') fail('Unexpected execution target');
  const mode = value('--args');
  if (mode === 'dist/collect-earnings.cjs,--check-canary') { if (!state.marker) fail('No verified canary for current SHA'); }
  else if (mode === 'dist/collect-earnings.cjs,--verify-delivery') { if (e.FAIL_PROBE === '1') fail('Delivery proof failed'); }
  else if (mode === 'dist/collect-earnings.cjs,--apply,--canary') {
    if (e.FAIL_CANARY === '1') fail('Canary result uncertain');
    state.marker = true; save();
  } else fail('Unexpected execution mode');
} else if (a[0] === 'scheduler') {
  if (a[3] !== 'collect-earnings-production') fail('Unexpected scheduler');
  if (a[2] === 'describe') process.stdout.write(JSON.stringify(state.schedule));
  else if (a[2] === 'pause') {
    if (e.FAIL_PAUSE === '1') fail('Pause failed');
    state.schedule.state = 'PAUSED'; save();
  } else if (a[2] === 'resume') {
    state.schedule.state = 'ENABLED'; save();
    if (e.FAIL_RESUME === '1') fail('Uncertain resume failure');
  } else fail('Unexpected scheduler operation');
} else fail('Unexpected gcloud operation');
`, { mode: 0o755 });
    const result = spawnSync("bash", ["scripts/operate-earnings.sh", operation], { encoding: "utf8", timeout: 15000, env: {
      ...process.env, PATH: `${path.join(dir, "bin")}:${process.env.PATH}`, OP_STATE: path.join(dir, "state.json"), OP_CALLS: path.join(dir, "calls"),
      GCP_PROJECT_ID: "demo", GIT_SHA: sha, EARNINGS_OPERATION_APPROVED_SHA: sha, ...extra,
    } });
    assert.ifError(result.error);
    const calls: string[][] = existsSync(path.join(dir, "calls")) ? readFileSync(path.join(dir, "calls"), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    return { ...result, calls, text: calls.map(call => call.join(" ")).join("\n"), initial,
      state: JSON.parse(readFileSync(path.join(dir, "state.json"), "utf8")) as OperationState };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("bounded live canary proves delivery first, executes once and leaves SEC untouched with earnings paused", () => {
  const r = runOperation("canary");
  assert.equal(r.status, 0, r.stderr);
  const executions = r.calls.filter(call => call[2] === "execute");
  assert.deepEqual(executions.map(call => call[call.indexOf("--args") + 1]), [
    "dist/collect-earnings.cjs,--verify-delivery", "dist/collect-earnings.cjs,--apply,--canary",
  ]);
  assert.ok(r.text.indexOf("--verify-delivery") < r.text.indexOf("--update-env-vars EARNINGS_PROCESSING_ENABLED=1"));
  assert.equal(r.state.schedule.state, "PAUSED");
  assert.equal(r.state.marker, true);
  assert.equal(getOperationFlag(r.state, "collector", "EARNINGS_COLLECTION_ENABLED"), "1");
  assert.equal(getOperationFlag(r.state, "worker", "EARNINGS_PROCESSING_ENABLED"), "1");
  assert.equal(getOperationFlag(r.state, "worker", "EARNINGS_CANARY_ONLY"), "1");
  assert.match(r.text, /--update-env-vars EARNINGS_PROCESSING_ENABLED=1,EARNINGS_CANARY_ONLY=1/);
  assert.deepEqual(r.state.sec, r.initial.sec);
  assert.doesNotMatch(r.text, /run jobs update collect-sec-filings|scheduler jobs resume|add-iam|--set-env-vars|company-graph|OPENAI|topics|subscriptions/);
});

test("uncertain or failed canary rolls back only new earnings flags and never retries live collection", () => {
  for (const extra of [{ FAIL_CANARY: "1" }, { FAIL_UPDATE: "worker" }, { FAIL_UPDATE: "collector" }, { FAIL_PROBE: "1" }] as Array<Record<string, string>>) {
    const r = runOperation("canary", extra);
    assert.notEqual(r.status, 0);
    assert.equal(r.state.schedule.state, "PAUSED");
    assert.equal(getOperationFlag(r.state, "collector", "EARNINGS_COLLECTION_ENABLED"), "0");
    assert.equal(getOperationFlag(r.state, "worker", "EARNINGS_PROCESSING_ENABLED"), "0");
    assert.equal(getOperationFlag(r.state, "worker", "EARNINGS_CANARY_ONLY"), "0");
    assert.deepEqual(r.state.sec, r.initial.sec);
    assert.ok(r.calls.filter(call => call.includes("dist/collect-earnings.cjs,--apply,--canary")).length <= 1);
    assert.doesNotMatch(r.text, /run jobs update collect-sec-filings|scheduler jobs resume|add-iam|company-graph/);
  }
});

test("canary preflight rejects stale revisions, identities, image, retry policy, modes or unpaused schedule without mutations", () => {
  for (const change of [
    (s: OperationState) => { s.schedule.state = "ENABLED"; },
    (s: OperationState) => { s.schedule.httpTarget.uri = "https://other.example"; },
    (s: OperationState) => { s.collector.spec.template.spec.template.spec.maxRetries = 1; },
    (s: OperationState) => { s.worker.spec.template.spec.containers[0].image = "example/image@sha256:other"; },
    (s: OperationState) => { s.collector.spec.template.spec.template.spec.containers[0].image = "example/image:latest"; },
    (s: OperationState) => { s.collector.spec.template.spec.template.spec.containers[0].args = ["dist/collect-earnings.cjs", "--canary"]; },
    (s: OperationState) => { s.worker.spec.template.spec.serviceAccountName = "other@demo.iam.gserviceaccount.com"; },
    (s: OperationState) => { s.sec.spec.template.spec.template.spec.containers[0].env.find(row => row.name === "GIT_SHA")!.value = "b".repeat(40); },
    (s: OperationState) => { s.collector.spec.template.spec.template.spec.containers[0].env.find(row => row.name === "EARNINGS_COLLECTION_ENABLED")!.value = "1"; },
  ]) {
    const r = runOperation("canary", {}, change);
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.text, /run (?:jobs|services) (?:update|execute)|scheduler jobs (pause|resume)/);
  }
  const unapproved = runOperation("canary", { EARNINGS_OPERATION_APPROVED_SHA: "" });
  assert.notEqual(unapproved.status, 0);
  assert.equal(unapproved.calls.length, 0);
});

test("activation requires current canary proof before enabling only earnings flags and its own schedule", () => {
  const r = runOperation("activate");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.state.schedule.state, "ENABLED");
  assert.equal(getOperationFlag(r.state, "sec", "EARNINGS_COLLECTION_ENABLED"), "1");
  assert.equal(getOperationFlag(r.state, "sec", "SEC_FILINGS_COLLECTOR_ENABLED"), "1");
  assert.equal(getOperationFlag(r.state, "worker", "EARNINGS_CANARY_ONLY"), "0");
  assert.match(r.text, /--update-env-vars EARNINGS_PROCESSING_ENABLED=1,EARNINGS_CANARY_ONLY=0/);
  const executions = r.calls.filter(call => call[2] === "execute");
  assert.deepEqual(executions.map(call => call[call.indexOf("--args") + 1]), [
    "dist/collect-earnings.cjs,--check-canary", "dist/collect-earnings.cjs,--verify-delivery",
  ]);
  assert.ok(r.text.indexOf("--check-canary") < r.text.indexOf("--update-env-vars"));
  assert.ok(r.text.indexOf("run jobs update collect-sec-filings-production") < r.text.indexOf("scheduler jobs resume collect-earnings-production"));
  const secUpdate = r.calls.find(call => call[2] === "update" && call[3] === "collect-sec-filings-production")!;
  assert.equal(secUpdate[secUpdate.indexOf("--update-env-vars") + 1], "EARNINGS_COLLECTION_ENABLED=1");
  assert.doesNotMatch(r.text, /--set-env-vars|add-iam|scheduler jobs (?:resume|pause) (?:collect-sec|refresh-company)|company-graph|OPENAI|--apply,--canary/);
});

test("activation without verified canary fails closed and does not enable SEC or resume a schedule", () => {
  const r = runOperation("activate", {}, s => { s.marker = false; });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No verified canary/);
  assert.equal(r.state.schedule.state, "PAUSED");
  assert.equal(getOperationFlag(r.state, "collector", "EARNINGS_COLLECTION_ENABLED"), "0");
  assert.equal(getOperationFlag(r.state, "worker", "EARNINGS_PROCESSING_ENABLED"), "0");
  assert.equal(getOperationFlag(r.state, "worker", "EARNINGS_CANARY_ONLY"), "0");
  assert.deepEqual(r.state.sec, r.initial.sec);
  assert.doesNotMatch(r.text, /scheduler jobs resume|run jobs update collect-sec-filings|--update-env-vars EARNINGS_\w+=1|--apply,--canary/);
});

test("failed activation or resume rolls back all earnings flags while preserving existing SEC settings", () => {
  for (const extra of [{ FAIL_UPDATE: "sec" }, { FAIL_RESUME: "1" }, { FAIL_PROBE: "1" }] as Array<Record<string, string>>) {
    const r = runOperation("activate", extra);
    assert.notEqual(r.status, 0);
    assert.equal(r.state.schedule.state, "PAUSED");
    assert.equal(getOperationFlag(r.state, "collector", "EARNINGS_COLLECTION_ENABLED"), "0");
    assert.equal(getOperationFlag(r.state, "worker", "EARNINGS_PROCESSING_ENABLED"), "0");
    assert.equal(getOperationFlag(r.state, "worker", "EARNINGS_CANARY_ONLY"), "0");
    assert.deepEqual(r.state.sec, r.initial.sec);
    assert.ok(r.calls.filter(call => call[0] === "scheduler" && call[2] === "resume").length <= 1);
    assert.doesNotMatch(r.text, /--set-env-vars|add-iam|--apply,--canary|company-graph|OPENAI/);
  }
});

test("rollback pauses earnings, resets its flags and canary scope, and reports unverifiable cleanup", () => {
  const change = (s: OperationState) => {
    s.schedule.state = "ENABLED";
    s.sec.spec.template.spec.template.spec.containers[0].env.find(row => row.name === "EARNINGS_COLLECTION_ENABLED")!.value = "1";
  };
  const r = runOperation("rollback", {}, change);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.state.schedule.state, "PAUSED");
  assert.equal(getOperationFlag(r.state, "sec", "EARNINGS_COLLECTION_ENABLED"), "0");
  assert.equal(getOperationFlag(r.state, "sec", "SEC_FILINGS_COLLECTOR_ENABLED"), "1");
  assert.equal(getOperationFlag(r.state, "worker", "EARNINGS_CANARY_ONLY"), "0");
  assert.equal(r.calls.filter(call => call[2] === "update").length, 3);
  assert.doesNotMatch(r.text, /run jobs execute|scheduler jobs resume|add-iam|company-graph|OPENAI/);
  const failed = runOperation("rollback", { FAIL_PAUSE: "1" }, change);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /rollback could not be fully verified/);
  assert.equal(getOperationFlag(failed.state, "sec", "EARNINGS_COLLECTION_ENABLED"), "0");
});

test("canary-only readback is required before live execution or activation resumes work", () => {
  for (const operation of ["canary", "activate"] as const) {
    const r = runOperation(operation, { IGNORE_CANARY_ONLY: "1" });
    assert.notEqual(r.status, 0);
    assert.equal(r.state.schedule.state, "PAUSED");
    assert.equal(getOperationFlag(r.state, "worker", "EARNINGS_PROCESSING_ENABLED"), "0");
    assert.equal(getOperationFlag(r.state, "collector", "EARNINGS_COLLECTION_ENABLED"), "0");
    assert.doesNotMatch(r.text, /--apply,--canary|scheduler jobs resume|run jobs update collect-sec-filings/);
    if (operation === "activate") assert.match(r.stderr, /rollback could not be fully verified/);
  }
});
