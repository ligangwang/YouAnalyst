import {deliveryTasks} from '../../scripts/verify-worker-delivery.mjs';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backgroundJobTarget,UI_LIBRARY_ROOT} from '../../scripts/background-job-changes.mjs';
import {build} from 'esbuild';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {parseCompanyGraphPublisherArgs} from '../../src/lib/company-graph/cli';
const require=createRequire(import.meta.url);

test('UI library boundary cannot hide dependencies of any bundled worker',async()=>{
  const entryPoints=[...new Set(['Dockerfile.fundamentals','Dockerfile.directory-sync'].flatMap(file=>
    [...readFileSync(file,'utf8').matchAll(/scripts\/[\w-]+\.ts(?=\s+--bundle)/g)].map(match=>match[0])
  ))];
  assert.ok(entryPoints.includes('scripts/collect-intelligence-news.ts'));
  assert.ok(entryPoints.includes('scripts/serve-intelligence-news.ts'));
  assert.ok(entryPoints.includes('scripts/collect-earnings.ts'));
  assert.ok(entryPoints.includes('scripts/backfill-event-classifications.ts'));
  assert.ok(entryPoints.includes('scripts/sync-cni-directory.ts'));
  const result=await build({entryPoints,bundle:true,platform:'node',packages:'external',outdir:'unused',write:false,metafile:true});
  const inputs=new Set(Object.keys(result.metafile!.inputs).map(p=>p.replaceAll('\\','/')));
  assert.deepEqual([...inputs].filter(path=>path.startsWith(UI_LIBRARY_ROOT)),[], 'Workers must not import website presentation libraries');
});

test('website-only changes skip workers and worker inputs select their images',()=>{
  for(const path of ['scripts/deploy-instrument-onboarding.sh','scripts/onboard-instruments.ts','scripts/serve-instrument-onboarding.ts','scripts/migrate-instrument-onboarding.ts'])assert.equal(backgroundJobTarget([path]),'fundamentals');
  assert.equal(backgroundJobTarget(['scripts/serve-intelligence-news.ts','scripts/deploy-news-pubsub.sh']),'fundamentals');
  assert.equal(backgroundJobTarget(['src/components/admin-jobs-page.tsx','docs/github-actions.md']),'none');
  assert.equal(backgroundJobTarget(['src/app/api/admin/fundamentals-errors/route.ts','src/app/api/admin/fundamentals-errors/list.ts']),'none');
  assert.equal(backgroundJobTarget(['src/lib/ui/company-timeline.ts','src/lib/ui/knowledge-graph/tree-tour.ts']),'none');
  assert.equal(backgroundJobTarget(['src/lib/ui/future-chart-helper.ts']),'none');
  assert.equal(backgroundJobTarget(['src/lib/compare-video.ts','src/lib/ui/compare-video.ts','src/components/comparison-video-export.tsx','scripts/background-job-changes.mjs']),'none');
  assert.equal(backgroundJobTarget(['src/lib/ui/compare-video.ts','src/lib/events/classification.ts']),'all');
  assert.equal(backgroundJobTarget(['src/lib/company-timeline.ts','src/lib/knowledge-graph/tree-tour.ts','src/lib/ui/company-timeline.ts','scripts/background-job-changes.mjs']),'none');
  assert.equal(backgroundJobTarget(['src/lib/ui/company-timeline.ts','src/lib/events/classification.ts']),'all');
  // Moving the galaxy layout out of the shared library must not redeploy workers.
  assert.equal(backgroundJobTarget(['src/lib/knowledge-graph/layout-galaxy.ts','src/lib/ui/knowledge-graph/layout-galaxy.ts','src/components/company-graph-3d.tsx','scripts/background-job-changes.mjs']),'none');
  assert.equal(backgroundJobTarget(['scripts/fetch-cn-annual.py']),'fundamentals');
  for (const path of ['scripts/collect-sec-filings.ts', 'scripts/deploy-sec-filings.sh', 'scripts/deploy-sec-filings-pubsub.sh', 'scripts/refresh-company-graph.ts', 'scripts/serve-company-graph.ts', 'scripts/deploy-company-graph.sh', 'scripts/deploy-company-graph-pubsub.sh', 'scripts/serve-eod-maintenance.ts', 'scripts/deploy-eod-maintenance.sh']) {
    assert.equal(backgroundJobTarget([path]), 'fundamentals');
  }
  assert.equal(backgroundJobTarget(['scripts/serve-cn-fundamentals.ts','scripts/deploy-cn-pubsub.sh']),'fundamentals');
  assert.equal(backgroundJobTarget(['scripts/serve-cni-directory.ts','scripts/deploy-directory-pubsub.sh']),'directory');
  assert.equal(backgroundJobTarget(['scripts/download-cni-directory.py']),'directory');
  assert.equal(backgroundJobTarget(['Dockerfile.directory-sync','scripts/refresh-sec-fundamentals.ts']),'all');
  assert.equal(backgroundJobTarget(['.github/workflows/deploy.yml']),'all');
  for(const p of ['src/lib/maintenance-lease.ts','package-lock.json','.dockerignore','.gcloudignore','scripts/lib/maintenance-job-iam.sh','scripts/build-fundamentals.sh']) assert.equal(backgroundJobTarget([p]),'all');
});
test('worker release passes checks before production web and uses detected targets',()=>{
  const workflow=require('js-yaml').load(readFileSync('.github/workflows/deploy.yml','utf8'));
  const job=workflow.jobs['deploy-background-jobs'];
  assert.match(workflow.jobs['deploy-production'].if,/github.ref == 'refs\/heads\/main'/);
  assert.deepEqual(job.needs,['verify','verify-browser','build-release']);
  assert(!workflow.jobs['deploy-production'].needs.includes('deploy-background-jobs'));
  assert.equal(workflow.jobs['deploy-production'].permissions.actions, 'read');
  const productionStep=workflow.jobs['deploy-production'].steps.find((step: {name?: string})=>step.name==='Deploy production application');
  assert.equal(productionStep.env.EXPECTED_WORKER_TARGET,'${{ needs.verify.outputs.workers }}');
  const script=readFileSync('scripts/deploy-cloud-run.sh','utf8');
  assert(script.indexOf('node scripts/wait-worker-rollout.mjs') < script.indexOf('node scripts/promote-release.mjs'));
  assert.match(job.if,/!cancelled\(\)/);
  assert.match(job.if,/needs.verify.result == 'success'/);
  assert.match(job.if,/refs\/heads\/main/);assert.match(job.if,/build-release.result == 'success'/);
  assert.match(job.if,/workers != 'none'/);
  assert.equal(job.env.TARGET_JOB,'${{ needs.verify.outputs.workers }}');
  assert.equal(existsSync('.github/workflows/deploy-background-jobs.yml'),false);
});

