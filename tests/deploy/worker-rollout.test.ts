import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runTasks, runCommand } from '../../scripts/lib/deploy-tasks.mjs';
import { workerTasks } from '../../scripts/deploy-worker-targets.mjs';
import { deliveryTasks } from '../../scripts/verify-worker-delivery.mjs';
import { backgroundJobTarget } from '../../scripts/background-job-changes.mjs';

test('orchestration changes trigger the appropriate worker rollout', () => {
  for (const path of ['scripts/deploy-worker-targets.mjs', 'scripts/verify-worker-delivery.mjs', 'scripts/lib/deploy-tasks.mjs']) {
    assert.equal(backgroundJobTarget([path]), 'all');
  }
  assert.equal(backgroundJobTarget(['scripts/deploy-directory-release.sh']), 'directory');
});

test('workers overlap within the limit while shared services and intake stay ordered', async () => {
  const targets = ['sec-fundamentals', 'cn-fundamentals', 'eod-maintenance', 'directory', 'instrument-onboarding', 'company-graph', 'earnings', 'intelligence-news', 'sec-filings'];
  const active = new Set<string>(), done = new Set<string>();
  let peak = 0;
  await runTasks(workerTasks(targets), 3, async task => {
    if (task.id === 'intelligence-news') assert(done.has('earnings'));
    if (task.id === 'sec-filings') assert.equal(done.size, targets.length - 1);
    active.add(task.id); peak = Math.max(peak, active.size);
    await delay(5);
    active.delete(task.id); done.add(task.id);
  });
  assert.equal(peak, 3);
  assert.equal(done.size, targets.length);
});

test('a failed worker blocks pending work and drains active operations before rejecting', async () => {
  const started: string[] = [];
  let drained = false;
  await assert.rejects(runTasks(workerTasks(['sec-fundamentals', 'earnings', 'intelligence-news', 'sec-filings']), 2, async task => {
    started.push(task.id);
    if (task.id === 'sec-fundamentals') throw new Error('rollout failed');
    await delay(10); drained = true;
  }), /rollout failed/);
  assert(drained);
  assert.deepEqual(started, ['sec-fundamentals', 'earnings']);
});

test('serial fallback and narrow targets still complete', async () => {
  let active = 0;
  await runTasks(workerTasks(['earnings', 'intelligence-news']), 1, async () => {
    assert.equal(++active, 1); await delay(1); active--;
  });
  assert.deepEqual(workerTasks(['sec-filings'])[0].needs, []);
  assert.throws(() => workerTasks(['unknown']), /Unknown worker/);
  await assert.rejects(runTasks(workerTasks(['earnings']), 0), /concurrency/);
  await assert.rejects(runTasks(workerTasks(['earnings', 'earnings'])), /Duplicate/);
});

test('delivery selection preserves rollout flags and provider-free verification arguments', () => {
  const env = { TARGET_JOB: 'all', GCP_PROJECT_ID: 'test', GCP_REGION: 'us-central1', ENABLE_SEC_FILING_PIPELINE: '1', EARNINGS_PIPELINE_ENABLED: '1' };
  const tasks = deliveryTasks(env);
  assert.equal(tasks.length, 4);
  for (const task of tasks) {
    assert(task.args.includes('--wait'));
    assert(task.args.some(arg => arg.includes('VERIFY_ONLY=1') || arg.includes('--verify-delivery')));
  }
  assert.equal(deliveryTasks({ ...env, TARGET_JOB: 'directory' }).length, 0);
  assert.deepEqual(deliveryTasks({ ...env, ENABLE_SEC_FILING_PIPELINE: '0', EARNINGS_PIPELINE_ENABLED: '0' }).map(t => t.id), ['verify-sec', 'verify-onboarding']);
  assert.deepEqual(deliveryTasks({ ...env, TARGET_JOB: 'sec-filings' }).map(t => t.id), ['verify-graph']);
});

test('command execution propagates nonzero exits and spawn errors', async () => {
  await runCommand({ id: 'ok', command: process.execPath, args: ['-e', 'process.exit(0)'] });
  await assert.rejects(runCommand({ id: 'failed', command: process.execPath, args: ['-e', 'process.exit(7)'] }), /failed.*7/);
  await assert.rejects(runCommand({ id: 'missing', command: 'nonexistent-deploy-test-command', args: [] }));
});
