import { pathToFileURL } from 'node:url';
import { runTasks } from './lib/deploy-tasks.mjs';

export function deliveryTasks(env) {
  const target = env.TARGET_JOB;
  const tasks = [];
  const add = (id, job, args) => tasks.push({ id, command: 'gcloud', args: [
    'run', 'jobs', 'execute', job, '--project', env.GCP_PROJECT_ID,
    '--region', env.GCP_REGION, ...args, '--wait', '--quiet',
  ] });
  if (['all', 'fundamentals', 'sec-fundamentals'].includes(target)) {
    add('verify-sec', 'refresh-sec-fundamentals-production', ['--update-env-vars', 'FUNDAMENTALS_VERIFY_ONLY=1']);
  }
  if (['all', 'fundamentals'].includes(target)) {
    add('verify-onboarding', 'onboard-instruments-production', ['--args', 'dist/onboard-instruments.cjs,--verify-delivery']);
  }
  if (env.ENABLE_SEC_FILING_PIPELINE === '1' && ['all', 'fundamentals', 'company-graph', 'sec-filings'].includes(target)) {
    add('verify-graph', 'refresh-company-graph-production', ['--args', 'dist/refresh-company-graph.cjs,--verify-delivery', '--update-env-vars', 'COMPANY_GRAPH_VERIFY_ONLY=1']);
  }
  if (env.EARNINGS_PIPELINE_ENABLED === '1' && ['all', 'fundamentals', 'earnings'].includes(target)) {
    add('verify-earnings', 'collect-earnings-production', ['--args', 'dist/collect-earnings.cjs,--verify-delivery']);
  }
  return tasks;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.GCP_PROJECT_ID || !process.env.GCP_REGION || !process.env.TARGET_JOB) throw new Error('Project, region, and worker target are required');
  runTasks(deliveryTasks(process.env), 4).catch(error => { console.error(error.message); process.exitCode = 1; });
}
