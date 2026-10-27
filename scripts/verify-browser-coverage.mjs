// Reuse PR checks only for an identical Git tree, including the workflow itself.
// Squash/merge commit IDs differ, but any source change changes the tree hash.
// Fork PRs run their own workflow version, so only same-repository runs count.
export async function verifyBrowserCoverage({ github, context, tree }) {
  if (!/^[a-f0-9]{40}$/.test(tree ?? '')) throw new Error('Missing release tree');
  const repo = context.repo;
  const { data: current } = await github.rest.actions.getWorkflowRun({ ...repo, run_id: context.runId });
  const name = `browser-verified-${tree}`;
  const artifacts = await github.paginate(github.rest.actions.listArtifactsForRepo, { ...repo, name, per_page: 100 });
  for (const artifact of artifacts) {
    if (artifact.name !== name || artifact.expired || !artifact.workflow_run?.id) continue;
    const { data: run } = await github.rest.actions.getWorkflowRun({ ...repo, run_id: artifact.workflow_run.id });
    if (run.event === 'pull_request' && run.status === 'completed' && run.conclusion === 'success'
      && run.workflow_id === current.workflow_id && run.repository.id === current.repository.id
      && run.head_repository?.id === current.repository.id) return run;
  }
  throw new Error('No successful PR browser run covers this exact source tree (records expire after 90 days).');
}

// Application checks are reusable only with explicit successful step evidence.
// A successful workflow alone can include skipped jobs or skipped checks.
export async function verifyApplicationCoverage(options) {
  const run = await verifyBrowserCoverage(options);
  const jobs = await options.github.paginate(options.github.rest.actions.listJobsForWorkflowRun,
    { ...options.context.repo, run_id: run.id, filter: 'latest', per_page: 100 });
  const matches = jobs.filter(job => job.name === 'verify');
  if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') {
    throw new Error('No successful application verification job');
  }
  for (const name of ['Verify app', 'Check standalone release packaging', 'Verify company graph repository', 'Verify industry graph projection']) {
    const steps = (matches[0].steps ?? []).filter(step => step.name === name);
    if (steps.length !== 1 || steps[0].status !== 'completed' || steps[0].conclusion !== 'success') {
      throw new Error(`Missing successful application check: ${name}`);
    }
  }
  return run;
}
