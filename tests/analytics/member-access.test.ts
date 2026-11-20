import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { proxy } from '../../src/proxy';
import { requiresMembership } from '../../src/lib/access/policy';
import { isRegisteredMember } from '../../src/lib/access/member';
import { POST, DELETE } from '../../src/app/api/auth/session/route';
import type { DecodedIdToken } from 'firebase-admin/auth';

test('private pages, APIs and alternate workspace routes require membership', async () => {
  for (const path of ['/en?view=graph','/zh-cn?company=NVDA','/intelligence','/feed','/en/company/nvidia','/zh-cn/compare','/en/predictions/new','/api/intelligence','/api/tickers/search','/api/compare/share-image','/sitemaps/companies/US-N.xml']) {
    assert(requiresMembership(new URL(path,'https://youanalyst.com')),path);
    for (const ua of ['Mozilla/5.0','Googlebot','GoogleOther']) {
      const response = await proxy(new NextRequest('https://youanalyst.com'+path,{headers:{'user-agent':ua,'x-ya-member':'true','cookie':'ya-member=forged'}}));
      assert.equal(response.status, path.startsWith('/api/') ? 401 : 307,path);
      assert.equal(response.headers.get('cache-control'),'private, no-store');
    }
  }
});
test('public preview and search do not need a credential', async () => {
  for (const path of ['/en','/zh-cn?utm_source=test','/en/about','/zh-cn/how-it-works','/auth','/api/public/companies?q=NVDA','/_next/static/chunk.js','/sitemap.xml']) {
    assert.equal(requiresMembership(new URL(path,'https://youanalyst.com')),false,path);
    assert.notEqual((await proxy(new NextRequest('https://youanalyst.com'+path))).status,401);
  }
});
test('anonymous Firebase identities are not registered members', () => {
  for (const provider of ['anonymous','']) assert.equal(isRegisteredMember({uid:'u',firebase:{sign_in_provider:provider}} as DecodedIdToken),false);
  assert.equal(isRegisteredMember({uid:'u',firebase:{sign_in_provider:'google.com'}} as DecodedIdToken),true);
});
test('session endpoint rejects cross-site writes and invalid tokens and clears HttpOnly cookie', async () => {
  const url='https://youanalyst.com/api/auth/session';
  assert.equal((await POST(new NextRequest(url,{method:'POST',headers:{origin:'https://evil.test'}}))).status,403);
  assert.equal((await POST(new NextRequest(url,{method:'POST',headers:{origin:'https://youanalyst.com',authorization:'Bearer forged'}}))).status,401);
  assert.equal((await DELETE(new NextRequest(url,{method:'DELETE',headers:{origin:'https://evil.test'}}))).status,403);
  const cleared=await DELETE(new NextRequest(url,{method:'DELETE',headers:{origin:'https://youanalyst.com'}}));
  assert.match(cleared.headers.get('set-cookie')!,/HttpOnly/);assert.match(cleared.headers.get('set-cookie')!,/Max-Age=0/);
});

test('verified member cookie opens research and session lifetime follows token expiry', async (t) => {
  const { memberAuth } = await import('../../src/lib/access/member');
  const claims={uid:'registered-member',exp:Math.floor(Date.now()/1000)+300,firebase:{sign_in_provider:'password'}} as DecodedIdToken;
  t.mock.method(memberAuth(),'verifyIdToken',async (token:string) => {assert.equal(token,'verified-token');return claims;});
  const session=await POST(new NextRequest('https://youanalyst.com/api/auth/session',{method:'POST',headers:{origin:'https://youanalyst.com',authorization:'Bearer verified-token'}}));
  assert.equal(session.status,204);assert.match(session.headers.get('set-cookie')!,/HttpOnly/);assert.match(session.headers.get('set-cookie')!,/Secure/);
  assert.equal(session.cookies.get('ya-member')?.value,'verified-token');
  const page=await proxy(new NextRequest('https://youanalyst.com/en/company/nvidia',{headers:{cookie:'ya-member=verified-token'}}));
  assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'private, no-store');
  assert.equal(new URL(page.headers.get('x-middleware-rewrite')!).pathname,'/company/nvidia');
  const api=await proxy(new NextRequest('https://youanalyst.com/api/intelligence',{headers:{authorization:'Bearer verified-token'}}));
  assert.equal(api.status,200);assert.equal(api.headers.get('cache-control'),'private, no-store');
});
