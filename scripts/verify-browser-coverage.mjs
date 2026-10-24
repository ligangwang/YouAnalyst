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
