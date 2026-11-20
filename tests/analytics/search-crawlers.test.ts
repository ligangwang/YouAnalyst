import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawlerClientIp, crawlerEngine, crawlerRanges, crawlerResearchPath, verifiedSearchCrawler } from '../../src/lib/access/crawlers';

test('crawler IP comes only from the canonical load balancer suffix', () => {
  const headers=(xff:string,host='youanalyst.com')=>new Headers({host,'x-forwarded-for':xff});
  assert.equal(crawlerClientIp(headers('66.249.66.1, 198.51.100.8, 136.68.216.55')),'198.51.100.8');
  assert.equal(crawlerClientIp(headers('66.249.66.1, 136.68.216.55')),'66.249.66.1');
  assert.equal(crawlerClientIp(headers('66.249.66.1, 136.68.216.55, 198.51.100.8')),null);
  assert.equal(crawlerClientIp(headers('66.249.66.1, 136.68.216.55','candidate.run.app')),null);
  assert.equal(crawlerClientIp(headers('66.249.66.1')),null);
});
test('only search crawlers qualify, with explicit IPv4 and IPv6 range matching', () => {
  assert.equal(crawlerEngine('Googlebot/2.1'),'google');assert.equal(crawlerEngine('bingbot/2.0'),'bing');
  for(const ua of ['GoogleOther','AdsBot-Google','GPTBot/1.0','Mozilla/5.0'])assert.equal(crawlerEngine(ua),null);
  const ranges=crawlerRanges([{ipv4Prefix:'66.249.66.0/24'},{ipv6Prefix:'2001:db8::/32'}]);
  assert(ranges.check('66.249.66.1','ipv4'));assert(!ranges.check('66.249.67.1','ipv4'));assert(ranges.check('2001:db8::1','ipv6'));
});
test('verified search crawler gets research reads, never account areas or writes',async(t)=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({prefixes:[{ipv4Prefix:'66.249.66.0/24'}]}));
  const req={method:'GET',nextUrl:new URL('https://youanalyst.com/en/company/nvidia'),headers:new Headers({host:'youanalyst.com','user-agent':'Googlebot/2.1','x-forwarded-for':'66.249.66.1, 136.68.216.55'})};
  assert.equal(await verifiedSearchCrawler(req),true);
  assert.equal(await verifiedSearchCrawler({...req,method:'POST'}),false);
  for(const path of ['/admin','/watchlists','/analysts/me','/api/knowledge-graph/saved','/api/users/bootstrap','/api/preferences','/api/predictions']){
    assert.equal(crawlerResearchPath(new URL(path,req.nextUrl)),false,path);
    assert.equal(await verifiedSearchCrawler({...req,nextUrl:new URL(path,req.nextUrl)}),false);
  }
  req.headers.set('x-forwarded-for','66.249.66.1, 198.51.100.1, 136.68.216.55');
  assert.equal(await verifiedSearchCrawler(req),false);
});
