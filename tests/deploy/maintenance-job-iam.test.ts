import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Runs the deploy scripts against a fake gcloud that records every call.
const root = process.cwd();
const runtime = "directory-sync-runtime@demo.iam.gserviceaccount.com";
const scheduler = "directory-sync-scheduler@demo.iam.gserviceaccount.com";
const web = "web-runtime@demo.iam.gserviceaccount.com";

function fakeGcloud() {
  const dir = mkdtempSync(path.join(tmpdir(), "maintenance-iam-"));
  const log = path.join(dir, "calls.log");
  writeFileSync(log, "");
  writeFileSync(path.join(dir, "gcloud"), `#!/usr/bin/env bash
echo "$*" >> "$GCLOUD_LOG"
case "$*" in
  "run services describe"*) printf '%s\\n' "\${FAKE_WEB_SA-}" ;;
  "run jobs describe"*) printf '%s\\n' "\${FAKE_JOB_SA-}" ;;
  "scheduler jobs describe"*) exit 1 ;;
esac
`);
  chmodSync(path.join(dir, "gcloud"), 0o755);
  const env = (extra: Record<string, string>) =>
    ({ NODE_ENV: "test", PATH: `${dir}:${process.env.PATH}`, GCLOUD_LOG: log, GCP_PROJECT_ID: "demo", FAKE_JOB_SA: runtime, ...extra }) as NodeJS.ProcessEnv;
  return { dir, env, calls: () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean) };
}

function run(args: string[], env: Record<string, string> = {}) {
  const gcloud = fakeGcloud();
  const result = spawnSync("bash", args, { cwd: root, encoding: "utf8", env: gcloud.env(env) });
  return { ...result, calls: gcloud.calls() };
}

// Runs a workflow's `run:` steps in order like Actions: bash -e per step,
// GITHUB_ENV carried to later steps, stopping at the first failing step.
function runWorkflow(file: string, env: Record<string, string>) {
  const steps: string[] = [];
  const lines = readFileSync(path.join(root, file), "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s*)(?:- )?run: (.*)$/);
    if (!match) continue;
    if (match[2] !== "|") { steps.push(match[2]); continue; }
    const block: string[] = [];
    while (i + 1 < lines.length && (lines[i + 1].trim() === "" || lines[i + 1].search(/\S/) > match[1].length)) block.push(lines[++i].trim());
    steps.push(block.join("\n"));
  }
  const gcloud = fakeGcloud();
  const githubEnv = path.join(gcloud.dir, "github_env");
  writeFileSync(githubEnv, "");
  let status: number | null = 0, stderr = "";
  for (const step of steps) {
    const exported = Object.fromEntries(readFileSync(githubEnv, "utf8").split("\n").filter(Boolean).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
    const result = spawnSync("bash", ["-e", "-c", step], { cwd: root, encoding: "utf8", env: gcloud.env({ ...env, ...exported, GITHUB_ENV: githubEnv, GITHUB_SHA: "abc123", GCP_REGION: "us-central1" }) });
    ({ status, stderr } = result);
    if (status !== 0) break;
  }
  return { status, stderr, steps, calls: gcloud.calls() };
}
const mutations = (calls: string[]) => calls.filter(call => !/ describe( |$)/.test(call));

const helper = (env: Record<string, string> = {}) => run(["scripts/lib/maintenance-job-iam.sh", "some-job"], env);
const grants = (calls: string[]) => calls.filter(call => call.startsWith("run jobs add-iam-policy-binding"));

test("grants run.invoker to the scheduler and web accounts using the configured web account", () => {
  const result = helper({ WEB_RUNTIME_SERVICE_ACCOUNT: web });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.calls.some(call => call.startsWith("run services describe")));
  assert.ok(!result.calls.some(call => call.startsWith("run jobs update")), "runtime already correct");
  assert.deepEqual(grants(result.calls), [scheduler, web].map(account =>
    `run jobs add-iam-policy-binding some-job --project demo --region us-central1 --member serviceAccount:${account} --role roles/run.invoker --quiet`));
});

