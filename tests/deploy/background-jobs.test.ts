import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";

function run(target:string,extra:Record<string,string>={}) {
  const dir=mkdtempSync(path.join(tmpdir(),'background-deploy-'));
  try {
    const result=spawnSync('bash',['-c',`
      gcloud() {
        echo "$*" >> "$CALLS"
        if [[ "$1 $2 $3 $4" == "run jobs deploy collect-intelligence-news-production" ]]; then
          local previous=""
          for argument in "$@"; do
            if [[ "$previous" == "--env-vars-file" ]]; then
              node -e 'const fs=require("fs");console.log("snapshotBucket="+JSON.parse(fs.readFileSync(process.argv[1],"utf8")).ENTITY_SNAPSHOT_BUCKET)' "$argument" >> "$CALLS"
            fi
            previous="$argument"
          done
        fi
        case "$*" in
          "pubsub topics describe"*|"pubsub subscriptions describe"*) if [[ "\${NEW_PUBSUB:-0}" == 1 ]]; then return 1; fi ;;
          "run services describe eod-maintenance-subscriber"*|"run services describe sec-fundamentals-subscriber"*|"run services describe cn-fundamentals-subscriber"*|"run services describe cni-directory-subscriber"*) echo https://subscriber.example.run.app ;;
          "run services describe"*) echo "$WEB_SA" ;;
          "projects describe"*) echo 123456789 ;;
          "run jobs describe"*) echo directory-sync-runtime@demo.iam.gserviceaccount.com ;;
          "builds submit"*) echo build-id ;;
          "builds describe"*) echo SUCCESS ;;
          "artifacts docker images describe"*) echo example/image@sha256:abcdef ;;
        esac
      }
      export -f gcloud
      if [[ "\${PUBLISHER_ONLY:-0}" == 1 ]]; then
        bash scripts/deploy-eod-maintenance.sh --publisher-only
      else
        bash scripts/deploy-background-jobs.sh "$TARGET"
      fi
    `],{encoding:'utf8',timeout:10000,env:{...process.env,CALLS:path.join(dir,'calls').replaceAll('\\','/'),TARGET:target,ENTITY_SNAPSHOT_BUCKET:'demo-snapshots',GCP_PROJECT_ID:'demo',GIT_SHA:'commit',SEC_USER_AGENT:'test contact',WEB_RUNTIME_SERVICE_ACCOUNT:'',WEB_SA:'web@demo.iam.gserviceaccount.com',ENABLE_SEC_FILING_PIPELINE:'0',CLOUD_RUN_SERVICE_PRODUCTION:'web',...extra}});
    assert.ifError(result.error);
    let calls='';try{calls=readFileSync(path.join(dir,'calls'),'utf8');}catch{}
    return {...result,calls};
  }finally{rmSync(dir,{recursive:true,force:true});}
}
test('all workers build one shared image and one directory image without executing jobs',()=>{
  const r=run('all');assert.equal(r.status,0,r.stderr);
  assert.equal(r.calls.match(/builds submit/g)?.length,2);
  assert.equal(r.calls.match(/run jobs deploy/g)?.length,2);
  assert.equal(r.calls.match(/run jobs update/g)?.length,1);
  assert.doesNotMatch(r.calls,/private-valuations|ticker-catalog/);
  assert.doesNotMatch(r.calls,/run jobs execute/);assert.match(r.calls,/--image example\/image@sha256:abcdef/);
  assert.match(r.calls,/pubsub topics add-iam-policy-binding sec-fundamentals-requests .*--member serviceAccount:web@demo.iam.gserviceaccount.com --role roles\/pubsub.publisher/);
  assert.doesNotMatch(r.calls,/pubsub topics add-iam-policy-binding sec-fundamentals-(updates|dead-letter) .*--member serviceAccount:web@demo.iam.gserviceaccount.com/);
});
test('directory-only deploy avoids shared build and schedule changes',()=>{
  const r=run('directory');assert.equal(r.status,0,r.stderr);
  assert.equal(r.calls.match(/builds submit/g)?.length,1);
  assert.match(r.calls,/cloudbuild.directory-sync.yaml/);assert.doesNotMatch(r.calls,/scheduler jobs/);
  assert.match(r.calls,/run deploy cni-directory-subscriber.*--no-allow-unauthenticated.*--args dist\/serve-cni-directory.cjs/);
  assert.match(r.calls,/DIRECTORY_REQUEST_TOPIC=cni-directory-requests/);
  assert.ok(r.calls.indexOf('subscriptions update cni-directory-worker') < r.calls.indexOf('run jobs update sync-cni-directory-production'));
});

