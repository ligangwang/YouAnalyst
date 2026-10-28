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
        if [[ "$1 $2 $3" == "run deploy instrument-onboarding-subscriber" ]]; then
          local previous=""
          for argument in "$@"; do
            if [[ "$previous" == "--env-vars-file" ]]; then
              node -e 'const fs=require("fs"),env=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log("themeEvidenceFirst="+env.THEME_EVIDENCE_FIRST_ENABLED)' "$argument" >> "$CALLS"
            fi
            previous="$argument"
          done
        fi
        if [[ "$1 $2 $3 $4" == "run jobs deploy collect-intelligence-news-production" ]]; then
          local previous=""
          for argument in "$@"; do
            if [[ "$previous" == "--env-vars-file" ]]; then
              node -e 'const fs=require("fs"),env=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log("snapshotBucket="+env.ENTITY_SNAPSHOT_BUCKET);console.log("newsTopic="+env.NEWS_SOURCE_REQUEST_TOPIC);console.log("cnTopic="+env.CN_DISCOVERY_REQUEST_TOPIC)' "$argument" >> "$CALLS"
            fi
            previous="$argument"
          done
        fi
        case "$*" in
          "firestore databases describe"*) echo nam5 ;;
          "eventarc triggers describe"*) if [[ "\${ONBOARDING_TRIGGER_NOT_READY:-0}" == 1 && "$*" == *"--format=json"* ]]; then echo '{"conditions":{"transport":{"code":"NOT_READY"}}}'; else echo '{"transport":{"pubsub":{"subscription":"projects/demo/subscriptions/onboarding-events"}},"destination":{"cloudRun":{"service":"instrument-onboarding-subscriber","region":"us-central1","path":"/events"}}}'; fi ;;
          "run services describe instrument-onboarding-subscriber"*"value(status.url)"*) echo https://onboarding.example.run.app ;;
          "run jobs execute onboard-instruments-production"*) if [[ "\${ONBOARDING_DELIVERY_FAIL:-0}" == 1 ]]; then return 1; fi ;;
          "run services describe instrument-onboarding-subscriber"*) echo '{"status":{"conditions":[{"type":"Ready","status":"True"}],"traffic":[{"percent":100,"revisionName":"onboarding-old"},{"tag":"candidate","revisionName":"onboarding-new","url":"https://candidate.example.run.app"}]}}' ;;
          "scheduler jobs describe onboard-instruments-production"*) if [[ "\${NEW_ONBOARDING:-0}" == 1 ]]; then return 1; fi ;;
          *"get-iam-policy"*)
            local arg
            for arg in "$@"; do
              if [[ "$arg" == *"AND bindings.members="* ]]; then printf '%s\\n' "\${arg##*AND bindings.members=}"; fi
            done ;;
          "pubsub subscriptions describe news-source-worker"*) echo projects/demo/topics/news-source-requests ;;
          "pubsub subscriptions describe cn-company-discovery-worker"*) echo projects/demo/topics/cn-company-discovery-requests ;;
          "pubsub subscriptions describe cn-company-discovery-dead-letter-audit"*) echo projects/demo/topics/cn-company-discovery-dead-letter ;;
          "run services describe cn-company-discovery-subscriber"*) echo https://subscriber.example.run.app ;;
          "pubsub subscriptions describe news-source-dead-letter-audit"*) echo projects/demo/topics/news-source-dead-letter ;;
          "run services describe news-source-subscriber"*) echo https://subscriber.example.run.app ;;
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

