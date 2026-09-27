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
        case "$*" in
          "run services describe"*) echo "$WEB_SA" ;;
          "run jobs describe"*) echo directory-sync-runtime@demo.iam.gserviceaccount.com ;;
          "builds submit"*) echo build-id ;;
          "builds describe"*) echo SUCCESS ;;
          "artifacts docker images describe"*) echo example/image@sha256:abcdef ;;
        esac
      }
      export -f gcloud
      bash scripts/deploy-background-jobs.sh "$TARGET"
    `],{encoding:'utf8',timeout:10000,env:{...process.env,CALLS:path.join(dir,'calls').replaceAll('\\','/'),TARGET:target,GCP_PROJECT_ID:'demo',GIT_SHA:'commit',SEC_USER_AGENT:'test contact',WEB_RUNTIME_SERVICE_ACCOUNT:'',WEB_SA:'web@demo.iam.gserviceaccount.com',CLOUD_RUN_SERVICE_PRODUCTION:'web',...extra}});
    assert.ifError(result.error);
    let calls='';try{calls=readFileSync(path.join(dir,'calls'),'utf8');}catch{}
    return {...result,calls};
  }finally{rmSync(dir,{recursive:true,force:true});}
}
test('all workers build one shared image and one directory image without executing jobs',()=>{
  const r=run('all');assert.equal(r.status,0,r.stderr);
  assert.equal(r.calls.match(/builds submit/g)?.length,2);
  assert.equal(r.calls.match(/run jobs deploy/g)?.length,3);
  assert.equal(r.calls.match(/run jobs update/g)?.length,1);
  assert.doesNotMatch(r.calls,/run jobs execute/);assert.match(r.calls,/--image example\/image@sha256:abcdef/);
});
test('directory-only deploy avoids shared build and schedule changes',()=>{
  const r=run('directory');assert.equal(r.status,0,r.stderr);
  assert.equal(r.calls.match(/builds submit/g)?.length,1);
  assert.match(r.calls,/cloudbuild.directory-sync.yaml/);assert.doesNotMatch(r.calls,/scheduler jobs/);
});
test('financial changes build once for all three workers and skip directory',()=>{
  const r=run('fundamentals');assert.equal(r.status,0,r.stderr);
  assert.equal(r.calls.match(/builds submit/g)?.length,1);
  assert.equal(r.calls.match(/run jobs deploy/g)?.length,3);
  assert.doesNotMatch(r.calls,/run jobs update|cloudbuild.directory-sync.yaml/);
});
test('invalid selection or missing IAM/SEC configuration fails before mutations',()=>{
  for(const [target,extra] of [['bad',{}],['all',{SEC_USER_AGENT:''}],['directory',{WEB_SA:''}]] as [string,Record<string,string>][]) {
    const r=run(target,extra);assert.notEqual(r.status,0);
    assert.doesNotMatch(r.calls,/builds submit|run jobs (deploy|update|add-iam)/);
  }
});
