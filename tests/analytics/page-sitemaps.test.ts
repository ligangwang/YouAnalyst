import { test } from 'node:test';
import assert from 'node:assert/strict';
import sitemap from '../../src/app/sitemaps/pages/sitemap';

test('public sitemap contains only bilingual landing and product pages', () => {
  const entries=sitemap();
  assert.deepEqual(entries.map(entry=>new URL(entry.url).pathname).sort(),['/en','/en/about','/en/how-it-works','/zh-cn','/zh-cn/about','/zh-cn/how-it-works'].sort());
  for(const entry of entries) {
    assert.ok(entry.alternates?.languages?.en);
    assert.ok(entry.alternates?.languages?.['zh-CN']);
  }
});
