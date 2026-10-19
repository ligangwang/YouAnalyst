import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

export function comparisonIndexState(indexes) {
  return indexes.find(index => index.name.includes('/collectionGroups/posts/') && index.fields.filter(field => field.fieldPath !== '__name__').map(field => `${field.fieldPath}:${field.order}`).join(',') === 'kind:ASCENDING,netLikes:DESCENDING,createdAt:DESCENDING')?.state;
}
export async function waitForComparisonIndex({readIndexes, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 80, log = console.log}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const state = comparisonIndexState(await readIndexes());
    if (state === 'READY') { log('Comparison leaderboard index is READY.'); return; }
    if (state === 'NEEDS_REPAIR') throw Error('Comparison leaderboard index needs repair');
    log(`Waiting for comparison leaderboard index (${state ?? 'not listed yet'})...`);
    if (attempt + 1 < attempts) await sleep(15000);
  }
  throw Error('Comparison leaderboard index did not become ready within 20 minutes');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const project = process.env.FIRESTORE_PROJECT_ID;
  assert(project, 'FIRESTORE_PROJECT_ID is required');
  waitForComparisonIndex({readIndexes: () => JSON.parse(execFileSync('gcloud', ['firestore','indexes','composite','list',`--project=${project}`,'--format=json'], {encoding:'utf8'}))}).catch(error => { console.error(error.message); process.exitCode = 1; });
}