test('production rollout persists explicit pipeline flags and reuses only the approved OpenAI configuration', () => {
  const workflow=require('js-yaml').load(readFileSync('.github/workflows/deploy.yml','utf8'));
  const env=workflow.jobs['deploy-background-jobs'].env;
  for(const name of ['ENABLE_SEC_FILING_PIPELINE','SEC_FILINGS_COLLECTOR_ENABLED','COMPANY_GRAPH_PROCESSING_ENABLED','COMPANY_GRAPH_PAID_ADMISSION_ENABLED','COMPANY_GRAPH_QUEUE_BATCH_SIZE','OPENAI_MODEL']) {
    assert.equal(env[name], `\${{ vars.${name} }}`);
  }
  assert.equal(env.OPENAI_API_KEY, "${{ (vars.ENABLE_SEC_FILING_PIPELINE == '1' || vars.CALENDAR_EXTRACTION_ENABLED == '1' || vars.INTELLIGENCE_NEWS_COLLECTOR_ENABLED == '1') && secrets.OPENAI_API_KEY || '' }}");
  assert.equal(env.PUBSUB_BOOTSTRAP_IAM, undefined);
  const step=workflow.jobs['deploy-background-jobs'].steps.find((step: {name?:string})=>step.name === 'Verify worker delivery without provider calls');
  assert.equal(step.run, 'node scripts/verify-worker-delivery.mjs');
  const probe=deliveryTasks({TARGET_JOB:'all',ENABLE_SEC_FILING_PIPELINE:'1',GCP_PROJECT_ID:'test',GCP_REGION:'us-central1'}).find(task=>task.id==='verify-graph')!;
  assert(probe.args.includes('COMPANY_GRAPH_VERIFY_ONLY=1'));
  const probeArgs = probe.args[probe.args.indexOf('--args')+1].split(',').slice(1);
  assert.equal(parseCompanyGraphPublisherArgs(probeArgs, { COMPANY_GRAPH_VERIFY_ONLY: '1' }).verify, true);
  assert(!deliveryTasks({TARGET_JOB:'all',ENABLE_SEC_FILING_PIPELINE:'0'}).some(task=>task.id==='verify-graph'));

  assert.equal(workflow.jobs['deploy-production'].env.ENABLE_SEC_FILING_PIPELINE, '${{ vars.ENABLE_SEC_FILING_PIPELINE }}');
  assert.equal(workflow.jobs['deploy-staging'].env.ENABLE_SEC_FILING_PIPELINE, undefined);
  const deploy=readFileSync('scripts/deploy-cloud-run.sh','utf8');
  assert.match(deploy, /deploy-eod-maintenance.sh --publisher-only/);
  assert.match(deploy, /if \[\[ "\$\{ENABLE_SEC_FILING_PIPELINE:-0\}" == 1 \]\]; then\s+GCP_PROJECT_ID=.*deploy-company-graph-pubsub.sh --publisher-only/);
  assert.match(deploy, /if \[\[ "\$target" == production && "\$\{ENABLE_SEC_FILING_PIPELINE:-0\}" == 1 \]\]; then\s+company_graph_request_topic=company-graph-requests/);
  const cloudbuild=require('js-yaml').load(readFileSync('cloudbuild.yaml','utf8'));
  assert.equal(cloudbuild.substitutions._COMPANY_GRAPH_REQUEST_TOPIC, '');
  assert.equal(cloudbuild.substitutions._COMPANY_GRAPH_PAID_ADMISSION_ENABLED, '0');
  assert.equal(workflow.jobs['deploy-production'].env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED, '${{ vars.COMPANY_GRAPH_PAID_ADMISSION_ENABLED }}');
  assert.equal(workflow.jobs['deploy-staging'].env.COMPANY_GRAPH_PAID_ADMISSION_ENABLED, undefined);
  assert.ok(cloudbuild.steps[2].args.some((arg:string)=>arg.includes('COMPANY_GRAPH_PAID_ADMISSION_ENABLED=${_COMPANY_GRAPH_PAID_ADMISSION_ENABLED}')));
  assert.ok(cloudbuild.steps[2].args.some((arg:string)=>arg.includes('COMPANY_GRAPH_REQUEST_TOPIC=${_COMPANY_GRAPH_REQUEST_TOPIC}')));
});