test("falls back to the deployed web service's account", () => {
  const result = helper({ FAKE_WEB_SA: web, CLOUD_RUN_SERVICE_PRODUCTION: "custom-web", GCP_REGION: "europe-west1" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.calls[0].startsWith("run services describe custom-web --project demo --region europe-west1"));
  assert.match(grants(result.calls)[1], new RegExp(`serviceAccount:${web} `));
});

test("fails loudly without mutating when the web account cannot be determined", () => {
  for (const env of [{ FAKE_WEB_SA: "" }, { WEB_RUNTIME_SERVICE_ACCOUNT: "not-an-account" }] as Record<string, string>[]) {
    const result = helper(env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /could not determine the web app's runtime service account/);
    assert.deepEqual(grants(result.calls), []);
  }
});

test("moves a job onto the shared runtime account", () => {
  const result = helper({ WEB_RUNTIME_SERVICE_ACCOUNT: web, FAKE_JOB_SA: "other@demo.iam.gserviceaccount.com" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.calls.includes(`run jobs update some-job --project demo --region us-central1 --service-account ${runtime} --quiet`));
});

test("dry run prints mutating commands without running them", () => {
  const result = helper({ WEB_RUNTIME_SERVICE_ACCOUNT: web, FAKE_JOB_SA: "", MAINTENANCE_IAM_DRY_RUN: "1" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.map(call => call.split(" ").slice(0, 3).join(" ")), ["run jobs describe"]);
  assert.equal(result.stdout.match(/^DRY RUN: gcloud run jobs /gm)?.length, 3);
  assert.match(result.stdout, new RegExp(`--member serviceAccount:${web} --role roles/run.invoker`));
});

for (const [script, job, env] of [
  ["deploy-sec-fundamentals.sh", "refresh-sec-fundamentals-production", { FUNDAMENTALS_IMAGE: "image", SEC_USER_AGENT: "ua" }],
  ["deploy-cn-fundamentals.sh", "refresh-cn-fundamentals-production", { FUNDAMENTALS_IMAGE: "image" }],
  ["deploy-private-valuations.sh", "refresh-private-valuations-production", { FUNDAMENTALS_IMAGE: "image" }],
  ["deploy-directory-sync.sh", "sync-cni-directory-production", { DIRECTORY_SYNC_IMAGE: "image" }],
] as const) {
  test(`${script} grants run.invoker on ${job} to the scheduler and web accounts`, () => {
    const result = run([`scripts/${script}`], { ...env, FAKE_WEB_SA: web });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.calls.some(call => call.startsWith(`run jobs deploy ${job} `) && call.includes(`--service-account ${runtime}`)));
    for (const account of [scheduler, web]) {
      assert.ok(grants(result.calls).some(call => call.startsWith(`run jobs add-iam-policy-binding ${job} `) && call.includes(`serviceAccount:${account} `)), account);
    }
    assert.ok(result.calls.some(call => call.includes(`--oauth-service-account-email ${scheduler}`)));
  });

  test(`${script} stops before deploying when the web account is unknown`, () => {
    const result = run([`scripts/${script}`], { ...env, FAKE_WEB_SA: "" });
    assert.notEqual(result.status, 0);
    assert.ok(!result.calls.some(call => call.startsWith("run jobs deploy") || call.startsWith("projects ") || call.startsWith("iam ")));
  });
}

test("--check validates without changing anything and prints the web account", () => {
  const result = run(["scripts/lib/maintenance-job-iam.sh", "--check", "some-job"], { FAKE_WEB_SA: web });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${web}\n`);
  assert.deepEqual(mutations(result.calls), []);
});

test("--check rejects invalid job names and project-derived accounts", () => {
  for (const [args, env, message] of [
    [["--check", "Bad_Job"], { WEB_RUNTIME_SERVICE_ACCOUNT: web }, /invalid Cloud Run job name/],
    [["--check", "some-job"], { WEB_RUNTIME_SERVICE_ACCOUNT: web, GCP_PROJECT_ID: "Bad Project" }, /invalid shared maintenance service account/],
    [["--check"], { WEB_RUNTIME_SERVICE_ACCOUNT: web }, /Usage/],
  ] as const) {
    const result = run(["scripts/lib/maintenance-job-iam.sh", ...args], env);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.deepEqual(result.calls, []);
  }
});

test("directory workflow makes no gcloud changes when the web account lookup fails", () => {
  const result = runWorkflow(".github/workflows/deploy-directory-sync.yml", { FAKE_WEB_SA: "" });
  assert.equal(result.steps.length, 4);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /could not determine the web app's runtime service account/);
  assert.deepEqual(mutations(result.calls), []);
});

test("directory workflow validates first, then updates the image, then applies IAM", () => {
  const result = runWorkflow(".github/workflows/deploy-directory-sync.yml", { FAKE_WEB_SA: web });
  assert.equal(result.status, 0, result.stderr);
  const commands = result.calls.map(call => call.split(" ").slice(0, 3).join(" "));
  assert.deepEqual(commands, ["run services describe", "builds submit .", "run jobs update", "run jobs describe", "run jobs add-iam-policy-binding", "run jobs add-iam-policy-binding"]);
  assert.match(grants(result.calls)[1], new RegExp(`serviceAccount:${web} `));
});

for (const file of [".github/workflows/deploy-sec-fundamentals.yml", ".github/workflows/deploy-cn-fundamentals.yml", ".github/workflows/deploy-private-valuations.yml"]) {
  test(`${file} makes no gcloud changes when the web account lookup fails`, () => {
    const result = runWorkflow(file, { FAKE_WEB_SA: "", FUNDAMENTALS_IMAGE: "image", SEC_USER_AGENT: "ua" });
    assert.notEqual(result.status, 0);
    assert.deepEqual(mutations(result.calls), []);
  });
}
