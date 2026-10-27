import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

function run(mode:string){
  return spawnSync('bash',['-c',`
    gcloud() {
      case "$*" in
        "run revisions describe"*)
          node -e 'const image=process.env.MODE==="wrong-image"?"image@sha256:wrong":"image@sha256:expected"; console.log(JSON.stringify({metadata:{name:"worker-r123"},spec:{serviceAccountName:"runtime@demo",containerConcurrency:1,containers:[{image,env:[{name:"GIT_SHA",value:"commit"}]}]},status:{conditions:[{type:"Ready",status:"True"}]}}))' ;;
        "run services describe"*)
          node -e 'const revisionName=process.env.MODE==="wrong-route"?"older":"worker-r123"; console.log(JSON.stringify({status:{conditions:[{type:"Ready",status:"True"}],traffic:[{revisionName,percent:100}]}}))' ;;
      esac
    }
    sleep() { :; }
    export -f gcloud sleep
    bash scripts/lib/await-sec-download-revision.sh worker worker-r123 image@sha256:expected commit runtime@demo
  `],{encoding:'utf8',timeout:60000,env:{...process.env,GCP_PROJECT_ID:'demo',MODE:mode}});
}
test('import timeout recovery requires the exact ready image and revision on traffic',()=>{
  assert.equal(run('ready').status,0);
  assert.notEqual(run('wrong-image').status,0);
  assert.notEqual(run('wrong-route').status,0);
});
