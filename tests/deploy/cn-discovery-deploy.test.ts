import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

function run(extra:Record<string,string>={},arg=''){
  const dir=mkdtempSync(path.join(tmpdir(),'cn-queue-deploy-'));
  try{
    const result=spawnSync('bash',['-c',`
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
            if [[ "$*" == *"value(topic)"* ]]; then
              local topic=cn-company-discovery-requests
              if [[ "$4" == *-audit ]]; then topic=cn-company-discovery-dead-letter; fi
              echo "projects/demo/topics/\${WRONG_TOPIC:-$topic}"
            fi ;;
          "projects describe"*) echo 123456789 ;;
          "run revisions describe"*)
            node -e 'console.log(JSON.stringify({metadata:{name:process.env.DISCOVERY_RELEASE_REVISION},spec:{serviceAccountName:process.env.DISCOVERY_RELEASE_ACCOUNT,containers:[{image:process.env.DISCOVERY_RELEASE_IMAGE,command:["node"],args:["dist/serve-cn-discovery.cjs"],env:[{name:"GIT_SHA",value:process.env.GIT_SHA}]}]},status:{conditions:[{type:"Ready",status:"True"}]}}))' ;;
          "run services describe"*)
            if [[ "$*" == *"--format=json"* ]]; then
              node -e 'console.log(JSON.stringify({status:{traffic:[{tag:"candidate",revisionName:process.env.DISCOVERY_RELEASE_REVISION,url:"https://candidate.example.run.app",percent:100}]}}))'
            else echo https://subscriber.example.run.app; fi ;;
          "auth print-identity-token"*) echo test-token ;;
          "run services update-traffic"*) [[ "\${HEALTH_FAIL:-0}" != 1 ]] ;;

        esac
      }
      curl() { echo "candidate-health" >> "$CALLS"; [[ "\${HEALTH_FAIL:-0}" != 1 ]] && echo ok; }
      export -f gcloud curl
      if [[ -n "$ARG" ]]; then bash scripts/deploy-cn-discovery.sh "$ARG"; else bash scripts/deploy-cn-discovery.sh; fi
    `],{encoding:'utf8',timeout:10000,env:{...process.env,GCP_PROJECT_ID:'demo',ENTITY_SNAPSHOT_BUCKET:'demo-snapshots',FUNDAMENTALS_IMAGE:'image@sha256:abc',GIT_SHA:'a'.repeat(40),CN_DISCOVERY_BOOTSTRAP_IAM:'0',CN_DISCOVERY_QUEUE_ENABLED:'1',CALLS:path.join(dir,'calls').replaceAll('\\','/'),ARG:arg,...extra}});
    let calls='';try{calls=readFileSync(path.join(dir,'calls'),'utf8');}catch{}
    return {...result,calls};
  }finally{rmSync(dir,{recursive:true,force:true});}
}
const mutations=/run deploy|add-iam-policy-binding|subscriptions (create|update)|topics create/;

test('A-share queue preflight checks exact resources and IAM without mutations',()=>{
  const result=run({},'--check');assert.equal(result.status,0,result.stderr);assert.doesNotMatch(result.calls,mutations);
  const failures:Record<string,string>[]=[{MISSING_RESOURCE:'cn-company-discovery-requests'},{MISSING_IAM:'1'},{WRONG_TOPIC:'someone-elses-topic'}];
  for(const extra of failures){
    const rejected=run(extra);assert.notEqual(rejected.status,0);assert.doesNotMatch(rejected.calls,mutations);
  }
});

test('routine deployment is private, bounded and reuses push identity without AI credentials',()=>{
  const result=run();assert.equal(result.status,0,result.stderr);
  assert.match(result.calls,/run deploy cn-company-discovery-subscriber .*--no-allow-unauthenticated/);
  assert.match(result.calls,/--max-instances 4 --concurrency 10 --timeout 600/);
  assert.match(result.calls,/--args dist\/serve-cn-discovery.cjs/);
  assert.match(result.calls,/--memory 2Gi --cpu 1/);
  assert.match(result.calls,/NODE_OPTIONS=--max-old-space-size=1536/);
  assert.match(result.calls,/subscriptions update cn-company-discovery-worker .*--push-auth-service-account directory-sync-scheduler@demo/);
  assert.match(result.calls,/--dead-letter-topic cn-company-discovery-dead-letter/);
  assert.doesNotMatch(result.calls,/add-iam-policy-binding|OPENAI|allUsers|scheduler jobs|run jobs execute|projects add/);
});

test('only explicit setup grants resource access; invalid bounds fail before mutations',()=>{
  const setup=run({CN_DISCOVERY_BOOTSTRAP_IAM:'1'});assert.equal(setup.status,0,setup.stderr);
  assert.match(setup.calls,/topics add-iam-policy-binding cn-company-discovery-requests/);
  assert.doesNotMatch(setup.calls,/projects add-iam|iam service-accounts|scheduler jobs|allUsers/);
  const wrong=run({CN_DISCOVERY_BOOTSTRAP_IAM:'1',WRONG_TOPIC:'someone-elses-topic'},'--check');
  assert.notEqual(wrong.status,0);assert.doesNotMatch(wrong.calls,mutations);
  for(const CN_DISCOVERY_MAX_INSTANCES of ['0','21','invalid']){
    const rejected=run({CN_DISCOVERY_MAX_INSTANCES});assert.notEqual(rejected.status,0);assert.doesNotMatch(rejected.calls,mutations);
  }
});

test('company storage buckets are required and passed to the CN discovery worker',()=>{
  const normal=run();assert.equal(normal.status,0,normal.stderr);
  assert.match(normal.calls,/storage buckets describe gs:\/\/demo-snapshots/);
  assert.match(normal.calls,/run deploy cn-company-discovery-subscriber .*ENTITY_SNAPSHOT_BUCKET=demo-snapshots/);
  const fallback=run({ENTITY_SNAPSHOT_BUCKET:'',EODHD_BULK_EOD_BUCKET:'fallback-snapshots'});
  assert.equal(fallback.status,0,fallback.stderr);assert.match(fallback.calls,/ENTITY_SNAPSHOT_BUCKET=fallback-snapshots/);
  const failures:Record<string,string>[]=[{ENTITY_SNAPSHOT_BUCKET:'',EODHD_BULK_EOD_BUCKET:''},{MISSING_RESOURCE:'gs://demo-snapshots'}];
  for(const extra of failures){
    const rejected=run(extra);assert.notEqual(rejected.status,0);assert.doesNotMatch(rejected.calls,mutations);
  }
});

test('candidate health is validated before traffic and failure preserves serving revision',()=>{
  const result=run();assert.equal(result.status,0,result.stderr);
  assert.match(result.calls,/--no-traffic --tag candidate/);
  assert(result.calls.indexOf('candidate-health')<result.calls.indexOf('run services update-traffic'));
  const failed=run({HEALTH_FAIL:'1'});assert.notEqual(failed.status,0);
  assert.doesNotMatch(failed.calls,/run services update-traffic|subscriptions update/);
});
