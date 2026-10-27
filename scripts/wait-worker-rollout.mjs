import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export async function waitForWorkerRollout({ env = process.env, request = fetch, sleep = ms => delay(ms),
  now = Date.now, timeout = 65 * 60 * 1000, log = console.log } = {}) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Worker gate requires GitHub Actions');
  assert.equal(env.GITHUB_REF, 'refs/heads/main', 'Worker gate requires main');
  assert(/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? ''), 'Invalid repository');
  assert(/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? ''), 'Invalid run ID');
  assert(/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? ''), 'Invalid attempt');
  assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? ''), 'Invalid commit');
  assert(env.GH_TOKEN, 'Read-only Actions token required');
  assert(['none', 'all', 'fundamentals', 'directory', 'sec-fundamentals', 'cn-fundamentals',
    'eod-maintenance', 'company-graph', 'sec-filings', 'earnings', 'intelligence-news'].includes(env.EXPECTED_WORKER_TARGET), 'Missing worker selection');
  const base = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`;
  async function read(url) {
    const response = await request(url, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30000) });
    assert(response.ok, `Cannot verify worker release (HTTP ${response.status})`);
    return response.json();
  }
  const run = await read(base);
  assert.equal(run.head_sha, env.GITHUB_SHA, 'Run commit mismatch');
  assert.equal(run.head_branch, 'main', 'Run branch mismatch');
  assert.equal(run.run_attempt, Number(env.GITHUB_RUN_ATTEMPT), 'Run attempt mismatch');
  assert.equal(run.path?.split('@')[0], '.github/workflows/deploy.yml', 'Unexpected release workflow');
  const deadline = now() + timeout;
  let previous;
  while (now() < deadline) {
    const page = await read(`${base}/jobs?per_page=100`);
    assert(Array.isArray(page.jobs) && page.total_count <= 100, 'Incomplete worker job listing');
    const workers = page.jobs.filter(job => job.name === 'deploy-background-jobs');
    assert(workers.length <= 1, 'Ambiguous worker job');
    const worker = workers[0];
    if (worker?.status === 'completed') {
      const expected = env.EXPECTED_WORKER_TARGET === 'none' ? 'skipped' : 'success';
      assert.equal(worker.conclusion, expected, `Worker release must be ${expected} before promotion`);
      log(`Worker gate passed for run ${env.GITHUB_RUN_ID}, attempt ${env.GITHUB_RUN_ATTEMPT}, commit ${env.GITHUB_SHA}.`);
      return;
    }
    const status = worker?.status ?? 'not yet scheduled';
    if (status !== previous) { log(`Candidate ready; waiting for workers: ${status}`); previous = status; }
    await sleep(15000);
  }
  throw new Error('Worker rollout timed out; candidate traffic was not promoted');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  waitForWorkerRollout().catch(error => { console.error(error.message); process.exitCode = 1; });
}
