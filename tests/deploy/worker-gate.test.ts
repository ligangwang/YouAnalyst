import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { waitForWorkerRollout } from '../../scripts/wait-worker-rollout.mjs';

const env = { GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'owner/repo',
  GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: 'a'.repeat(40), GH_TOKEN: 'test-token', EXPECTED_WORKER_TARGET: 'all' };
const run = { head_sha: env.GITHUB_SHA, head_branch: 'main', run_attempt: 2, path: '.github/workflows/deploy.yml' };
const job = (conclusion: string | null, status = 'completed') => ({ name: 'deploy-background-jobs', status, conclusion });
function fixture(pages: unknown[], overrides = {}) {
  let calls = 0, clock = 0;
  const urls: string[] = [];
  return { urls, options: { env, ...overrides, timeout: 30000, now: () => clock,
    sleep: async (ms: number) => { clock += ms; }, log: () => {},
    request: (async (url: unknown) => {
      urls.push(String(url));
      const body = calls++ === 0 ? run : pages.shift();
      return { ok: true, status: 200, json: async () => body };
    }) as typeof fetch } };
}

test('promotion waits for the exact attempt and a successful worker release', async () => {
  const f = fixture([{ total_count: 1, jobs: [job(null, 'in_progress')] }, { total_count: 1, jobs: [job('success')] }]);
  await waitForWorkerRollout(f.options);
  assert.equal(f.urls.length, 3);
  assert(f.urls.every(url => url.includes('/runs/123/attempts/2')));
});

test('failure, cancellation, unexpected skips, and ambiguous evidence block promotion', async () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral']) {
    await assert.rejects(waitForWorkerRollout(fixture([{ total_count: 1, jobs: [job(conclusion)] }]).options), /Worker release/);
  }
  await assert.rejects(waitForWorkerRollout(fixture([{ total_count: 2, jobs: [job('success'), job('success')] }]).options), /Ambiguous/);
  await assert.rejects(waitForWorkerRollout(fixture([{ total_count: 101, jobs: [job('success')] }]).options), /Incomplete/);
});

test('only an explicit no-worker selection permits a skipped worker job', async () => {
  const f = fixture([{ total_count: 1, jobs: [job('skipped')] }], { env: { ...env, EXPECTED_WORKER_TARGET: 'none' } });
  await waitForWorkerRollout(f.options);
  await assert.rejects(waitForWorkerRollout(fixture([], { env: { ...env, EXPECTED_WORKER_TARGET: '' } }).options), /worker selection/);
});

test('wrong commit, attempt, branch, workflow, or unreadable evidence fail closed', async () => {
  for (const wrong of [{ head_sha: 'b'.repeat(40) }, { run_attempt: 1 }, { head_branch: 'dev' }, { path: 'other.yml' }]) {
    const f = fixture([]);
    f.options.request = (async () => ({ ok: true, status: 200, json: async () => ({ ...run, ...wrong }) })) as typeof fetch;
    await assert.rejects(waitForWorkerRollout(f.options));
  }
  const f = fixture([]);
  f.options.request = (async () => ({ ok: false, status: 403 })) as typeof fetch;
  await assert.rejects(waitForWorkerRollout(f.options), /HTTP 403/);
});

test('missing worker evidence times out without permitting promotion', async () => {
  const f = fixture([{ total_count: 0, jobs: [] }, { total_count: 0, jobs: [] }]);
  await assert.rejects(waitForWorkerRollout(f.options), /timed out/);
});

test('candidate validation and worker gate both precede traffic promotion', () => {
  const script = readFileSync('scripts/deploy-cloud-run.sh', 'utf8');
  const candidate = script.indexOf('node scripts/verify-release-candidate.mjs');
  const gate = script.indexOf('node scripts/wait-worker-rollout.mjs');
  const promote = script.indexOf('node scripts/promote-release.mjs');
  assert(candidate >= 0 && candidate < gate && gate < promote);
});
