import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const tree = "a".repeat(40), sha = "b".repeat(40);
function run(extra: Record<string, string | undefined> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sec-graph-activation-"));
  const record = join(dir, "calls");
  writeFileSync(record, "");
  writeFileSync(join(dir, "git"), `#!/bin/sh\ncase "$*" in *HEAD\\^\\{tree\\}*) echo '${tree}';; *) echo '${sha}';; esac\n`, { mode: 0o755 });
  writeFileSync(join(dir, "gcloud"), `#!/usr/bin/env node
const {appendFileSync,writeFileSync,existsSync,readFileSync}=require('node:fs');
const args=process.argv.slice(2), env=process.env;
appendFileSync(env.RECORD,args.join(' ')+'\\n');
const project='ifindata-80905', region='us-central1', sha='${sha}', tree='${tree}';
const image=region+'-docker.pkg.dev/'+project+'/ifindata/sec-fundamentals@sha256:'+'c'.repeat(64);
const json=value=>console.log(JSON.stringify(value));
const name=args[3], path=env.STATE+'-'+name;
const container=(resource)=>({image:env.WRONG_IMAGE===resource ? image.replace(/c/g,'d') : image, command:['node'],
 args:['dist/refresh-company-graph.cjs','--verify-live'],env:Object.entries({GIT_SHA:sha,
 GCP_PROJECT_ID:env.WRONG_RUNTIME_PROJECT === resource ? "other-project" : project, COMPANY_GRAPH_QUEUE_BATCH_SIZE:'1', SEC_FILINGS_COLLECTOR_ENABLED:'1',
 COMPANY_GRAPH_PROCESSING_ENABLED:'1', OPENAI_MODEL:env.WRONG_MODEL || 'gpt-5.6-sol', COMPANY_GRAPH_VERIFY_ONLY:'0',
 SEC_GRAPH_RELEASE_SHA:sha,SEC_GRAPH_ACTIVATION_TREE:tree}).map(([name,value])=>({name,value}))});
if(args.slice(0,4).join(' ')==='artifacts docker images describe') console.log(env.BAD_DIGEST ? 'untrusted:tag' : image);
else if(args.slice(0,3).join(' ')==='scheduler jobs describe') {
 const state=existsSync(path) ? readFileSync(path,'utf8') : 'PAUSED';
 if(args.includes('--format=json')) json({state,schedule:name.startsWith('refresh')?'*/5 * * * *':'*/15 * * * *',timeZone:'UTC',
 httpTarget:{httpMethod:'POST',uri:env.WRONG_TARGET ? 'https://wrong.example' : 'https://run.googleapis.com/v2/projects/ifindata-80905/locations/us-central1/jobs/'+name+':run'}});
 else console.log(state);
} else if(args.slice(0,3).join(' ')==='scheduler jobs pause') writeFileSync(path,'PAUSED');
else if(args.slice(0,3).join(' ')==='scheduler jobs resume') {
 if(env.FAIL_SECOND_RESUME && name.startsWith('collect')) process.exit(1);
 writeFileSync(path,'ENABLED');
} else if(args.slice(0,3).join(' ')==='run jobs describe') json({spec:{template:{spec:{template:{spec:{
 serviceAccountName:'directory-sync-runtime@ifindata-80905.iam.gserviceaccount.com',containers:[container(name)]}}}}}});
else if(args.slice(0,3).join(' ')==='run services describe') json({spec:{template:{spec:{containers:[container(name)]}}},
 status:{latestReadyRevisionName:'ready',latestCreatedRevisionName:'ready',traffic:[{revisionName:'ready',percent:100}]}});
else if(args.slice(0,3).join(' ')==='run jobs execute') {
 if(env.FAIL_CANARY) process.exit(1);
 console.log(env.AMBIGUOUS_EXECUTION ? 'unexpected' : 'refresh-company-graph-production-canary');
} else if(args.slice(0,4).join(' ')==='run jobs executions describe') json({metadata:{name:'refresh-company-graph-production-canary'},
 spec:{taskCount:1,template:{spec:{containers:[container('execution')]}}},status:{conditions:[{type:'Completed',status:env.FAIL_EXECUTION?'False':'True'}],succeededCount:1}});
else {console.error('Unexpected mock gcloud command');process.exit(2);}
`, { mode: 0o755 });
  const result = spawnSync("bash", [resolve("scripts/activate-sec-graph.sh")], {
    encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, RECORD: record, STATE: join(dir, "state"),
      GCP_PROJECT_ID: "ifindata-80905", GCP_REGION: "us-central1", GIT_SHA: sha, SEC_GRAPH_ACTIVATE_TREE: tree,
      ENABLE_SEC_FILING_PIPELINE: "1", SEC_FILINGS_COLLECTOR_ENABLED: "1", COMPANY_GRAPH_PROCESSING_ENABLED: "1",
      COMPANY_GRAPH_QUEUE_BATCH_SIZE: "1", ...extra },
  });
  const calls = readFileSync(record, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { ...result, calls };
}

