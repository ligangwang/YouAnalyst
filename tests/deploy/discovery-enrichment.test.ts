import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
function run(kind='sec',extra:Record<string,string>={},check=false){
 const dir=mkdtempSync(path.join(tmpdir(),'discovery-enrichment-'));
 try{
  const r=spawnSync('bash',['-c',`
gcloud(){
 echo "$*" >> "$CALLS"
 case "$*" in
  *get-iam-policy*)
   [[ "\${MISSING_IAM:-0}" != 1 ]] || return 0
   for arg in "$@"; do if [[ "$arg" == *"AND bindings.members="* ]]; then printf '%s\\n' "\${arg##*AND bindings.members=}"; fi; done ;;
  "projects describe"*) echo 123456789 ;;
  "pubsub subscriptions describe"*)
   [[ "\${MISSING_RESOURCE:-0}" != 1 ]] || return 1
   if [[ "$*" == *"value(topic)"* ]]; then
    local topic; case "$4" in
     sec-company-discovery-worker) topic=sec-company-discovery-requests ;;
     news-article-enrichment-worker) topic=news-article-enrichment-requests ;;
     *-audit) topic="\${4%-audit}" ;;
    esac
    echo "projects/demo/topics/\${WRONG_TOPIC:-$topic}"
   fi ;;
  "run services describe"*) echo https://subscriber.example.run.app ;;
  "run deploy"*)
   local previous='' arg
   for arg in "$@"; do
    if [[ "$previous" == --env-vars-file ]]; then cat "$arg" > "$CAPTURE"; echo "$arg" > "$ENV_PATH"; fi
    previous="$arg"
   done ;;
 esac
}
export -f gcloud
bash scripts/deploy-discovery-enrichment.sh "$KIND" $CHECK
`],{encoding:'utf8',timeout:15000,env:{...process.env,KIND:kind,CHECK:check?'--check':'',GCP_PROJECT_ID:'demo',ENTITY_SNAPSHOT_BUCKET:'snapshots',GIT_SHA:'a'.repeat(40),FUNDAMENTALS_IMAGE:'image@sha256:abc',SEC_USER_AGENT:'existing contact',OPENAI_API_KEY:'existing-approved-key',SEC_DISCOVERY_QUEUE_ENABLED:'1',NEWS_ENRICHMENT_QUEUE_ENABLED:'1',SEC_INCREMENTAL_DOWNLOADS_ENABLED:'1',SEC_DOCUMENT_CACHE_BUCKET:'private-cache',DISCOVERY_ENRICHMENT_BOOTSTRAP_IAM:'0',CALLS:path.join(dir,'calls').replaceAll('\\','/'),CAPTURE:path.join(dir,'env').replaceAll('\\','/'),ENV_PATH:path.join(dir,'envpath').replaceAll('\\','/'),...extra}});
  const calls=existsSync(path.join(dir,'calls'))?readFileSync(path.join(dir,'calls'),'utf8'):'';
  const env=existsSync(path.join(dir,'env'))?JSON.parse(readFileSync(path.join(dir,'env'),'utf8')):{};
  const removed=!existsSync(path.join(dir,'envpath'))||!existsSync(readFileSync(path.join(dir,'envpath'),'utf8').trim());
  return {...r,calls,env,removed};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('new queues fail closed on wrong topic/missing access and read-only checks never mutate',()=>{
 for(const kind of ['sec','article']){
  const valid=run(kind,{},true);assert.equal(valid.status,0,valid.stderr);assert.doesNotMatch(valid.calls,/run deploy|add-iam|subscriptions (update|create)/);
  const failures:Record<string,string>[]=[{MISSING_IAM:'1'},{WRONG_TOPIC:'foreign'},{MISSING_RESOURCE:'1'}];
  for(const extra of failures){const bad=run(kind,extra,true);assert.notEqual(bad.status,0);assert.doesNotMatch(bad.calls,/run deploy|add-iam|subscriptions (update|create)/);}
 }
});
test('private bounded workers use retained authenticated queues and only article worker receives existing AI key',()=>{
 for(const kind of ['sec','article']){
  const r=run(kind);assert.equal(r.status,0,r.stderr);assert.match(r.calls,/--no-allow-unauthenticated/);assert.match(r.calls,/--max-instances 2 --concurrency 1/);assert.match(r.calls,/--timeout 600/);assert.match(r.calls,/--push-auth-service-account directory-sync-scheduler@demo/);
  assert.doesNotMatch(r.calls,/existing-approved-key|add-iam|allUsers|scheduler jobs|run jobs execute/);assert(r.removed);
  if(kind==='article')assert.equal(r.env.OPENAI_API_KEY,'existing-approved-key');else{assert(!r.env.OPENAI_API_KEY);assert.equal(r.env.SEC_DOCUMENT_CACHE_BUCKET,'private-cache');}
 }
});
test('explicit setup stays scoped to new resources and refuses cross-pipeline names',()=>{
 const setup=run('sec',{DISCOVERY_ENRICHMENT_BOOTSTRAP_IAM:'1'});assert.equal(setup.status,0,setup.stderr);assert.match(setup.calls,/topics add-iam-policy-binding sec-company-discovery-requests/);assert.doesNotMatch(setup.calls,/projects add-iam|iam service-accounts|allUsers|scheduler jobs/);
 assert.notEqual(run('sec',{DISCOVERY_ENRICHMENT_BOOTSTRAP_IAM:'1',WRONG_TOPIC:'foreign'},true).status,0);
});
test('publisher wiring deploys consumers first, drains old SEC work naturally and leaves schedules available',()=>{
 const sec=readFileSync('scripts/deploy-sec-filings.sh','utf8'),news=readFileSync('scripts/deploy-intelligence-news.sh','utf8'),drain=readFileSync('scripts/lib/drain-sec-discovery.sh','utf8');
 assert(sec.indexOf('deploy-discovery-enrichment.sh sec')<sec.indexOf('gcloud run jobs deploy'));
 assert(sec.indexOf('drain-sec-discovery.sh')<sec.indexOf('--update-env-vars SEC_DISCOVERY_REQUEST_TOPIC'));
 assert(news.indexOf('deploy-discovery-enrichment.sh article')<news.indexOf('gcloud run jobs deploy'));
 assert.doesNotMatch(drain,/executions (cancel|delete)|jobs (pause|delete)|subscriptions (delete|seek)/);
 assert.match(drain,/completionTime/);assert.match(drain,/process\.env\.GIT_SHA/);
 const workflow=readFileSync('.github/workflows/deploy.yml','utf8');assert.match(workflow,/SEC_DISCOVERY_QUEUE_ENABLED: \$\{\{ vars.SEC_DISCOVERY_QUEUE_ENABLED/);assert.match(workflow,/NEWS_ENRICHMENT_QUEUE_ENABLED: \$\{\{ vars.NEWS_ENRICHMENT_QUEUE_ENABLED/);
});
test('SEC activation waits for older executions but permits new fenced compatibility work without stopping either',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'sec-natural-drain-'));
 try{
  const result=spawnSync('bash',['-c',`
gcloud(){
 [[ "$*" == "run jobs executions list --job collect-sec-filings-production "* ]] || return 2
 if [[ -f "$MARKER" ]]; then echo '[{"status":{},"spec":{"template":{"spec":{"containers":[{"env":[{"name":"GIT_SHA","value":"new-release"}]}]}}}}]';
 else echo '[{"status":{},"spec":{"template":{"spec":{"containers":[{"env":[{"name":"GIT_SHA","value":"old-release"}]}]}}}}]'; fi
}
sleep(){ echo "$*" > "$MARKER"; }
export -f gcloud sleep
bash scripts/lib/drain-sec-discovery.sh
`],{encoding:'utf8',timeout:10000,env:{...process.env,GCP_PROJECT_ID:'demo',GIT_SHA:'new-release',MARKER:path.join(dir,'waited').replaceAll('\\','/')}});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Waiting for 1 older SEC execution/);assert.equal(readFileSync(path.join(dir,'waited'),'utf8').trim(),'15');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('SEC subscriber preserves the independent earnings pipeline disable gate',()=>{
 for(const pipeline of ['0','1'])for(const collection of ['0','1']){
  const r=run('sec',{EARNINGS_PIPELINE_ENABLED:pipeline,EARNINGS_COLLECTION_ENABLED:collection});
  assert.equal(r.status,0,r.stderr);assert.equal(r.env.EARNINGS_COLLECTION_ENABLED,pipeline==='1'?collection:'0');
 }
});
