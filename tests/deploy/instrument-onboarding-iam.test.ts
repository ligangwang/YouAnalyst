import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';

function setup(permissions:string[]|null){
  return spawnSync('bash',['-c',`
gcloud(){
  echo "$*" >&2
  if [[ "$1 $2 $3" == 'iam roles describe' ]]; then
    if [[ "$ROLE_JSON" == null ]]; then return 1; fi
    printf '%s' "$ROLE_JSON"
  fi
}
export -f gcloud
bash scripts/setup-instrument-onboarding.sh
`],{encoding:'utf8',timeout:10000,env:{...process.env,GCP_PROJECT_ID:'demo',ROLE_JSON:permissions===null?'null':JSON.stringify({includedPermissions:permissions})}});
}

test('operator bootstrap grants only trigger create/update and delivery receiver, with no project IAM admin',()=>{
  const r=setup(null);assert.equal(r.status,0,r.stderr);
  assert.match(r.stderr,/--permissions eventarc.triggers.create,eventarc.triggers.update/);
  assert.match(r.stderr,/serviceAccount:github-deploy-production-sa@demo.*--role projects\/demo\/roles\/instrumentOnboardingEventarcDeploy/);
  assert.match(r.stderr,/serviceAccount:directory-sync-scheduler@demo.*--role roles\/eventarc.eventReceiver/);
  assert.doesNotMatch(r.stderr,/roles\/(owner|editor|resourcemanager.projectIamAdmin)|triggers.delete/);
  assert.equal(r.stderr.match(/--condition=None/g)?.length,2,'Preserve conditional project policy and bind only these exact unconditioned roles');
});

test('bootstrap reuses an exact role but refuses an unexpectedly broader existing role before grants',()=>{
  const good=setup(['eventarc.triggers.update','eventarc.triggers.create']);assert.equal(good.status,0,good.stderr);assert.doesNotMatch(good.stderr,/iam roles create/);
  const broad=setup(['eventarc.triggers.create','eventarc.triggers.update','eventarc.triggers.delete']);assert.notEqual(broad.status,0);assert.doesNotMatch(broad.stderr,/projects add-iam-policy-binding/);
});
