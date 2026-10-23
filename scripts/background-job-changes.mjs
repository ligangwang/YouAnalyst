import {execFileSync} from 'node:child_process';
import {appendFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Both images bundle shared library code. Treat shared dependencies conservatively.
// Website presentation modules live behind a boundary checked against every
// maintenance/worker entry point from both Dockerfiles. Shared data libraries
// outside this directory still conservatively rebuild workers.
export const UI_LIBRARY_ROOT = 'src/lib/ui/';
// Old locations are excluded only after removal. Reintroducing a module at a
// shared path makes it subject to the normal worker-dependency rules again.
const retiredUiPaths = new Set([
  'src/lib/company-timeline.ts',
  'src/lib/compare-video.ts',
  ...['vertical-tree','vertical-tree-geometry','tree-tour','tour-motion','label-fade','intro-orbit','industry-tree','hierarchy-tour'].map(name=>`src/lib/knowledge-graph/${name}.ts`),
]);
export function backgroundJobTarget(paths) {
  let financial = false, directory = false;
  for (const path of paths) {
    if (['scripts/serve-sec-downloads.ts','scripts/cleanup-sec-downloads.ts','scripts/deploy-sec-downloads.sh'].includes(path)) {financial=true;continue;}
    if (path.startsWith(UI_LIBRARY_ROOT)) continue;
    if (retiredUiPaths.has(path) && !existsSync(path)) continue;
    if (['scripts/sync-entity-snapshots.ts', 'scripts/deploy-entity-snapshots.sh', 'scripts/collect-intelligence-news.ts', 'scripts/serve-intelligence-news.ts', 'scripts/serve-cn-discovery.ts', 'scripts/deploy-cn-discovery.sh', 'scripts/deploy-news-pubsub.sh', 'scripts/deploy-intelligence-news.sh', 'scripts/collect-earnings.ts', 'scripts/serve-earnings.ts', 'scripts/deploy-earnings.sh'].includes(path)) { financial = true; continue; }
    if (['scripts/serve-cni-directory.ts','scripts/deploy-directory-pubsub.sh'].includes(path)) { directory = true; continue; }
    if (['scripts/serve-eod-maintenance.ts', 'scripts/deploy-eod-maintenance.sh', 'scripts/serve-sec-fundamentals.ts', 'scripts/deploy-sec-pubsub.sh', 'scripts/serve-cn-fundamentals.ts', 'scripts/deploy-cn-pubsub.sh', 'scripts/collect-sec-filings.ts', 'scripts/deploy-sec-filings.sh', 'scripts/deploy-sec-filings-pubsub.sh', 'scripts/refresh-company-graph.ts', 'scripts/serve-company-graph.ts', 'scripts/deploy-company-graph.sh', 'scripts/deploy-company-graph-pubsub.sh'].includes(path)) { financial = true; continue; }
    if (/^(src\/lib\/|scripts\/lib\/)/.test(path) || /^(package(-lock)?\.json|tsconfig\.json|\.gcloudignore|\.dockerignore)$/.test(path)
      || ['.github/workflows/deploy.yml','scripts/deploy-background-jobs.sh','scripts/build-fundamentals.sh','scripts/migrate-read-optimization.ts','scripts/firestore/migration-safety.ts'].includes(path)) {
      financial = directory = true;
    } else if (/^(Dockerfile\.fundamentals|cloudbuild\.fundamentals\.yaml|scripts\/(refresh-(sec-fundamentals|cn-fundamentals)\.ts|deploy-(sec-fundamentals|cn-fundamentals)\.sh|fetch-cn-annual\.py|akshare-requirements\.txt))$/.test(path)) {
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
