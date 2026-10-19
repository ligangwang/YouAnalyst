import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
test('routine rollout cannot recreate checkpoint writers or delete triggers before old jobs drain',()=>{
 const script=readFileSync('scripts/setup-cache-changes.sh','utf8');
 assert.doesNotMatch(script,/gcloud|activate-change-cache/);
 const result=spawnSync(process.execPath,['scripts/activate-change-cache.mjs'],{encoding:'utf8'});
 assert.notEqual(result.status,0);assert.match(result.stderr,/retired/);
});