test('shared worker image contains both EOD and every SEC/graph publisher and subscriber', () => {
  const docker=readFileSync('Dockerfile.fundamentals','utf8');
  for(const entry of ['serve-eod-maintenance','collect-sec-filings','serve-sec-fundamentals','refresh-company-graph','serve-company-graph']) {
    assert.ok(docker.includes(`scripts/${entry}.ts --bundle --platform=node --packages=external --outfile=dist/${entry}.cjs`));
  }
});

test('news analysis receives its existing key while calendar extraction is disabled',()=>{
  const script=readFileSync('scripts/deploy-intelligence-news.sh','utf8');
  const generator=script.match(/<<'NODE'\r?\n([\s\S]*?)\r?\nNODE/)?.[1];
  assert.ok(generator);
  let stored:Record<string,string>|undefined;
  runInNewContext(generator,{
    require:(name:string)=>{assert.equal(name,'node:fs');return {writeFileSync:(_path:string,body:string)=>{stored=JSON.parse(body);}};},
    process:{argv:['node','-','test-env'],env:{GCP_PROJECT_ID:'demo',INTELLIGENCE_NEWS_COLLECTOR_ENABLED:'1',CALENDAR_EXTRACTION_ENABLED:'0',OPENAI_API_KEY:'news-test-key'}},
  });
  assert.equal(stored?.OPENAI_API_KEY,'news-test-key');
  assert.equal(stored?.CALENDAR_EXTRACTION_ENABLED,'0');
  assert.equal(stored?.NEWS_ANALYSIS_MONTHLY_BUDGET_USD,'5');
});

test('migration repairs rerun worker deployment before enabling website consumers',()=>{
  assert.equal(backgroundJobTarget(['scripts/migrate-read-optimization.ts']),'all');
  assert.equal(backgroundJobTarget(['scripts/firestore/migration-safety.ts']),'all');
});
