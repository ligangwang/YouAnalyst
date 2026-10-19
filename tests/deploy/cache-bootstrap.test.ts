import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

function run(extra: Record<string,string> = {}) {
  const script = readFileSync('scripts/setup-cache-changes.sh','utf8').replaceAll('\r\n','\n');
  return spawnSync(process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash',['-c',`
    gcloud() {
      echo "GCLOUD $*" >&2
      case "$*" in
        "iam service-accounts describe"*) [[ "\${MISSING_IDENTITY:-0}" != 1 ]] ;;
        "run services describe"*) echo https://web.run.app ;;
        "firestore databases describe"*) echo us-east4 ;;
        "eventarc triggers describe"*"--format=json"*) return 0 ;;
        "eventarc triggers describe"*) [[ "\${MISSING_TRIGGER:-0}" != 1 ]] ;;
      esac
    }
    node() { cat >/dev/null; echo "NODE $*" >&2; }
    ${script}
  `],{encoding:'utf8',input:'',timeout:10000,env:{...process.env,GCP_PROJECT_ID:'demo',CACHE_WEB_SERVICE:'web',...extra}});
}
test('routine rollout verifies all triggers without IAM or resource provisioning',()=>{
  const result=run(); assert.ifError(result.error); assert.equal(result.status,0,result.stderr);
  assert.doesNotMatch(result.stderr,/GCLOUD .*add-iam-policy-binding|GCLOUD services enable|GCLOUD .* create /);
  assert.match(result.stderr,/CACHE_EVENT_AUDIENCE=https:\/\/web.run.app\/api\/internal\/cache-changes/);
  assert.equal(result.stderr.match(/NODE scripts\/verify-cache-trigger.mjs/g)?.length,9);
  assert.match(result.stderr,/NODE scripts\/activate-change-cache.mjs\n/);
});
test('missing trigger blocks activation and requests administrator bootstrap',()=>{
  const result=run({MISSING_TRIGGER:'1'}); assert.notEqual(result.status,0);
  assert.match(result.stderr,/run setup with CACHE_BOOTSTRAP=1/);
  assert.doesNotMatch(result.stderr,/GCLOUD eventarc triggers create|NODE scripts\/activate-change-cache.mjs\n/);
});
test('explicit administrator bootstrap provisions permissions and missing triggers',()=>{
  const result=run({CACHE_BOOTSTRAP:'1',MISSING_TRIGGER:'1'}); assert.equal(result.status,0,result.stderr);
  assert.match(result.stderr,/GCLOUD projects add-iam-policy-binding/);
  assert.equal(result.stderr.match(/GCLOUD eventarc triggers create/g)?.length,9);
});


test('missing delivery identity reports bootstrap guidance and blocks activation',()=>{
  const result=run({MISSING_IDENTITY:'1'}); assert.notEqual(result.status,0);
  assert.match(result.stderr,/Cache identity unavailable; run setup with CACHE_BOOTSTRAP=1/);
  assert.doesNotMatch(result.stderr,/GCLOUD .* create |NODE scripts\/activate-change-cache.mjs\n/);
});