test('official news deploy is isolated, bounded and disabled by default',()=>{
  const r=run('intelligence-news');assert.equal(r.status,0,r.stderr);
  assert.equal(r.calls.match(/builds submit/g)?.length,1);
  assert.match(r.calls,/run jobs deploy collect-intelligence-news-production .*--tasks 1 --parallelism 1/);
  assert.match(r.calls,/--task-timeout 20m/);
  assert.match(r.calls,/--max-retries 0/);
  assert.match(r.calls,/--args dist\/collect-intelligence-news.cjs,--apply/);
  assert.match(r.calls,/--env-vars-file/);
  assert.doesNotMatch(r.calls,/pubsub|run jobs execute|scheduler jobs resume|run deploy/);
  assert.doesNotMatch(run('all').calls,/collect-intelligence-news-production/);
});

test('calendar deployment uses Luna and the existing key without putting it in command arguments',()=>{
  const r=run('intelligence-news',{CALENDAR_EXTRACTION_ENABLED:'1',OPENAI_CALENDAR_MODEL:'gpt-6-luna',OPENAI_API_KEY:'calendar-test-secret'});
  assert.equal(r.status,0,r.stderr);assert.match(r.calls,/--env-vars-file/);assert.doesNotMatch(r.calls,/calendar-test-secret/);
  const invalid=run('intelligence-news',{CALENDAR_EXTRACTION_ENABLED:'1',OPENAI_CALENDAR_MODEL:'gpt-5.4',OPENAI_API_KEY:'calendar-test-secret'});
  assert.notEqual(invalid.status,0);assert.doesNotMatch(invalid.calls,/builds submit|run jobs deploy/);
});

test('A-share subscriber is provisioned before publication and preserves schedule state',()=>{
  const r=run('cn-fundamentals');assert.equal(r.status,0,r.stderr);
  assert.match(r.calls,/run deploy cn-fundamentals-subscriber.*--no-allow-unauthenticated.*--concurrency 1/);
  assert.match(r.calls,/CN_FUNDAMENTALS_SUBSCRIPTION=cn-fundamentals-worker/);
  assert.match(r.calls,/--dead-letter-topic cn-fundamentals-dead-letter/);
  assert.match(r.calls,/CN_FUNDAMENTALS_REQUEST_TOPIC=cn-fundamentals-requests/);
  assert.ok(r.calls.indexOf('subscriptions update cn-fundamentals-worker') < r.calls.indexOf('run jobs deploy refresh-cn-fundamentals-production'));
  assert.doesNotMatch(r.calls,/scheduler jobs (pause|resume)|iam service-accounts add-iam-policy-binding/);
});
test('financial changes build once for remaining workers and skip directory',()=>{
  const r=run('fundamentals');assert.equal(r.status,0,r.stderr);
  assert.equal(r.calls.match(/builds submit/g)?.length,1);
  assert.equal(r.calls.match(/run jobs deploy/g)?.length,2);
  assert.doesNotMatch(r.calls,/run jobs update|cloudbuild.directory-sync.yaml/);
});
test('SEC deployment creates private bounded subscriber before switching the publisher',()=>{
  const r=run('sec-fundamentals');assert.equal(r.status,0,r.stderr);
  assert.match(r.calls,/run deploy sec-fundamentals-subscriber.*--no-allow-unauthenticated.*--min-instances 0 --max-instances 1.*--concurrency 1/);
  assert.match(r.calls,/--push-auth-service-account directory-sync-scheduler@demo.iam.gserviceaccount.com/);
  assert.match(r.calls,/--ack-deadline 600.*--dead-letter-topic sec-fundamentals-dead-letter/);
  assert.match(r.calls,/subscriptions add-iam-policy-binding sec-fundamentals-worker.*roles\/pubsub.subscriber/);
  assert.match(r.calls,/FUNDAMENTALS_REQUEST_TOPIC=sec-fundamentals-requests/);
  assert.ok(r.calls.indexOf('run deploy sec-fundamentals-subscriber') < r.calls.indexOf('run jobs deploy refresh-sec-fundamentals-production'));
  assert.doesNotMatch(r.calls,/iam service-accounts add-iam-policy-binding/);
});

test('only explicit bootstrap configures Pub/Sub token creation on the push identity',()=>{
  const r=run('sec-fundamentals',{PUBSUB_BOOTSTRAP_IAM:'1'});assert.equal(r.status,0,r.stderr);
  assert.match(r.calls,/iam service-accounts add-iam-policy-binding directory-sync-scheduler@demo.iam.gserviceaccount.com.*--member serviceAccount:service-123456789@gcp-sa-pubsub.iam.gserviceaccount.com --role roles\/iam.serviceAccountTokenCreator/);
});
test('invalid selection or missing IAM/SEC configuration fails before mutations',()=>{
  for(const [target,extra] of [['private-valuations',{}],['ticker-sync',{}],['bad',{}],['all',{SEC_USER_AGENT:''}],['directory',{WEB_SA:''}]] as [string,Record<string,string>][]) {
    const r=run(target,extra);assert.notEqual(r.status,0);
    assert.doesNotMatch(r.calls,/builds submit|run jobs (deploy|update|add-iam)/);
  }
});


