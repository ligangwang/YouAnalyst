import { pathToFileURL } from 'node:url';
import { runTasks } from './lib/deploy-tasks.mjs';

export function imageBuildTasks(env, targets) {
  if (!env.GCP_PROJECT_ID || !env.GCP_REGION || !env.GIT_SHA || !targets.length) throw new Error('Worker image build context is required');
  const registry = `${env.GCP_REGION}-docker.pkg.dev/${env.GCP_PROJECT_ID}/ifindata`;
  const tasks = [];
  if (targets.some(target => target !== 'directory')) tasks.push({ id: 'fundamentals-image', command: 'bash',
    args: ['scripts/build-fundamentals.sh', `${registry}/sec-fundamentals:${env.GIT_SHA}`] });
  if (targets.includes('directory')) tasks.push({ id: 'directory-image', command: 'bash',
    args: ['scripts/build-fundamentals.sh', `${registry}/directory-sync:${env.GIT_SHA}`, 'cloudbuild.directory-sync.yaml'] });
  return tasks;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTasks(imageBuildTasks(process.env, process.argv.slice(2)), 2)
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
