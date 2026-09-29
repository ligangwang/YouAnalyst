import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Both images bundle shared library code. Treat shared dependencies conservatively.
// These presentation modules are checked against every worker bundle in tests.
export const chartOnlyLibraries = new Set([
  'vertical-tree', 'vertical-tree-geometry', 'tree-tour', 'tour-motion',
  'label-fade', 'intro-orbit', 'industry-tree', 'hierarchy-tour',
].map(name => `src/lib/knowledge-graph/${name}.ts`));
export function backgroundJobTarget(paths) {
  let financial = false, directory = false;
  for (const path of paths) {
    if (chartOnlyLibraries.has(path)) continue;
    if (['scripts/serve-sec-fundamentals.ts', 'scripts/deploy-sec-pubsub.sh'].includes(path)) { financial = true; continue; }
    if (/^(src\/lib\/|scripts\/lib\/)/.test(path) || /^(package(-lock)?\.json|tsconfig\.json|\.gcloudignore|\.dockerignore)$/.test(path)
      || ['.github/workflows/deploy.yml','scripts/deploy-background-jobs.sh','scripts/build-fundamentals.sh','scripts/background-job-changes.mjs'].includes(path)) {
      financial = directory = true;
    } else if (/^(Dockerfile\.fundamentals|cloudbuild\.fundamentals\.yaml|scripts\/(refresh-(sec-fundamentals|cn-fundamentals|private-valuations)\.ts|deploy-(sec-fundamentals|cn-fundamentals|private-valuations)\.sh|fetch-cn-annual\.py|akshare-requirements\.txt))$/.test(path)) {
      financial = true;
    } else if (/^(Dockerfile\.directory-sync|cloudbuild\.directory-sync\.yaml|scripts\/(sync-cni-directory\.ts|download-cni-directory\.py|deploy-directory-sync\.sh))$/.test(path)) {
      directory = true;
    }
  }
  return financial && directory ? 'all' : financial ? 'fundamentals' : directory ? 'directory' : 'none';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let target = 'all'; // Manual release or unavailable baseline: deploy all workers.
  const base = process.env.BASE_SHA;
  if (base && /^[a-f0-9]{40}$/.test(base)) {
    try {
      const paths = execFileSync('git',['diff','--name-only','-z',base,'HEAD'],{encoding:'utf8'}).split('\0').filter(Boolean);
      target = backgroundJobTarget(paths);
    } catch { console.warn('Worker baseline unavailable; deploying all workers.'); }
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `workers=${target}\n`);
}