test("activation executes once in the existing runtime, checks the exact image, then enables both existing schedules", () => {
  const r = run(); assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls.match(/run jobs execute /g)?.length, 1);
  assert.match(r.calls, /artifacts docker images describe us-central1-docker.pkg.dev\/ifindata-80905\/ifindata\/sec-fundamentals:/);
  assert.match(r.calls, /--args dist\/refresh-company-graph.cjs,--verify-live/);
  assert.match(r.calls, new RegExp(`SEC_GRAPH_ACTIVATION_TREE=${tree},SEC_GRAPH_RELEASE_SHA=${sha}`));
  assert.ok(r.calls.indexOf("run jobs executions describe") < r.calls.indexOf("scheduler jobs resume"));
  assert.equal(r.calls.match(/scheduler jobs resume /g)?.length, 2);
  assert.doesNotMatch(r.calls, /create|delete|add-iam|set-iam|secrets|OPENAI_API_KEY|jobs update|services update/);
});
test("a stale or missing tree never runs cloud commands on a later release", () => {
  for (const SEC_GRAPH_ACTIVATE_TREE of ["", "c".repeat(40)]) {
    const r = run({ SEC_GRAPH_ACTIVATE_TREE }); assert.equal(r.status, 0, r.stderr); assert.equal(r.calls, "");
  }
});
test("matching approval still requires both flags, batch one, exact digest and exact existing schedule targets", () => {
  for (const extra of [{ COMPANY_GRAPH_PROCESSING_ENABLED: "0" }, { SEC_FILINGS_COLLECTOR_ENABLED: "0" },
    { COMPANY_GRAPH_QUEUE_BATCH_SIZE: "2" }, { BAD_DIGEST: "1" }, { WRONG_TARGET: "1" }, { WRONG_MODEL: "gpt-other" }]) {
    const r = run(extra); assert.notEqual(r.status, 0, JSON.stringify(extra));
    assert.doesNotMatch(r.calls, /jobs execute|jobs resume/);
  }
});
test("both jobs and both subscribers must use the reviewed immutable image", () => {
  for (const WRONG_IMAGE of ["refresh-company-graph-production", "collect-sec-filings-production", "company-graph-subscriber", "sec-fundamentals-subscriber"]) {
    const r = run({ WRONG_IMAGE }); assert.notEqual(r.status, 0, WRONG_IMAGE);
    assert.doesNotMatch(r.calls, /jobs execute|jobs resume/);
  }
});
test("failed or ambiguous verification leaves both existing schedules paused without a second execution", () => {
  for (const extra of [{ FAIL_CANARY: "1" }, { AMBIGUOUS_EXECUTION: "1" }, { FAIL_EXECUTION: "1" }, { WRONG_IMAGE: "execution" }]) {
    const r = run(extra); assert.notEqual(r.status, 0, JSON.stringify(extra));
    assert.equal(r.calls.match(/run jobs execute /g)?.length, 1);
    assert.doesNotMatch(r.calls, /jobs resume/);
    assert.equal(r.calls.match(/scheduler jobs pause /g)?.length, 4);
  }
});
test("a partial resume failure rolls both schedules back to paused", () => {
  const r = run({ FAIL_SECOND_RESUME: "1" }); assert.notEqual(r.status, 0);
  const lines = r.calls.trim().split("\n");
  assert.match(lines.at(-2)!, /^scheduler jobs pause refresh-company-graph-production/);
  assert.match(lines.at(-1)!, /^scheduler jobs pause collect-sec-filings-production/);
});
test("the ordinary production release owns the gated activation after existing delivery checks", () => {
  const workflow = readFileSync(".github/workflows/deploy.yml", "utf8");
  const job = workflow.slice(workflow.indexOf("  deploy-background-jobs:"));
  assert.match(job, /SEC_GRAPH_ACTIVATE_TREE: \$\{\{ vars.SEC_GRAPH_ACTIVATE_TREE \}\}/);
  assert.ok(job.indexOf("--verify-delivery") < job.indexOf("bash scripts/activate-sec-graph.sh"));
  assert.match(job, /if: .*COMPANY_GRAPH_PROCESSING_ENABLED == '1'.*SEC_FILINGS_COLLECTOR_ENABLED == '1'.*SEC_GRAPH_ACTIVATE_TREE != ''/);
});

test("target and runtime budget stores are bound to the approved production project", () => {
  for (const extra of [{ GCP_PROJECT_ID: "other-project" }, { GCP_REGION: "other-region" },
    ...["refresh-company-graph-production", "collect-sec-filings-production", "company-graph-subscriber", "sec-fundamentals-subscriber"].map(WRONG_RUNTIME_PROJECT => ({ WRONG_RUNTIME_PROJECT }))]) {
    const r = run(extra); assert.notEqual(r.status, 0); assert.doesNotMatch(r.calls, /jobs execute|jobs resume/);
  }
  const r = run({ WRONG_RUNTIME_PROJECT: "execution" }); assert.notEqual(r.status, 0); assert.doesNotMatch(r.calls, /jobs resume/);
});
