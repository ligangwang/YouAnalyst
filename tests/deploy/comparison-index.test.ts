import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {comparisonIndexState, waitForComparisonIndex} from '../../scripts/firestore/wait-comparison-index.mjs';

const index = (state: string) => ({name:'projects/project/databases/(default)/collectionGroups/posts/indexes/id',state,fields:[{fieldPath:'kind',order:'ASCENDING'},{fieldPath:'netLikes',order:'DESCENDING'},{fieldPath:'createdAt',order:'DESCENDING'},{fieldPath:'__name__',order:'DESCENDING'}]});
test('only the exact posts leaderboard index satisfies readiness', () => {
  assert.equal(comparisonIndexState([index('READY')]), 'READY');
  assert.equal(comparisonIndexState([{...index('READY'), name:'projects/project/databases/(default)/collectionGroups/comments/indexes/id'}]), undefined);
  assert.equal(comparisonIndexState([{...index('READY'), fields:index('READY').fields.slice(1)}]), undefined);
});
test('release waits through creation and fails closed on repair or timeout', async () => {
  let reads = 0, sleeps = 0;
  await waitForComparisonIndex({readIndexes:async()=>[index(++reads < 3 ? 'CREATING':'READY')],sleep:async()=>{sleeps++;},log:()=>{}});
  assert.equal(reads,3);assert.equal(sleeps,2);
  await assert.rejects(waitForComparisonIndex({readIndexes:async()=>[index('NEEDS_REPAIR')],log:()=>{}}), /needs repair/);
  await assert.rejects(waitForComparisonIndex({readIndexes:async()=>[],sleep:async()=>{},attempts:2,log:()=>{}}), /did not become ready/);
  const deploy=readFileSync('scripts/deploy-cloud-run.sh','utf8');
  assert(deploy.indexOf('node scripts/firestore/wait-comparison-index.mjs') < deploy.indexOf('gcloud builds submit'));
});
