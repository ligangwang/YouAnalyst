import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyCandidate } from '../../scripts/verify-release-candidate.mjs';

test('website release validates a pinned candidate before changing traffic', () => {
  const build = readFileSync('cloudbuild.yaml', 'utf8');
  assert.match(build, /--no-traffic/);
  const probe=build.match(/--startup-probe\s+- ([^\r\n]+)/)?.[1];
  assert(probe,'Every replacement instance must pass HTTP startup readiness');
  const fields=Object.fromEntries(probe.split(',').map(field=>field.split('=')));
  assert.equal(fields['httpGet.path'],'/api/health');
  assert.equal(fields['httpGet.port'],'8080');
  assert(!Object.keys(fields).some(key=>key.startsWith('tcpSocket')));
  assert(Number(fields.timeoutSeconds)<=Number(fields.periodSeconds));
  assert(Number(fields.periodSeconds)<=2,'Readiness must not wait a long polling interval');
  assert(Number(fields.failureThreshold)*Number(fields.periodSeconds)>=60,'Allow bounded startup without restarting healthy slow boots');
  assert.match(build, /--update-env-vars/);
  assert.doesNotMatch(build, /--set-env-vars/); // Preserve CACHE_EVENT_AUDIENCE on the pinned candidate.
  assert.match(build, /--tag\s+- candidate/);
  const deploy = readFileSync('scripts/deploy-cloud-run.sh', 'utf8');
  assert(deploy.indexOf('node scripts/verify-release-candidate.mjs') < deploy.indexOf('node scripts/promote-release.mjs'));
  assert.match(deploy,/GIT_SHA="\$\{GIT_SHA:-local\}" node scripts\/promote-release.mjs/);
  assert.doesNotMatch(deploy, /--to-latest/);
});

test('candidate checks reject wrong versions and failed pages before promotion', async () => {
  const options = {url: 'https://candidate.invalid', revision: 'rev-2', commit: 'abc'};
  const ok = async (url: string | URL | Request, options?: RequestInit) => options?.method === 'POST' || String(url).endsWith('/api/preferences/compare') ? new Response('', {status:401}) : String(url).endsWith('/api/compare/community') ? Response.json({items:[], nextCursor:null}) : String(url).endsWith('/en/compare') ? new Response('<html>Community comparisons · Colors &amp; style templates</html>') : String(url).endsWith('/api/health')
    ? Response.json({status: 'ok', commitSha: 'abc', revision: 'rev-2'})
    : String(url).endsWith('/about') ? new Response('<html>Understand the companies behind your investments. 了解你所投资的公司。 <a href="mailto:support@youanalyst.com">Email</a><a href="https://x.com/knoics321">X</a></html>')
    : String(url).includes('/api/intelligence?') ? Response.json({graph:{nodes:[{kind:'COMPANY'}]}})
    : /\/(industries|investment-themes)\?/.test(String(url)) ? new Response('<html><h2 id="category-title">Semiconductors &amp; Related Devices 集成电路 Chips</h2></html>')
    : new Response('<html>' + 'x'.repeat(1100) + '</html>');
  await verifyCandidate({...options, request: ok});
  await assert.rejects(verifyCandidate({...options, commit: 'wrong', request: ok}), /commit mismatch/);
  await assert.rejects(verifyCandidate({...options, request: async url => String(url).endsWith('/api/health') ? ok(url) : new Response('Not found', {status:404})}), /failed/);
  await assert.rejects(verifyCandidate({...options, request: async (url, init) => String(url).endsWith('/api/compare/community') && init?.method !== 'POST' ? new Response('Index building', {status:503}) : ok(url, init)}), /ranking index readiness/);
  await assert.rejects(verifyCandidate({...options, request: async (url, init) => init?.method === 'POST' ? new Response('Unexpected success', {status:201}) : ok(url, init)}), /require sign-in/);
  await assert.rejects(verifyCandidate({...options, request: async (url, init) => String(url).endsWith('/about') ? new Response('<html>Missing contacts</html>') : ok(url, init)}), /missing About us content/);
  await assert.rejects(verifyCandidate({...options, request: async (url, init) => String(url).includes('/industries?') ? new Response('<html>Category not found</html>') : ok(url, init)}), /missing selected category/);
});
