import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

test('covered search and its count use the same current coverage universe', async () => {
  const fixture = { nodes: [
    { id: 'stage:compute', kind: 'STAGE', label: 'Compute' },
    { id: 'US:NVDA', kind: 'COMPANY', symbol: 'NVDA', name: 'NVIDIA', names: { en: 'NVIDIA', 'zh-CN': '英伟达' }, market: 'US', slug: 'nvidia' },
    { id: 'ORG:OPENAI', kind: 'COMPANY', symbol: '', name: 'OpenAI', market: 'GLOBAL', slug: 'openai' },
  ] };
  const bundle = await build({ entryPoints: ['src/app/api/tickers/search/route.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'coverage-fixture', setup(builder) {
    builder.onLoad({ filter: /[\\/]company-themes[\\/]service\.ts$/ }, () => ({ contents: 'export const loadCollectionUniverse = async () => fixture;', loader: 'js' }));
    builder.onLoad({ filter: /[\\/]firebase[\\/]admin\.ts$/ }, () => ({ contents: 'export const getAdminFirestore = () => { throw Error("Unexpected database read"); };', loader: 'js' }));
  } }] });
  const testModule = { exports: {} as { GET: (request: { nextUrl: URL }) => Promise<Response> } };
  new Function('fixture', 'require', 'module', bundle.outputFiles[0].text)(fixture, createRequire(import.meta.url), testModule);
  const search = async (q = '') => {
    const response = await testModule.exports.GET({ nextUrl: new URL(`https://example.com/api/tickers/search?${new URLSearchParams({ scope: 'covered', q })}`) });
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.deepEqual(await search(), { items: [], total: 2 });
  assert.deepEqual((await search('NVDA')).items.map((item: { id: string }) => item.id), ['US:NVDA']);
  assert.equal((await search('英伟达')).items[0].name, '英伟达');
  assert.equal((await search('OpenAI')).items[0].slug, 'openai');
  assert.deepEqual((await search('IBM')).items, []);
  fixture.nodes.push({ id: 'US:IBM', kind: 'COMPANY', symbol: 'IBM', name: 'IBM', market: 'US', slug: 'ibm' });
  assert.equal((await search()).total, 3);
  assert.equal((await search('IBM')).items[0].id, 'US:IBM');
});
