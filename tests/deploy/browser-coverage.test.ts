import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyBrowserCoverage, verifyApplicationCoverage } from '../../scripts/verify-browser-coverage.mjs';

const tree = 'a'.repeat(40);
const current = { workflow_id: 7, repository: { id: 1 } };
const passed = { ...current, id: 42, event: 'pull_request', status: 'completed', conclusion: 'success', head_repository: { id: 1 } };
const artifact = { name: `browser-verified-${tree}`, expired: false, workflow_run: { id: 42 } };
function fixture(record = artifact, run = passed) {
  return {
    tree, context: { repo: { owner: 'owner', repo: 'repo' }, runId: 99 },
    github: {
      paginate: async () => [record],
      rest: { actions: {
        listArtifactsForRepo: () => {},
        getWorkflowRun: async ({ run_id }: { run_id: number }) => ({ data: run_id === 99 ? current : run }),
      } },
    },
  };
}
test('accepts successful PR coverage for identical content after a squash merge', async () => {
  assert.equal((await verifyBrowserCoverage(fixture())).id, 42);
});
for (const [label, record, run] of [
  ['different source tree', {...artifact, name: `browser-verified-${'b'.repeat(40)}`}, passed],
  ['expired record', {...artifact, expired: true}, passed],
  ['failed PR', artifact, {...passed, conclusion:'failure'}],
  ['unfinished PR', artifact, {...passed, status:'in_progress'}],
  ['push instead of PR', artifact, {...passed, event:'push'}],
  ['different workflow', artifact, {...passed, workflow_id:8}],
  ['different repository', artifact, {...passed, repository:{id:2}}],
  ['fork PR', artifact, {...passed, head_repository:{id:3}}],
] as const) test(`rejects ${label}`, async () => {
  await assert.rejects(verifyBrowserCoverage(fixture(record, run)), /No successful PR/);
});
test('fails closed on missing coverage or API failure', async () => {
  const empty = fixture();
  empty.github.paginate = async () => [];
  await assert.rejects(verifyBrowserCoverage(empty), /No successful PR/);
  empty.github.paginate = async () => { throw new Error('API unavailable'); };
  await assert.rejects(verifyBrowserCoverage(empty), /API unavailable/);
  await assert.rejects(verifyBrowserCoverage({...empty, tree:''}), /Missing release tree/);
});

const checks = ['Verify app', 'Check standalone release packaging', 'Verify company graph repository', 'Verify industry graph projection'];
const verified = { name: 'verify', status: 'completed', conclusion: 'success',
  steps: checks.map(name => ({ name, status: 'completed', conclusion: 'success' })) };
function applicationFixture(jobs = [verified]) {
  const base = fixture();
  const listJobsForWorkflowRun = () => {};
  return { ...base, github: { ...base.github,
    paginate: async (endpoint: unknown) => endpoint === listJobsForWorkflowRun ? jobs : [artifact],
    rest: { actions: { ...base.github.rest.actions, listJobsForWorkflowRun } },
  } };
}
test('application reuse requires explicit successful checks from the covered PR', async () => {
  assert.equal((await verifyApplicationCoverage(applicationFixture())).id, 42);
  for (const jobs of [[], [verified, verified], [{ ...verified, conclusion: 'skipped' }],
    ...checks.map(name => [{ ...verified, steps: verified.steps.filter(step => step.name !== name) }]),
    ...checks.map(name => [{ ...verified, steps: verified.steps.map(step => step.name === name ? { ...step, conclusion: 'skipped' } : step) }])]) {
    await assert.rejects(verifyApplicationCoverage(applicationFixture(jobs)), /application/);
  }
});
