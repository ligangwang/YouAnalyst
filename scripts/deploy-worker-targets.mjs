import { pathToFileURL } from 'node:url';
import { runTasks } from './lib/deploy-tasks.mjs';

const allowed = new Set(['sec-fundamentals', 'cn-fundamentals', 'eod-maintenance', 'directory', 'instrument-onboarding', 'company-graph', 'earnings', 'intelligence-news', 'sec-filings']);
export function workerTasks(targets) {
  for (const target of targets) if (!allowed.has(target)) throw new Error(`Unknown worker: ${target}`);
  return targets.map(id => ({
    id,
    // Never switch SEC intake until all consumers have finished. Earnings and
    // news both update CN discovery, so those deployments must not overlap.
    needs: id === 'sec-filings' ? targets.filter(target => target !== id)
      : id === 'intelligence-news' && targets.includes('earnings') ? ['earnings'] : [],
    command: 'bash',
    args: [id === 'directory' ? 'scripts/deploy-directory-release.sh' : `scripts/deploy-${id}.sh`],
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Bootstrap mutates shared IAM and stays serial, including operator runs.
  const bootstrap = Object.entries(process.env).some(([key, value]) => key.endsWith('BOOTSTRAP_IAM') && value === '1');
  runTasks(workerTasks(process.argv.slice(2)), bootstrap ? 1 : Number(process.env.DEPLOY_WORKER_CONCURRENCY ?? 3)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
