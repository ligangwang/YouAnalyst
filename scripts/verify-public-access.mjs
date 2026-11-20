import assert from 'node:assert/strict';
import {taggedReleaseRequest} from './tagged-release-request.mjs';
export async function verifyPublicAccess(url) {
  for (const locale of ['en','zh-cn']) {
    const home=await taggedReleaseRequest(`${url}/${locale}`,{});
    assert.equal(home.status,200,'Public homepage unavailable');
    const html=await home.text();assert(html.includes('home-introduction') && !html.includes('<canvas'),'Homepage preview missing');
    for(const path of [`/${locale}/company/nvidia`,`/${locale}/compare`,`/${locale}?view=graph`]) {
      const response=await taggedReleaseRequest(new URL(path,url),{redirect:'manual'});
      assert.equal(response.status,307,`Anonymous research page was not gated: ${path}`);
      assert.equal(new URL(response.headers.get('location'),url).pathname,'/auth');
    }
  }
  for(const agent of ['Mozilla/5.0','Googlebot/2.1','bingbot/2.0','GoogleOther']) {
    const response=await taggedReleaseRequest(`${url}/api/intelligence`,{headers:{'user-agent':agent,'x-forwarded-for':'66.249.66.1, 136.68.216.55'}});
    assert.equal(response.status,401,`Unverified ${agent} accessed research`);
    assert.match(response.headers.get('cache-control'),/no-store/);
  }
  const search=await taggedReleaseRequest(`${url}/api/public/companies?q=NVDA`,{});
  assert.equal(search.status,200);assert((await search.json()).items.some(item=>item.symbol==='NVDA'));
  console.log('Public previews and anonymous/spoofed crawler denial verified.');
}
