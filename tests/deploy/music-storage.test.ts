import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function provision(mode: 'missing' | 'existing' | 'denied') {
  const log = path.join(mkdtempSync(path.join(tmpdir(), 'music-storage-test-')), 'calls.log').replaceAll('\\', '/');
  const result = spawnSync(process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash', ['-c', `
    gcloud() {
      echo "$*" >> "$MUSIC_TEST_LOG"
      case "$*" in
        "storage buckets describe"*)
          if [[ "$MUSIC_TEST_MODE" == missing ]]; then echo '404 not found' >&2; return 1; fi
          if [[ "$MUSIC_TEST_MODE" == denied ]]; then echo '403 access denied' >&2; return 1; fi ;;
        "run services describe"*) echo web@demo.iam.gserviceaccount.com ;;
      esac
    }
    export -f gcloud
    bash scripts/ensure-music-storage.sh
  `], { encoding:'utf8',env:{...process.env,GOOGLE_CLOUD_PROJECT:'demo',GOOGLE_CLOUD_REGION:'us-central1',MUSIC_STORAGE_BUCKET:'demo-site-media-production',MUSIC_WEB_SERVICE:'web',WEB_RUNTIME_SERVICE_ACCOUNT:'',MUSIC_TEST_LOG:log,MUSIC_TEST_MODE:mode} });
  return { ...result, calls:readFileSync(log,'utf8') };
}

test('music storage creates a private bucket and grants only the web runtime object access',()=>{
  const result=provision('missing');
  assert.equal(result.status,0,result.stderr);
  assert.match(result.calls,/buckets create gs:\/\/demo-site-media-production.*--uniform-bucket-level-access --public-access-prevention/);
  assert.match(result.calls,/--member=serviceAccount:web@demo.iam.gserviceaccount.com --role=roles\/storage.objectUser/);
  assert.doesNotMatch(result.calls,/allUsers|allAuthenticatedUsers|make-public/);
});
test('music storage reuses an existing bucket and fails closed on permission errors',()=>{
  const existing=provision('existing');
  assert.equal(existing.status,0,existing.stderr);assert.doesNotMatch(existing.calls,/buckets create/);
  const denied=provision('denied');
  assert.notEqual(denied.status,0);assert.doesNotMatch(denied.calls,/buckets create|add-iam-policy-binding/);
});
