import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backgroundJobTarget,chartOnlyLibraries} from '../../scripts/background-job-changes.mjs';
import {build} from 'esbuild';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

test('chart-only exclusions cannot hide dependencies of any deployed worker',async()=>{
  const result=await build({entryPoints:[
    'scripts/refresh-sec-fundamentals.ts','scripts/serve-sec-fundamentals.ts',
    'scripts/refresh-cn-fundamentals.ts','scripts/refresh-private-valuations.ts',
    'scripts/sync-cni-directory.ts',
  ],bundle:true,platform:'node',packages:'external',outdir:'unused',write:false,metafile:true});
  const inputs=new Set(Object.keys(result.metafile!.inputs).map(p=>p.replaceAll('\\','/')));
  for(const path of chartOnlyLibraries) {
    assert.ok(!inputs.has(path),`${path} is used by a worker and must trigger deployment`);
    assert.equal(backgroundJobTarget([path]),'none');
  }
});

test('website-only changes skip workers and worker inputs select their images',()=>{
  assert.equal(backgroundJobTarget(['src/components/admin-jobs-page.tsx','docs/github-actions.md']),'none');
  assert.equal(backgroundJobTarget(['scripts/fetch-cn-annual.py']),'fundamentals');
  assert.equal(backgroundJobTarget(['scripts/download-cni-directory.py']),'directory');
  assert.equal(backgroundJobTarget(['Dockerfile.directory-sync','scripts/refresh-sec-fundamentals.ts']),'all');
  assert.equal(backgroundJobTarget(['.github/workflows/deploy.yml']),'all');
  for(const p of ['src/lib/maintenance-lease.ts','package-lock.json','.dockerignore','.gcloudignore','scripts/lib/maintenance-job-iam.sh','scripts/build-fundamentals.sh']) assert.equal(backgroundJobTarget([p]),'all');
});
test('worker release waits for successful production release and uses detected targets',()=>{
  const workflow=require('js-yaml').load(readFileSync('.github/workflows/deploy.yml','utf8'));
  const job=workflow.jobs['deploy-background-jobs'];
  assert.match(workflow.jobs['deploy-production'].if,/github.ref == 'refs\/heads\/main'/);
  assert.deepEqual(job.needs,['verify','deploy-production']);
  assert.match(job.if,/!cancelled\(\)/);
  assert.match(job.if,/needs.verify.result == 'success'/);
  assert.match(job.if,/refs\/heads\/main/);assert.match(job.if,/deploy-production.result == 'success'/);
  assert.match(job.if,/workers != 'none'/);
  assert.equal(job.env.TARGET_JOB,'${{ needs.verify.outputs.workers }}');
  assert.equal(existsSync('.github/workflows/deploy-background-jobs.yml'),false);
});
