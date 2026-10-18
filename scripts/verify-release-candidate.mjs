import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
export async function verifyCandidate({url, revision, commit, request=fetch}) {
  assert(url && revision && commit, 'Candidate URL, revision and commit required');
  const health = await request(`${url}/api/health`, {signal:AbortSignal.timeout(60000)});
  assert.equal(health.status, 200, 'Candidate health check failed; existing traffic stays unchanged');
  const body = await health.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.commitSha, commit, 'Candidate commit mismatch');
  assert.equal(body.revision, revision, 'Candidate revision mismatch');
  for (const path of ['/', '/ai']) {
    const response = await request(`${url}${path}`, {signal:AbortSignal.timeout(60000)});
    assert.equal(response.status, 200, `Candidate ${path} failed; existing traffic stays unchanged`);
    const html = await response.text();
    assert(html.length > 1000 && /<html/i.test(html), `Candidate ${path} did not return an application page`);
    assert(!/The requested URL was not found on this server/.test(html));
  }
  console.log(`Candidate ${revision} verified before traffic promotion.`);
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyCandidate({url:process.env.CANDIDATE_URL,revision:process.env.CANDIDATE_REVISION,commit:process.env.GIT_SHA})
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