test('onboarding rollout verifies a no-traffic candidate and keeps existing schedules',()=>{
  const r=run('all',{INSTRUMENT_ONBOARDING_ENABLED:'1',EODHD_API_TOKEN:'private-test-token',OPENAI_API_KEY:'private-onboarding-ai-key',EODHD_BULK_EOD_BUCKET:'demo-eod',NEW_ONBOARDING:'1'});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.calls,/run jobs deploy onboard-instruments-production .*--image example\/image@sha256:abcdef/);
  assert.match(r.calls,/--args dist\/onboard-instruments.cjs,--process,--limit=1/);
  assert.match(r.calls,/--max-retries 0 --task-timeout 20m/);
  assert.match(r.calls,/run deploy instrument-onboarding-subscriber .*--no-allow-unauthenticated/);
  assert.match(r.calls,/themeEvidenceFirst=1/);
  assert.match(r.calls,/--args dist\/serve-instrument-onboarding.cjs .*--max-instances 10 --concurrency 2/);
  assert.match(r.calls,/eventarc triggers describe instrument-onboarding-requests/);
  assert.doesNotMatch(r.calls,/eventarc triggers (create|update|delete) instrument-onboarding-requests/);
  assert.doesNotMatch(r.calls,/scheduler jobs (create|update) http onboard-instruments-production/);
  assert.doesNotMatch(r.calls,/projects add-iam-policy-binding .*--role roles\/eventarc.eventReceiver/);
  const existing=run('all',{INSTRUMENT_ONBOARDING_ENABLED:'1',EODHD_API_TOKEN:'test',OPENAI_API_KEY:'test',EODHD_BULK_EOD_BUCKET:'demo-eod'});
  assert.equal(existing.status,0,existing.stderr);
  assert.doesNotMatch(existing.calls,/scheduler jobs (delete|pause|resume)/);
  assert.match(existing.calls,/--no-traffic --tag candidate/);
  assert.match(existing.calls,/run jobs update onboard-instruments-production .*--update-env-vars ONBOARDING_SUBSCRIBER_URL=https:\/\/onboarding.example.run.app/);
  assert.match(existing.calls,/ONBOARDING_SUBSCRIBER_URL=https:\/\/candidate.example.run.app,ONBOARDING_SUBSCRIBER_AUDIENCE=https:\/\/onboarding.example.run.app/);
  assert(existing.calls.indexOf('--verify-delivery')<existing.calls.indexOf('--to-revisions onboarding-new=100'));
  assert(existing.calls.indexOf('--verify-capacity')<existing.calls.indexOf('--to-revisions onboarding-new=100'));
  const unready=run('all',{INSTRUMENT_ONBOARDING_ENABLED:'1',EODHD_API_TOKEN:'test',OPENAI_API_KEY:'test',EODHD_BULK_EOD_BUCKET:'demo-eod',ONBOARDING_TRIGGER_NOT_READY:'1'});
  assert.notEqual(unready.status,0);assert.doesNotMatch(unready.calls,/scheduler jobs delete onboard-instruments-production/);
  assert.doesNotMatch(r.calls,/private-test-token|private-onboarding-ai-key|scheduler jobs (pause|resume)/);
  assert.match(r.calls,/run jobs execute onboard-instruments-production .*--args dist\/onboard-instruments.cjs,--verify-delivery/);
  assert.doesNotMatch(existing.calls,/scheduler jobs (delete|pause|resume)/);
  const failedDelivery=run('all',{INSTRUMENT_ONBOARDING_ENABLED:'1',EODHD_API_TOKEN:'test',OPENAI_API_KEY:'test',EODHD_BULK_EOD_BUCKET:'demo-eod',ONBOARDING_DELIVERY_FAIL:'1'});
  assert.notEqual(failedDelivery.status,0);assert.doesNotMatch(failedDelivery.calls,/scheduler jobs delete onboard-instruments-production/);
  const missingAi=run('all',{INSTRUMENT_ONBOARDING_ENABLED:'1',OPENAI_API_KEY:'',EODHD_API_TOKEN:'private-test-token',EODHD_BULK_EOD_BUCKET:'demo-eod'});
  assert.notEqual(missingAi.status,0);assert.match(missingAi.stderr,/OPENAI_API_KEY/);assert.doesNotMatch(missingAi.calls,/builds submit|run jobs deploy/);
  const invalid=run('all',{INSTRUMENT_ONBOARDING_ENABLED:'1',EODHD_API_TOKEN:'',EODHD_BULK_EOD_BUCKET:'demo-eod'});
  assert.notEqual(invalid.status,0);assert.doesNotMatch(invalid.calls,/builds submit|run jobs deploy/);
  const unchanged=run('directory',{INSTRUMENT_ONBOARDING_ENABLED:'1'});
  assert.equal(unchanged.status,0,unchanged.stderr);assert.doesNotMatch(unchanged.calls,/onboard-instruments-production/);
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

test('news queue deploys its subscriber before switching the scheduled publisher',()=>{
  const result=run('intelligence-news',{NEWS_SOURCE_QUEUE_ENABLED:'1',INTELLIGENCE_NEWS_COLLECTOR_ENABLED:'1',OPENAI_API_KEY:'existing-test-key'});
  assert.equal(result.status,0,result.stderr);
  assert(result.calls.indexOf('run deploy news-source-subscriber')<result.calls.indexOf('run jobs deploy collect-intelligence-news-production'));
  assert.match(result.calls,/newsTopic=news-source-requests/);
  assert.doesNotMatch(result.calls,/existing-test-key|scheduler jobs (pause|resume)|run jobs execute/);
  const invalid=run('intelligence-news',{NEWS_SOURCE_QUEUE_ENABLED:'invalid'});
  assert.notEqual(invalid.status,0);assert.doesNotMatch(invalid.calls,/builds submit|run deploy|run jobs deploy/);
});

test('A-share discovery queue is ready before the scheduled news publisher switches',()=>{
  const result=run('intelligence-news',{CN_DISCOVERY_QUEUE_ENABLED:'1',INTELLIGENCE_NEWS_COLLECTOR_ENABLED:'1',OPENAI_API_KEY:'existing-test-key'});
  assert.equal(result.status,0,result.stderr);
  assert(result.calls.indexOf('subscriptions update cn-company-discovery-worker')<result.calls.indexOf('run jobs deploy collect-intelligence-news-production'));
  assert.match(result.calls,/cnTopic=cn-company-discovery-requests/);
  assert.doesNotMatch(result.calls,/existing-test-key|scheduler jobs (pause|resume)|run jobs execute/);
  const invalid=run('intelligence-news',{CN_DISCOVERY_QUEUE_ENABLED:'invalid'});
  assert.notEqual(invalid.status,0);assert.doesNotMatch(invalid.calls,/builds submit|run deploy|run jobs deploy/);
});

test('calendar deployment uses Luna and the existing key without putting it in command arguments',()=>{
  const r=run('intelligence-news',{CALENDAR_EXTRACTION_ENABLED:'1',OPENAI_CALENDAR_MODEL:'gpt-6-luna',OPENAI_API_KEY:'calendar-test-secret'});
  assert.equal(r.status,0,r.stderr);assert.match(r.calls,/--env-vars-file/);assert.doesNotMatch(r.calls,/calendar-test-secret/);
  const invalid=run('intelligence-news',{CALENDAR_EXTRACTION_ENABLED:'1',OPENAI_CALENDAR_MODEL:'gpt-5.4',OPENAI_API_KEY:'calendar-test-secret'});
  assert.notEqual(invalid.status,0);assert.doesNotMatch(invalid.calls,/builds submit|run jobs deploy/);
});

test('A-share subscriber is provisioned before publication and preserves schedule state',()=>{
  const r=run('cn-fundamentals');assert.equal(r.status,0,r.stderr);
  assert.match(r.calls,/run deploy cn-fundamentals-subscriber.*--no-allow-unauthenticated.*--max-instances 1 --concurrency 10/);
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
  assert.match(r.calls,/run deploy eod-maintenance-subscriber.*--max-instances 4/);
  assert.match(r.calls,/pubsub topics add-iam-policy-binding eod-maintenance-requests.*--member serviceAccount:directory-sync-runtime@demo.iam.gserviceaccount.com.*roles\/pubsub.publisher/);
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

test('SEC financial bulk uses the existing private snapshot bucket and normal nightly publisher',()=>{
  const r=run('sec-fundamentals');assert.equal(r.status,0,r.stderr);
  assert.match(r.calls,/storage buckets add-iam-policy-binding gs:\/\/demo-snapshots.*roles\/storage.objectUser/);
  assert.match(r.calls,/run jobs deploy refresh-sec-fundamentals-production.*SEC_BULK_FINANCIALS_ENABLED=1/);
  assert.match(r.calls,/run deploy sec-fundamentals-subscriber.*SEC_BULK_FINANCIALS_ENABLED=1/);
  assert.doesNotMatch(r.calls,/run jobs execute|storage buckets create|scheduler jobs (pause|resume)/);
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
