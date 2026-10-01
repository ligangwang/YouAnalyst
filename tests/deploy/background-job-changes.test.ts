import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backgroundJobTarget,chartOnlyLibraries} from '../../scripts/background-job-changes.mjs';
import {build} from 'esbuild';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {parseCompanyGraphPublisherArgs} from '../../src/lib/company-graph/cli';
const require=createRequire(import.meta.url);

test('chart-only exclusions cannot hide dependencies of any deployed worker',async()=>{
  const result=await build({entryPoints:[
    'scripts/serve-eod-maintenance.ts','scripts/refresh-sec-fundamentals.ts','scripts/serve-sec-fundamentals.ts',
    'scripts/collect-sec-filings.ts','scripts/refresh-company-graph.ts','scripts/serve-company-graph.ts',
    'scripts/refresh-cn-fundamentals.ts','scripts/refresh-private-valuations.ts',
    'scripts/sync-cni-directory.ts','scripts/serve-private-valuations.ts','scripts/serve-ticker-sync.ts','scripts/serve-cn-fundamentals.ts','scripts/serve-cni-directory.ts',
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
  assert.equal(backgroundJobTarget(['scripts/serve-private-valuations.ts']),'fundamentals');
  assert.equal(backgroundJobTarget(['scripts/deploy-private-valuations-pubsub.sh']),'fundamentals');
  assert.equal(backgroundJobTarget(['scripts/serve-ticker-sync.ts']),'fundamentals');
  for (const path of ['scripts/collect-sec-filings.ts', 'scripts/deploy-sec-filings.sh', 'scripts/deploy-sec-filings-pubsub.sh', 'scripts/refresh-company-graph.ts', 'scripts/serve-company-graph.ts', 'scripts/deploy-company-graph.sh', 'scripts/deploy-company-graph-pubsub.sh', 'scripts/serve-eod-maintenance.ts', 'scripts/deploy-eod-maintenance.sh']) {
    assert.equal(backgroundJobTarget([path]), 'fundamentals');
  }
  assert.equal(backgroundJobTarget(['scripts/deploy-ticker-sync.sh']),'fundamentals');
  assert.equal(backgroundJobTarget(['scripts/serve-cn-fundamentals.ts','scripts/deploy-cn-pubsub.sh']),'fundamentals');
  assert.equal(backgroundJobTarget(['scripts/serve-cni-directory.ts','scripts/deploy-directory-pubsub.sh']),'directory');
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

test('production rollout persists explicit pipeline flags and reuses only the approved OpenAI configuration', () => {
  const workflow=require('js-yaml').load(readFileSync('.github/workflows/deploy.yml','utf8'));
  const env=workflow.jobs['deploy-background-jobs'].env;
  for(const name of ['ENABLE_SEC_FILING_PIPELINE','SEC_FILINGS_COLLECTOR_ENABLED','COMPANY_GRAPH_PROCESSING_ENABLED','COMPANY_GRAPH_QUEUE_BATCH_SIZE','OPENAI_MODEL']) {
    assert.equal(env[name], `\${{ vars.${name} }}`);
  }
  assert.equal(env.OPENAI_API_KEY, "${{ vars.ENABLE_SEC_FILING_PIPELINE == '1' && secrets.OPENAI_API_KEY || '' }}");
  assert.equal(env.PUBSUB_BOOTSTRAP_IAM, undefined);
  const probe=workflow.jobs['deploy-background-jobs'].steps.find((step: {name?:string})=>step.name?.startsWith('Verify graph Pub/Sub'));
  assert.match(probe.if, /ENABLE_SEC_FILING_PIPELINE == '1'/);
  assert.match(probe.run, /COMPANY_GRAPH_VERIFY_ONLY=1/);
  assert.match(probe.run, /--args dist\/refresh-company-graph.cjs,--verify-delivery/);
  const probeArgs = probe.run.match(/--args ([^\s]+)/)![1].split(',').slice(1);
  assert.equal(parseCompanyGraphPublisherArgs(probeArgs, { COMPANY_GRAPH_VERIFY_ONLY: '1' }).verify, true);
  assert.doesNotMatch(probe.run, /COMPANY_GRAPH_PROCESSING_ENABLED|OPENAI/);

  assert.equal(workflow.jobs['deploy-production'].env.ENABLE_SEC_FILING_PIPELINE, '${{ vars.ENABLE_SEC_FILING_PIPELINE }}');
  assert.equal(workflow.jobs['deploy-staging'].env.ENABLE_SEC_FILING_PIPELINE, undefined);
  const deploy=readFileSync('scripts/deploy-cloud-run.sh','utf8');
  assert.match(deploy, /deploy-eod-maintenance.sh --publisher-only/);
  assert.match(deploy, /if \[\[ "\$\{ENABLE_SEC_FILING_PIPELINE:-0\}" == 1 \]\]; then\s+GCP_PROJECT_ID=.*deploy-company-graph-pubsub.sh --publisher-only/);
  assert.match(deploy, /if \[\[ "\$target" == production && "\$\{ENABLE_SEC_FILING_PIPELINE:-0\}" == 1 \]\]; then\s+company_graph_request_topic=company-graph-requests/);
  const cloudbuild=require('js-yaml').load(readFileSync('cloudbuild.yaml','utf8'));
  assert.equal(cloudbuild.substitutions._COMPANY_GRAPH_REQUEST_TOPIC, '');
  assert.ok(cloudbuild.steps[2].args.some((arg:string)=>arg.includes('COMPANY_GRAPH_REQUEST_TOPIC=${_COMPANY_GRAPH_REQUEST_TOPIC}')));
});

test('shared worker image contains both EOD and every SEC/graph publisher and subscriber', () => {
  const docker=readFileSync('Dockerfile.fundamentals','utf8');
  for(const entry of ['serve-eod-maintenance','collect-sec-filings','serve-sec-fundamentals','refresh-company-graph','serve-company-graph']) {
    assert.ok(docker.includes(`scripts/${entry}.ts --bundle --platform=node --packages=external --outfile=dist/${entry}.cjs`));
  }
});
