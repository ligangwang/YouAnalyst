import { test, expect } from '@playwright/test';
// Deliberately use a fresh anonymous client: release service credentials must
// never accidentally turn these denial checks into authenticated probes.
test('public visitors can search previews but cannot load research in either language', async ({playwright,baseURL}) => {
  const client=await playwright.request.newContext({baseURL});
  try {
    for(const path of ['/en/company/nvidia','/zh-cn/company/nvidia','/en/compare','/zh-cn/compare','/en?view=graph','/zh-cn/predictions/new']) {
      const response=await client.get(path,{maxRedirects:0});
      expect(response.status(),path).toBe(307);
      expect(new URL(response.headers().location,baseURL).pathname).toBe('/auth');
      expect(response.headers()['cache-control']).toContain('no-store');
    }
    for(const path of ['/api/intelligence','/api/company-relationships?company=US:NVDA','/api/compare','/api/tickers/search?q=NVDA']) {
      const response=await client.get(path,{headers:{'user-agent':'Googlebot'}});
      expect(response.status(),path).toBe(401);
      expect(await response.json()).toEqual({error:'Sign in to access member content.'});
    }
    const search=await client.get('/api/public/companies?q=NVDA');
    expect(search.status()).toBe(200);
    const results=await search.json();expect(results.items[0].symbol).toBe('NVDA');
    expect(Object.keys(results.items[0]).sort()).toEqual(['id','name','path','symbol']);
  } finally { await client.dispose(); }
});
