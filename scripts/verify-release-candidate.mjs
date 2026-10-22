import {taggedReleaseRequest} from './tagged-release-request.mjs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
export async function verifyCandidate({url, revision, commit, request=fetch}) {
  const rawRequest=request;
  request=(input,options)=>taggedReleaseRequest(input,options,{request:rawRequest});
  assert(url && revision && commit, 'Candidate URL, revision and commit required');
  const health = await request(`${url}/api/health`, {signal:AbortSignal.timeout(60000)});
  assert.equal(health.status, 200, 'Candidate health check failed; existing traffic stays unchanged');
  const body = await health.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.commitSha, commit, 'Candidate commit mismatch');
  assert.equal(body.revision, revision, 'Candidate revision mismatch');
  for (const path of ['/', '/feed']) {
    const response = await request(`${url}${path}`, {signal:AbortSignal.timeout(60000)});
    assert.equal(response.status, 200, `Candidate ${path} failed; existing traffic stays unchanged`);
    const html = await response.text();
    assert(html.length > 1000 && /<html/i.test(html), `Candidate ${path} did not return an application page`);
    assert(!/The requested URL was not found on this server/.test(html));
  }
  for (const [path, headline] of [['/en/about', 'Understand the companies behind your investments.'], ['/zh-cn/about', '了解你所投资的公司。']]) {
    const response = await request(`${url}${path}`, {signal:AbortSignal.timeout(60000)});
    assert.equal(response.status, 200, `Candidate ${path} failed; existing traffic stays unchanged`);
    const html = await response.text();
    assert(html.includes(headline) && html.includes('mailto:support@youanalyst.com') && html.includes('https://x.com/knoics321'), `Candidate ${path} is missing About us content or contact links`);
  }
  const comparisonPage = await request(`${url}/en/compare`, {signal:AbortSignal.timeout(60000)});
  assert.equal(comparisonPage.status, 200, 'Candidate comparison page failed; existing traffic stays unchanged');
  const comparisonHtml = await comparisonPage.text();
  assert(comparisonHtml.includes('Community comparisons') && comparisonHtml.includes('Colors &amp; style templates'), 'Candidate comparison controls are missing');
  const communityResponse = await request(`${url}/api/compare/community`, {signal:AbortSignal.timeout(60000)});
  assert.equal(communityResponse.status, 200, 'Candidate community query failed; check ranking index readiness before promotion');
  const community = await communityResponse.json();
  assert(Array.isArray(community.items), 'Candidate community response is invalid');
  // These requests must fail before any write, even on an empty community board.
  for (const path of ['/api/compare/community', `/api/compare/community/${'a'.repeat(64)}/vote`, `/api/compare/community/${'a'.repeat(64)}/comments`]) {
    const response = await request(`${url}${path}`, {method:'POST',signal:AbortSignal.timeout(60000)});
    assert.equal(response.status, 401, 'Candidate community write must require sign-in');
  }
  const preferences = await request(`${url}/api/preferences/compare`, {signal:AbortSignal.timeout(60000)});
  assert.equal(preferences.status, 401, 'Candidate comparison preferences must require sign-in');
  // Exercise the data path before promotion, not only an HTML shell/health check.
  const graphResponse=await request(`${url}/api/intelligence?theme=ai&section=universe`,{signal:AbortSignal.timeout(60000)});
  assert.equal(graphResponse.status,200,'Candidate graph failed; existing traffic stays unchanged');
  const graph=await graphResponse.json();
  assert(Array.isArray(graph.graph?.nodes)&&graph.graph.nodes.some(node=>node.kind==='COMPANY'),'Candidate graph has no companies');
  for (const [path, text] of [
    ['/en/industries?taxonomy=SIC&code=3674', 'Semiconductors &amp; Related Devices'],
    ['/zh-cn/industries?taxonomy=CNI&code=C08030101', '集成电路'],
    ['/en/investment-themes?node=ai.chips', 'Chips'],
  ]) {
    const response = await request(`${url}${path}`, {signal:AbortSignal.timeout(60000)});
    assert.equal(response.status, 200, `Candidate hierarchy ${path} failed`);
    const html = await response.text();
    assert(html.includes(text) && html.includes('category-title'), `Candidate hierarchy ${path} missing selected category`);
  }
  console.log(`Candidate ${revision} verified before traffic promotion.`);
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyCandidate({url:process.env.CANDIDATE_URL,revision:process.env.CANDIDATE_REVISION,commit:process.env.GIT_SHA})
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
