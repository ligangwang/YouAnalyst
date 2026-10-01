import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function run(script: string, extra: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'filing-pipeline-deploy-'));
  try {
    const result = spawnSync('bash', ['-c', `
      gcloud() {
        echo "$*" >> "$CALLS"
        case "$*" in
          *"get-iam-policy"*)
            if [[ "\${MISSING_IAM:-0}" == 1 ]]; then return 0; fi
            local arg
            for arg in "$@"; do
              if [[ "$arg" == *"AND bindings.members="* ]]; then printf '%s\\n' "\${arg##*AND bindings.members=}"; fi
            done ;;
          "pubsub subscriptions describe"*)
            if [[ "$*" == *"company-graph-filings"* && "\${MISSING_GRAPH_SUBSCRIPTION:-0}" == 1 ]]; then return 1; fi
            if [[ "\${NEW_PUBSUB:-0}" == 1 ]]; then return 1; fi
            if [[ "$*" == *"value(topic)"* ]]; then
              local topic="$4"
              case "$4" in
                sec-filings-fundamentals|company-graph-filings) topic=sec-filings-discovered ;;
                company-graph-worker) topic=company-graph-requests ;;
                *-audit) topic="\${4%-audit}" ;;
              esac
              echo "projects/demo/topics/\${WRONG_TOPIC:-$topic}"
            fi ;;
          "pubsub topics describe"*) if [[ "\${NEW_PUBSUB:-0}" == 1 ]]; then return 1; fi ;;
          "scheduler jobs describe"*) if [[ "\${NEW_SCHEDULER:-0}" == 1 ]]; then return 1; fi ;;
          "run services describe sec-fundamentals-subscriber"*|"run services describe company-graph-subscriber"*|"run services describe cn-fundamentals-subscriber"*|"run services describe private-valuations-subscriber"*|"run services describe ticker-catalog-subscriber"*|"run services describe eod-maintenance-subscriber"*|"run services describe cni-directory-subscriber"*) echo https://subscriber.example.run.app ;;
          "run services describe"*) echo web@demo.iam.gserviceaccount.com ;;
          "projects describe"*) echo 123456789 ;;
          "run jobs describe"*) echo directory-sync-runtime@demo.iam.gserviceaccount.com ;;
          "run deploy company-graph-subscriber"*)
            local previous='' arg
            for arg in "$@"; do
              if [[ "$previous" == --env-vars-file ]]; then cat "$arg" >> "$ENV_CAPTURE"; echo "$arg" >> "$ENV_PATHS"; fi
              previous="$arg"
            done ;;
          "builds submit"*) echo build-id ;;
          "builds describe"*) echo SUCCESS ;;
          "artifacts docker images describe"*) echo example/image@sha256:abcdef ;;
        esac
      }
      export -f gcloud
      if [[ -n "\${TARGET:-}" ]]; then bash "$SCRIPT" "$TARGET"; else bash "$SCRIPT"; fi
    `], { encoding: 'utf8', timeout: 10000, env: { ...process.env,
      CALLS: path.join(dir, 'calls'), ENV_CAPTURE: path.join(dir, 'env'), ENV_PATHS: path.join(dir, 'env-paths'), SCRIPT: script, GCP_PROJECT_ID: 'demo', GIT_SHA: 'commit',
      FUNDAMENTALS_IMAGE: 'example/image@sha256:abcdef', SEC_USER_AGENT: 'test contact', OPENAI_API_KEY: 'test-existing-key', OPENAI_MODEL: 'test-existing-model',
      WEB_RUNTIME_SERVICE_ACCOUNT: 'web@demo.iam.gserviceaccount.com',
      ENABLE_SEC_FILING_PIPELINE: '1', PUBSUB_BOOTSTRAP_IAM: '0', SEC_FILINGS_COLLECTOR_ENABLED: '0',
      ...extra,
    } });
    assert.ifError(result.error);
    let calls = ''; try { calls = readFileSync(path.join(dir, 'calls'), 'utf8'); } catch {}
    let workerEnv: Record<string, string> = {};
    try { workerEnv = JSON.parse(readFileSync(path.join(dir, 'env'), 'utf8')); } catch {}
    let envPaths: string[] = [];
    try { envPaths = readFileSync(path.join(dir, 'env-paths'), 'utf8').trim().split('\n'); } catch {}
    return { ...result, calls, workerEnv, envFilesRemoved: envPaths.every(file => !existsSync(file)) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('filing collector is disabled by default and a new schedule is paused', () => {
  const r = run('scripts/deploy-sec-filings.sh', { NEW_SCHEDULER: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, /--args dist\/collect-sec-filings.cjs,--apply/);
  assert.match(r.calls, /SEC_FILINGS_TOPIC=sec-filings-discovered\|SEC_FILINGS_COLLECTOR_ENABLED=0/);
  assert.match(r.calls, /scheduler jobs create http collect-sec-filings-production.*--schedule \*\/15 \* \* \* \*/);
  assert.match(r.calls, /scheduler jobs pause collect-sec-filings-production/);
  assert.ok(r.calls.indexOf('subscriptions describe company-graph-filings') < r.calls.indexOf('run jobs deploy collect-sec-filings-production'));
  assert.doesNotMatch(r.calls, /add-iam-policy-binding|OPENAI|run jobs execute|scheduler jobs resume/);
});

test('collector releases preserve current schedule state and explicit enabled config', () => {
  const r = run('scripts/deploy-sec-filings.sh', { SEC_FILINGS_COLLECTOR_ENABLED: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, /SEC_FILINGS_COLLECTOR_ENABLED=1/);
  assert.match(r.calls, /scheduler jobs update http collect-sec-filings-production/);
  assert.doesNotMatch(r.calls, /scheduler jobs (pause|resume|delete)/);
});

test('collector fails closed without rollout, valid flags, or both fan-out consumers', () => {
  for (const extra of [{ ENABLE_SEC_FILING_PIPELINE: '0' }, { SEC_FILINGS_COLLECTOR_ENABLED: 'yes' }, { MISSING_GRAPH_SUBSCRIPTION: '1' }, { WRONG_TOPIC: 'wrong' }] as Record<string, string>[]) {
    const r = run('scripts/deploy-sec-filings.sh', extra);
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.calls, /run jobs deploy|scheduler jobs (create|update|pause)/);
  }
});

test('filing fundamentals delivery has an isolated dead letter and authenticated bounded push', () => {
  const r = run('scripts/deploy-sec-filings-pubsub.sh', { NEW_PUBSUB: '1', PUBSUB_BOOTSTRAP_IAM: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, /topics create sec-filings-discovered/);
  assert.match(r.calls, /subscriptions create sec-filings-fundamentals-dead-letter-audit --topic sec-filings-fundamentals-dead-letter.*--message-retention-duration 7d/);
  assert.match(r.calls, /subscriptions create sec-filings-fundamentals --topic sec-filings-discovered.*--push-auth-service-account directory-sync-scheduler@demo.iam.gserviceaccount.com.*--ack-deadline 600.*--dead-letter-topic sec-filings-fundamentals-dead-letter.*--max-delivery-attempts 100/);
  assert.match(r.calls, /subscriptions add-iam-policy-binding sec-filings-fundamentals.*--member serviceAccount:service-123456789@gcp-sa-pubsub.iam.gserviceaccount.com --role roles\/pubsub.subscriber/);
  assert.doesNotMatch(r.calls, /projects add-iam|secrets |service-accounts create|sec-filings-discovered.*serviceAccount:web@/);
});

test('normal filing release only verifies IAM and refuses implicit grants', () => {
  const good = run('scripts/deploy-sec-filings-pubsub.sh');
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.calls, /get-iam-policy/);
  assert.doesNotMatch(good.calls, /add-iam-policy-binding|iam service-accounts get-iam-policy/);
  const missing = run('scripts/deploy-sec-filings-pubsub.sh', { MISSING_IAM: '1' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /authorized operator must approve.*PUBSUB_BOOTSTRAP_IAM=1/);
  assert.doesNotMatch(missing.calls, /add-iam-policy-binding|subscriptions (create|update)|topics create/);
});

test('graph subscriber keeps request and filing delivery isolated and processing disabled by default', () => {
  const r = run('scripts/deploy-company-graph-pubsub.sh');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, /run deploy company-graph-subscriber.*--no-allow-unauthenticated.*--args dist\/serve-company-graph.cjs.*--min-instances 0 --max-instances 1.*--concurrency 1 --timeout 600/);
  assert.match(r.calls, /subscriptions update company-graph-worker.*--dead-letter-topic company-graph-dead-letter/);
  assert.match(r.calls, /subscriptions update company-graph-filings.*--dead-letter-topic company-graph-filings-dead-letter/);
  assert.match(r.calls, /subscriptions describe company-graph-filings.*value\(topic\)/);
  assert.deepEqual(r.workerEnv, {
    GCP_PROJECT_ID: 'demo', GIT_SHA: 'commit', SEC_USER_AGENT: 'test contact',
    OPENAI_API_KEY: 'test-existing-key', OPENAI_MODEL: 'test-existing-model',
    COMPANY_GRAPH_SUBSCRIPTION: 'company-graph-worker', COMPANY_GRAPH_FILINGS_SUBSCRIPTION: 'company-graph-filings',
    COMPANY_GRAPH_PROCESSING_ENABLED: '0',
  });
  assert.equal(r.envFilesRemoved, true);
  assert.doesNotMatch(r.calls, /test-existing-key|test-existing-model|add-iam-policy-binding|secrets |service-accounts create|projects add-iam/);
});

test('graph bootstrap grants only resource-scoped existing identities and keeps keys out of commands', () => {
  const r = run('scripts/deploy-company-graph-pubsub.sh', { NEW_PUBSUB: '1', PUBSUB_BOOTSTRAP_IAM: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, /topics add-iam-policy-binding company-graph-requests .*--member serviceAccount:web@demo.iam.gserviceaccount.com --role roles\/pubsub.publisher/);
  assert.match(r.calls, /run services add-iam-policy-binding company-graph-subscriber.*--member serviceAccount:directory-sync-scheduler@demo.iam.gserviceaccount.com --role roles\/run.invoker/);
  assert.match(r.calls, /subscriptions create company-graph-filings --topic sec-filings-discovered.*--push-auth-token-audience https:\/\/subscriber.example.run.app.*--max-delivery-attempts 100.*--message-retention-duration 7d/);
  assert.doesNotMatch(r.calls, /projects add-iam|service-accounts create|secrets |test-existing-key|topics add-iam-policy-binding (company-graph.*dead-letter|sec-filings-discovered).*serviceAccount:web@/);
});

test('graph pre-web publication retains requests without worker credentials, delivery mutation or beta tools', () => {
  const r = run('scripts/deploy-company-graph-pubsub.sh', { TARGET: '--publisher-only', OPENAI_API_KEY: '', FUNDAMENTALS_IMAGE: '', SEC_USER_AGENT: '' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, /topics get-iam-policy company-graph-requests/);
  assert.match(r.calls, /subscriptions describe company-graph-worker/);
  assert.doesNotMatch(r.calls, /beta |run deploy|subscriptions update|serviceAccountTokenCreator|env-vars-file/);
  const first = run('scripts/deploy-company-graph-pubsub.sh', { TARGET: '--publisher-only', NEW_PUBSUB: '1', PUBSUB_BOOTSTRAP_IAM: '1', OPENAI_API_KEY: '' });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.calls, /subscriptions create company-graph-worker --topic company-graph-requests.*--message-retention-duration 7d/);
  assert.doesNotMatch(first.calls, /--push-endpoint/);
});

test('graph release validates rollout, credentials, processing flags and existing IAM before deployment', () => {
  for (const extra of [
    { ENABLE_SEC_FILING_PIPELINE: '0' }, { OPENAI_API_KEY: '' }, { SEC_USER_AGENT: '' },
    { COMPANY_GRAPH_PROCESSING_ENABLED: 'true' }, { PUBSUB_BOOTSTRAP_IAM: 'true' }, { MISSING_IAM: '1' },
    { WRONG_TOPIC: 'unrelated-topic' },
  ] as Record<string, string>[]) {
    const r = run('scripts/deploy-company-graph-pubsub.sh', extra);
    assert.notEqual(r.status, 0, JSON.stringify(extra));
    assert.doesNotMatch(r.calls, /run deploy|add-iam-policy-binding|subscriptions (update|create)/);
  }
});

test('graph publisher is bounded, starts paused and has no paid-provider configuration', () => {
  const r = run('scripts/deploy-company-graph.sh', { NEW_SCHEDULER: '1', COMPANY_GRAPH_QUEUE_BATCH_SIZE: '5' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, /run jobs deploy refresh-company-graph-production.*--args dist\/refresh-company-graph.cjs,--apply.*COMPANY_GRAPH_REQUEST_TOPIC=company-graph-requests\|COMPANY_GRAPH_QUEUE_BATCH_SIZE=5/);
  assert.match(r.calls, /scheduler jobs create http refresh-company-graph-production.*--schedule \*\/5 \* \* \* \* --time-zone UTC/);
  assert.match(r.calls, /scheduler jobs pause refresh-company-graph-production/);
  assert.ok(r.calls.indexOf('subscriptions update company-graph-worker') < r.calls.indexOf('run jobs deploy refresh-company-graph-production'));
  const job = r.calls.split('\n').find(line => line.startsWith('run jobs deploy'))!;
  assert.doesNotMatch(job, /OPENAI|SEC_USER_AGENT|env-vars-file/);
  const repeat = run('scripts/deploy-company-graph.sh', { COMPANY_GRAPH_PROCESSING_ENABLED: '1' });
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.equal(repeat.workerEnv.COMPANY_GRAPH_PROCESSING_ENABLED, '1');
  assert.match(repeat.calls, /scheduler jobs update http refresh-company-graph-production/);
  assert.doesNotMatch(repeat.calls, /scheduler jobs (pause|resume|delete)/);
  const invalid = run('scripts/deploy-company-graph.sh', { COMPANY_GRAPH_QUEUE_BATCH_SIZE: '6' });
  assert.notEqual(invalid.status, 0);
  assert.doesNotMatch(invalid.calls, /run deploy|run jobs deploy|scheduler jobs|topics (create|add-iam)/);
});

test('full SEC/graph rollout provisions both consumers before the disabled collector using one image', () => {
  const r = run('scripts/deploy-background-jobs.sh', { TARGET: 'sec-filings' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls.match(/builds submit/g)?.length, 1);
  assert.match(r.calls, /SEC_FILINGS_FUNDAMENTALS_SUBSCRIPTION=sec-filings-fundamentals/);
  assert.match(r.calls, /SEC_FILINGS_COLLECTOR_ENABLED=0/);
  const collector = r.calls.indexOf('run jobs deploy collect-sec-filings-production');
  assert.ok(r.calls.indexOf('subscriptions update sec-filings-fundamentals') < collector);
  assert.ok(r.calls.indexOf('subscriptions update company-graph-filings') < collector);
  assert.doesNotMatch(r.calls, /(?:topics|subscriptions) add-iam-policy-binding (?:company-graph|sec-filings)|run services add-iam-policy-binding company-graph|run jobs add-iam-policy-binding (?:collect-sec-filings|refresh-company-graph)|run jobs execute|scheduler jobs resume/);
});

test('pipeline preflight fails before building or changing existing workers', () => {
  for (const extra of [
    { ENABLE_SEC_FILING_PIPELINE: '0' }, { OPENAI_API_KEY: '' }, { COMPANY_GRAPH_PROCESSING_ENABLED: 'yes' },
    { SEC_FILINGS_COLLECTOR_ENABLED: 'yes' }, { COMPANY_GRAPH_QUEUE_BATCH_SIZE: '10' },
  ] as Record<string, string>[]) {
    const r = run('scripts/deploy-background-jobs.sh', { TARGET: 'sec-filings', ...extra });
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.calls, /builds submit|run deploy|run jobs (deploy|update)|scheduler jobs/);
  }
});

test('enabled routine financial releases retain all EOD and SEC workers plus both new jobs', () => {
  const r = run('scripts/deploy-background-jobs.sh', { TARGET: 'fundamentals', COMPANY_GRAPH_PROCESSING_ENABLED: '1', SEC_FILINGS_COLLECTOR_ENABLED: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls.match(/builds submit/g)?.length, 1);
  for (const service of ['sec-fundamentals', 'cn-fundamentals', 'private-valuations', 'ticker-catalog', 'eod-maintenance', 'company-graph']) {
    assert.match(r.calls, new RegExp(`run deploy ${service}-subscriber`));
  }
  assert.equal(r.calls.match(/run jobs deploy/g)?.length, 5);
  assert.equal(r.workerEnv.COMPANY_GRAPH_PROCESSING_ENABLED, '1');
  assert.match(r.calls, /SEC_FILINGS_COLLECTOR_ENABLED=1/);
  assert.doesNotMatch(r.calls, /scheduler jobs (resume|pause|delete)|run jobs execute/);
  const disabled = run('scripts/deploy-background-jobs.sh', { TARGET: 'fundamentals', ENABLE_SEC_FILING_PIPELINE: '0', OPENAI_API_KEY: '' });
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.doesNotMatch(disabled.calls, /company-graph|sec-filings-discovered|collect-sec-filings/);
});
