import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

function run(extra:Record<string,string>={},arg=''){
  const dir=mkdtempSync(path.join(tmpdir(),'sec-download-deploy-'));
  try{
    const result=spawnSync('bash',['-c',`
      gcloud() {
        echo "$*" >> "$CALLS"
        if [[ -n "\${MISSING_RESOURCE:-}" && "$*" == *"describe $MISSING_RESOURCE "* ]]; then return 1; fi
        case "$*" in
          "storage buckets get-iam-policy"*)
            [[ "$*" != *"--filter"* ]] || { echo 'Storage get-iam-policy does not support --filter' >&2; return 2; }
            if [[ "\${MISSING_BUCKET_IAM:-0}" == 1 ]]; then echo '{"bindings":[]}';
            elif [[ "\${WRONG_BUCKET_MEMBER:-0}" == 1 ]]; then echo '{"bindings":[{"role":"roles/storage.objectUser","members":["serviceAccount:other@demo.iam.gserviceaccount.com"]}]}';
            elif [[ "\${CONDITIONAL_BUCKET_IAM:-0}" == 1 ]]; then echo '{"bindings":[{"role":"roles/storage.objectUser","condition":{"expression":"false"},"members":["serviceAccount:directory-sync-runtime@demo.iam.gserviceaccount.com"]}]}';
            else echo '{"bindings":[{"role":"roles/storage.objectUser","members":["serviceAccount:directory-sync-runtime@demo.iam.gserviceaccount.com"]}]}'; fi ;;
          *"get-iam-policy"*)
            if [[ "\${MISSING_IAM:-0}" == 1 ]]; then return 0; fi
            local arg
            for arg in "$@"; do
              if [[ "$arg" == *"AND bindings.members="* ]]; then printf '%s\\n' "\${arg##*AND bindings.members=}"; fi
            done ;;
          "storage buckets describe"*)
            if [[ "$*" == *"--format=json"* ]]; then
              if [[ "\${BAD_LIFECYCLE:-0}" == 1 ]]; then echo '{"uniform_bucket_level_access":true,"public_access_prevention":"enforced","lifecycle_config":[{"action":{"type":"Delete"}}]}';
              elif [[ "\${PUBLIC_BUCKET:-0}" == 1 ]]; then echo '{"uniform_bucket_level_access":true,"public_access_prevention":"inherited"}';
              else echo '{"uniform_bucket_level_access":true,"public_access_prevention":"enforced"}'; fi
            fi ;;
          "pubsub subscriptions describe sec-filing-download-worker"*) echo projects/demo/topics/\${WRONG_TOPIC:-sec-filing-download-requests} ;;
          "pubsub subscriptions describe sec-filing-download-dead-letter-audit"*) echo projects/demo/topics/sec-filing-download-dead-letter ;;
          "projects describe"*) echo 123456789 ;;
          "run services describe"*) echo https://subscriber.example.run.app ;;
        esac
      }
      export -f gcloud
      if [[ -n "$ARG" ]]; then bash scripts/deploy-sec-downloads.sh "$ARG"; else bash scripts/deploy-sec-downloads.sh; fi
    `],{encoding:'utf8',timeout:10000,env:{...process.env,GCP_PROJECT_ID:'demo',FUNDAMENTALS_IMAGE:'image@sha256:abc',GIT_SHA:'a'.repeat(40),SEC_USER_AGENT:'YouAnalyst admin@example.org',SEC_INCREMENTAL_DOWNLOADS_ENABLED:'1',SEC_DOCUMENT_CACHE_BUCKET:'private-sec-cache',SEC_DOWNLOAD_BOOTSTRAP_IAM:'0',CALLS:path.join(dir,'calls').replaceAll('\\','/'),ARG:arg,...extra}});
    let calls='';try{calls=readFileSync(path.join(dir,'calls'),'utf8');}catch{}
    return {...result,calls};
  }finally{rmSync(dir,{recursive:true,force:true});}
}
const mutations=/run deploy|run jobs deploy|add-iam-policy-binding|subscriptions (create|update)|topics create|buckets create/;
test('SEC download preflight validates private storage, retention and exact queue ownership without mutations',()=>{
  const checked=run({},'--check');assert.equal(checked.status,0,checked.stderr);assert.doesNotMatch(checked.calls,mutations);
  const cases:Record<string,string>[]=[{PUBLIC_BUCKET:'1'},{BAD_LIFECYCLE:'1'},{MISSING_IAM:'1'},{MISSING_BUCKET_IAM:'1'},{WRONG_BUCKET_MEMBER:'1'},{CONDITIONAL_BUCKET_IAM:'1'},{WRONG_TOPIC:'another-topic'},{SEC_DOCUMENT_CACHE_BUCKET:''},{MISSING_RESOURCE:'sec-filing-download-requests'}];
  for(const extra of cases){const rejected=run(extra);assert.notEqual(rejected.status,0,JSON.stringify(extra));assert.doesNotMatch(rejected.calls,mutations);}
});
test('SEC downloads and cleanup deploy bounded private workers without nightly bulk work',()=>{
  const result=run();assert.equal(result.status,0,result.stderr);
  assert.match(result.calls,/run deploy sec-filing-download-subscriber .*--no-allow-unauthenticated/);
  assert.match(result.calls,/--max-instances 2 --concurrency 1 --timeout 180/);
  assert.match(result.calls,/--args dist\/serve-sec-downloads.cjs/);
  assert.match(result.calls,/run jobs deploy cleanup-sec-downloads-production .*--args dist\/cleanup-sec-downloads.cjs,--apply/);
  assert.match(result.calls,/scheduler jobs update http cleanup-sec-downloads-production .*--schedule 20 \* \* \* \*/);
  assert.doesNotMatch(result.calls,/add-iam-policy-binding|allUsers|nightly|submissions\.zip|companyfacts\.zip|scheduler jobs (pause|resume)|run jobs execute/);
});
test('setup grants only resource-scoped access and no existing collector is switched',()=>{
  const result=run({SEC_DOWNLOAD_BOOTSTRAP_IAM:'1'});assert.equal(result.status,0,result.stderr);
  assert.match(result.calls,/storage buckets add-iam-policy-binding gs:\/\/private-sec-cache .*roles\/storage.objectUser/);
  assert.doesNotMatch(result.calls,/run jobs deploy collect-sec-filings-production|scheduler jobs .*collect-sec-filings-production|projects add-iam|allUsers/);
});
test('incremental mode sets hourly discovery and routes only new events through downloads',()=>{
  const script=readFileSync('scripts/deploy-sec-filings.sh','utf8');
  assert.match(script,/filing_topic=sec-filing-download-requests/);assert.match(script,/schedule='0 \* \* \* \*'/);
  assert(script.indexOf('bash scripts/deploy-sec-downloads.sh')<script.indexOf('gcloud run jobs deploy'));
  assert.match(script,/SEC_FILINGS_TOPIC=\$filing_topic/);
  assert.doesNotMatch(script,/submissions\.zip|companyfacts\.zip|bulkdata/);
});
