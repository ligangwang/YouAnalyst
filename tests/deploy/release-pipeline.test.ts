import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const workflow = require('js-yaml').load(readFileSync('.github/workflows/deploy.yml', 'utf8'));

test('both environments schedule identical US maintenance twice in New York time', () => {
  for (const target of ['staging', 'production']) {
    const step = workflow.jobs[`deploy-${target}`].steps.find((s: {name?:string}) => s.name === `Upsert ${target} EOD scheduler`);
    assert.match(step.run, /--schedule "30 16 \* \* 1-5"/);
    assert.match(step.run, /--schedule "0 20 \* \* 1-5"/);
    assert.match(step.run, /scheduledBatch: "1630"/);
    assert.match(step.run, /scheduledBatch: "2000"/);
    assert(!step.run.includes('markPredictions: false'));
    assert.equal((step.run.match(/--time-zone "America\/New_York"/g) || []).length, 6);
  }
});

test('all browser shards and authentication must pass the stable release gate', () => {
  const shard = workflow.jobs['browser-shard'];
  assert.equal(shard.if, "github.event_name != 'pull_request' || github.event.pull_request.draft == false");
  assert.deepEqual(shard.strategy.matrix.shard, [1, 2, 3, 4]);
  assert.equal(shard.strategy['fail-fast'], false);
  assert(shard.steps.some((s: { run?: string }) => s.run?.includes('node scripts/conversion-shards.mjs ${{ matrix.shard }}/4')));
  const auth = shard.steps.find((s: { run?: string }) => s.run === 'npm run test:auth');
  assert.equal(auth.if, 'matrix.shard == 1');
  const gate = workflow.jobs['verify-browser'];
  assert.deepEqual(gate.needs, ['browser-shard']);
  assert.match(gate.if, /^always\(\)/);
  assert.equal(gate.steps[0].env.SHARD_RESULT, '${{ needs.browser-shard.result }}');
  assert.equal(gate.steps[0].run, 'test "$SHARD_RESULT" = success');
  assert.equal(gate.steps[0].if, undefined);
  const proof = gate.steps.find((s: { uses?: string }) => s.uses === 'actions/upload-artifact@v4');
  assert.equal(proof.if, "github.event_name == 'pull_request'");
  assert.equal(proof.with.name, 'browser-verified-${{ steps.tree.outputs.sha }}');
  // Releases run the actual shards on their checkout; stale PR artifacts must
  // never substitute for successful release browser tests.
  assert(!gate.steps.some((s: { uses?: string }) => s.uses === 'actions/github-script@v7'));
  assert(shard.steps.some((s: { uses?: string; with?: { ref?: string } }) =>
    s.uses === 'actions/checkout@v4' && s.with?.ref === undefined));
});

test('parallel release preparation cannot deploy and both environments require the checked artifact', () => {
  const build = workflow.jobs['build-release'];
  assert.equal(build.needs, undefined);
  assert.equal(build.if, "github.event_name == 'push' || github.event_name == 'workflow_dispatch'");
  assert.equal(build.env.GIT_SHA, '${{ github.sha }}');
  assert.equal(build.environment.deployment, false);
  assert.equal(build.env.APP_ENVIRONMENT, build.environment.name);
  assert.equal(build.env.NEXT_PUBLIC_APP_ENVIRONMENT, build.environment.name);
  assert(build.steps.some((s: { run?: string }) => s.run?.includes('node scripts/prepare-release.mjs')));
  assert(!build.steps.some((s: { uses?: string; run?: string }) => /google-github-actions|gcloud|deploy:/.test(`${s.uses} ${s.run}`)));
  assert.equal(build.outputs['artifact-id'], '${{ steps.release.outputs.artifact-id }}');
  for (const target of ['staging', 'production']) {
    const deploy = workflow.jobs[`deploy-${target}`];
    assert.deepEqual(deploy.needs, ['verify', 'verify-browser', 'build-release']);
    // GitHub propagates skipped ancestors unless the condition includes a
    // status function. Keep explicit success checks for every real gate.
    assert.match(deploy.if, /!cancelled\(\)/);
    for (const gate of deploy.needs) assert(deploy.if.includes(`needs.${gate}.result == 'success'`));
    assert(!deploy.steps.some((s: { run?: string }) => s.run?.includes('npm run build')));
    const download = deploy.steps.find((s: { uses?: string }) => s.uses === 'actions/download-artifact@v4');
    assert.equal(download.with['artifact-ids'], '${{ needs.build-release.outputs.artifact-id }}');
    const release = deploy.steps.find((s: { run?: string }) => s.run === `npm run deploy:${target}`);
    assert.equal(release.env.PREBUILT_RELEASE, '1');
    assert.equal(release.env.VERIFIED_COMMIT, '${{ github.sha }}');
    assert(deploy.steps.some((s: { run?: string }) => s.run === 'npm run smoke:test'));
  }
});


test('browser downloads are reused without skipping fresh-runner OS setup or release tests',()=>{
 for(const name of ['browser-shard','deploy-staging','deploy-production']){
  const steps=workflow.jobs[name].steps;
  const cache=steps.find((s:{name?:string})=>s.name==='Cache Playwright browser download');
  assert.equal(cache.with.path,'~/.cache/ms-playwright');
  assert(cache.with.key.includes("hashFiles('package-lock.json')"));
  const install=steps.find((s:{run?:string})=>s.run==='bash scripts/setup-playwright-browser.sh');
  assert(install);assert.equal(install.if,undefined);
  assert(steps.indexOf(cache)<steps.indexOf(install));
 }
 const setup=readFileSync('scripts/setup-playwright-browser.sh','utf8');
 assert(setup.includes('https://archive.ubuntu.com/ubuntu'));
 assert(setup.includes('Acquire::http::Timeout "15"'));
 assert(setup.includes('Acquire::https::Timeout "15"'));
 assert(setup.includes('Acquire::Retries "2"'));
 assert(setup.includes('npx playwright install --with-deps --only-shell chromium'));
 assert(setup.includes('timeout --kill-after=15s 180s'));
 assert(setup.includes('await chromium.launch()'));
});
