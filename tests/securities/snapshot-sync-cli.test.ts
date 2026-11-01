import {test} from 'node:test';
import assert from 'node:assert/strict';
import {snapshotSyncOptions} from '../../src/lib/entity-snapshots/cli';

test('snapshot recovery explicitly suppresses instrument dispatch and rejects misspelled flags',()=>{
  assert.equal(snapshotSyncOptions([]).dispatchInstruments,true);
  assert.equal(snapshotSyncOptions(['--snapshots-only']).dispatchInstruments,false);
  assert.throws(()=>snapshotSyncOptions(['--snapshot-only']),/Usage/);
  assert.throws(()=>snapshotSyncOptions(['--snapshots-only','--apply']),/Usage/);
});

test('dedicated prices leave entity maintenance and dispatch enabled',()=>{
 assert.equal(snapshotSyncOptions(['--entities-only']).includePrices,false);
 assert.equal(snapshotSyncOptions(['--entities-only']).dispatchInstruments,true);
 assert.equal(snapshotSyncOptions([]).includePrices,true);
});


import {readFileSync} from 'node:fs';
import {imageBuildTasks} from '../../scripts/build-worker-images.mjs';
import {backgroundJobTarget} from '../../scripts/background-job-changes.mjs';
test('price-only code changes select workers and opted-in releases build a dedicated image',()=>{
 assert.equal(backgroundJobTarget(['scripts/sync-price-snapshots.ts']),'fundamentals');
 const tasks=imageBuildTasks({GCP_PROJECT_ID:'test',GCP_REGION:'us-central1',GIT_SHA:'test',PRICE_TIMESTAMP_MIGRATION_COMPLETE:'1'},['sec-fundamentals']);
 assert(tasks.some((task:{id:string})=>task.id==='price-sync-image'));
 const release=readFileSync('scripts/deploy-background-jobs.sh','utf8');
 assert(release.indexOf('bash scripts/deploy-price-snapshots.sh')<release.indexOf('bash scripts/deploy-entity-snapshots.sh'));
});