test('EOD deployment is private, retained before publication, and reuses scoped provider configuration',()=>{
  const r=run('eod-maintenance',{NEW_PUBSUB:'1',EODHD_BULK_EOD_BUCKET:'existing-bulk-cache',EODHD_API_TOKEN:'secret-for-test'});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.calls,/subscriptions create eod-maintenance-worker --topic eod-maintenance-requests/);
  assert.ok(r.calls.indexOf('subscriptions create eod-maintenance-worker') < r.calls.indexOf('run deploy eod-maintenance-subscriber'));
  assert.match(r.calls,/run deploy eod-maintenance-subscriber.*--no-allow-unauthenticated.*--args dist\/serve-eod-maintenance.cjs.*--concurrency 1/);
  assert.match(r.calls,/--dead-letter-topic eod-maintenance-dead-letter/);
  assert.match(r.calls,/storage buckets add-iam-policy-binding gs:\/\/existing-bulk-cache.*roles\/storage.objectUser/);
  assert.doesNotMatch(r.calls,/secret-for-test|scheduler jobs (pause|resume)/);
});

test('web publisher bootstrap needs no beta component or worker image',()=>{
  const r=run('eod-maintenance',{PUBLISHER_ONLY:'1',NEW_PUBSUB:'1'});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.calls,/subscriptions create eod-maintenance-worker/);
  assert.match(r.calls,/topics add-iam-policy-binding eod-maintenance-requests/);
  assert.doesNotMatch(r.calls,/beta |run deploy|builds submit/);
});

test('enabled news requires its key before building even without calendar extraction',()=>{
  const missing=run('intelligence-news',{INTELLIGENCE_NEWS_COLLECTOR_ENABLED:'1',CALENDAR_EXTRACTION_ENABLED:'0',OPENAI_API_KEY:''});
  assert.notEqual(missing.status,0);
  assert.match(missing.stderr,/OPENAI_API_KEY/);
  assert.doesNotMatch(missing.calls,/builds submit|run jobs deploy/);
  const configured=run('intelligence-news',{INTELLIGENCE_NEWS_COLLECTOR_ENABLED:'1',CALENDAR_EXTRACTION_ENABLED:'0',OPENAI_API_KEY:'news-test-secret'});
  assert.equal(configured.status,0,configured.stderr);
  assert.match(configured.calls,/run jobs deploy collect-intelligence-news-production/);
  assert.doesNotMatch(configured.calls,/news-test-secret/);
});

test('verified timestamp migration enables a private daily snapshot job without executing it',()=>{
 const r=run('intelligence-news',{ENTITY_TIMESTAMP_MIGRATION_COMPLETE:'1',ENTITY_SNAPSHOT_BUCKET:'private-snapshots'});
 assert.equal(r.status,0,r.stderr);
 assert.match(r.calls,/run jobs deploy sync-entity-snapshots-production .*--args dist\/sync-entity-snapshots.cjs/);
 assert.match(r.calls,/scheduler jobs update http sync-entity-snapshots-production .*--schedule 0 3 \* \* \* --time-zone America\/New_York/);
 assert.match(r.calls,/storage buckets add-iam-policy-binding gs:\/\/private-snapshots/);
 assert.doesNotMatch(r.calls,/projects add-iam-policy-binding/);
 assert.doesNotMatch(r.calls,/run jobs execute|allUsers|storage buckets create/);
});


test('news worker receives the SQLite bucket including legacy fallback and rejects absent configuration',()=>{
 const standard=run('intelligence-news');assert.equal(standard.status,0,standard.stderr);assert.match(standard.calls,/snapshotBucket=demo-snapshots/);
 const fallback=run('intelligence-news',{ENTITY_SNAPSHOT_BUCKET:'',EODHD_BULK_EOD_BUCKET:'fallback-snapshots'});
 assert.equal(fallback.status,0,fallback.stderr);assert.match(fallback.calls,/snapshotBucket=fallback-snapshots/);
 const missing=run('intelligence-news',{ENTITY_SNAPSHOT_BUCKET:'',EODHD_BULK_EOD_BUCKET:''});
 assert.notEqual(missing.status,0);assert.doesNotMatch(missing.calls,/run jobs deploy/);
});
