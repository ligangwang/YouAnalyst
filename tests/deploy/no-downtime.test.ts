import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyCandidate } from '../../scripts/verify-release-candidate.mjs';

test('website release validates a pinned candidate before changing traffic', () => {
  const build = readFileSync('cloudbuild.yaml', 'utf8');
  assert.match(build, /--no-traffic/);
  assert.match(build, /--update-env-vars/);
  assert.doesNotMatch(build, /--set-env-vars/); // Preserve CACHE_EVENT_AUDIENCE on the pinned candidate.
  assert.match(build, /--tag\s+- candidate/);
  const deploy = readFileSync('scripts/deploy-cloud-run.sh', 'utf8');
  assert(deploy.indexOf('node scripts/verify-release-candidate.mjs') < deploy.indexOf('gcloud run services update-traffic'));
  assert.match(deploy, /--to-revisions "\$candidate_revision=100"/);
  assert.doesNotMatch(deploy, /--to-latest/);
});

test('candidate checks reject wrong versions and failed pages before promotion', async () => {
  const options = {url: 'https://candidate.invalid', revision: 'rev-2', commit: 'abc'};
  const ok = async (url: string | URL | Request) => String(url).endsWith('/api/health')
    ? Response.json({status: 'ok', commitSha: 'abc', revision: 'rev-2'})
    : String(url).includes('/api/intelligence?') ? Response.json({graph:{nodes:[{kind:'COMPANY'}]}})
    : new Response('<html>' + 'x'.repeat(1100) + '</html>');
  await verifyCandidate({...options, request: ok});
  await assert.rejects(verifyCandidate({...options, commit: 'wrong', request: ok}), /commit mismatch/);
  await assert.rejects(verifyCandidate({...options, request: async url => String(url).endsWith('/api/health') ? ok(url) : new Response('Not found', {status:404})}), /failed/);
});
