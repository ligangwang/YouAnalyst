import {test} from 'node:test';
import assert from 'node:assert/strict';
import {snapshotSyncOptions} from '../../src/lib/entity-snapshots/cli';

test('snapshot recovery explicitly suppresses instrument dispatch and rejects misspelled flags',()=>{
  assert.equal(snapshotSyncOptions([]).dispatchInstruments,true);
  assert.equal(snapshotSyncOptions(['--snapshots-only']).dispatchInstruments,false);
  assert.throws(()=>snapshotSyncOptions(['--snapshot-only']),/Usage/);
  assert.throws(()=>snapshotSyncOptions(['--snapshots-only','--apply']),/Usage/);
});
