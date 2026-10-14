import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { companyPinyinTerms } from '../../src/lib/market-companies/pinyin-search';
import { companyFields } from '../../src/lib/market-companies/model';

test('pinyin indexes Chinese names, aliases, polyphonic names and initials with bounded entries', () => {
  const terms = companyPinyinTerms({ name: '贵州茅台', names: { en: 'Kweichow Moutai' }, aliases: ['茅台', '重庆银行'] });
  for (const term of ['guizhoumaotai', 'gzmt', 'maotai', 'chongqingyinhang', 'cqyh']) assert(terms.includes(term), term);
  const fields=companyFields('XSHG:600519',{name:'贵州茅台',aliases:['茅台','重庆银行']});
  for (const query of ['guizhou', 'gz', 'maotai', 'mt']) assert(fields.searchPrefixes.includes(query), query);
  assert(fields.searchPrefixes.length <= 6000);
  assert.deepEqual(companyPinyinTerms({ name: 'Microsoft' }), []);
  assert(companyFields('US:NVDA', { name: 'NVIDIA', names: { 'zh-CN': '英伟达' } }).searchPrefixes.includes('ywd'));
});

test('public indexed search resolves Chinese, full pinyin, initials, English and codes without scanning the directory', async () => {
  const row = (id: string, name: string, names = {}) => ({ id, data: () => ({ ...companyFields(id, { name, names }), names, status: 'PUBLISHED', active: true, predictionSupported: true }) });
  const docs = [row('US:NVDA', 'NVIDIA Corporation', { 'zh-CN': '英伟达' }), row('US:MSFT', 'Microsoft', { 'zh-CN': '微软' }), row('XSHG:600519', '贵州茅台', { en: 'Kweichow Moutai' }), row('US:TSM', 'Taiwan Semiconductor Manufacturing Company Limited'), row('US:T', 'AT&T Inc.')];
  const queries: string[] = [];
  const fixture = { db: { collection: () => ({ select(...fields:string[]){ assert(fields.includes('searchTerms'));assert(!fields.includes('searchPrefixes'));return this; },
    where: (field:string, op:string, value:string) => {
      const filters=[{field,op,value}];
      const query={where:(field:string,op:string,value:string)=>{filters.push({field,op,value});return query;},limit:(limit:number)=>({get:async()=>{
        queries.push(field);assert(limit<=50);
        assert(['symbolLower','searchPrefixes'].includes(field));
        return {docs:docs.filter(doc=>filters.every(({field,op,value})=>{
          const actual=doc.data()[field as keyof ReturnType<typeof doc.data>] as unknown as string | string[];
          return op==='array-contains'?(actual as string[]??[]).includes(value):op==='>='?actual>=value:op==='<='?actual<=value:actual===value;
        }))};
      }})};return query;
    },
    doc: () => ({ get: async () => ({ exists: true }) }),
  }) } };
  const bundle = await build({ entryPoints: ['src/app/api/tickers/search/route.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'search-db', setup(builder) {
    builder.onLoad({ filter: /[\\/]firebase[\\/]admin\.ts$/ }, () => ({ contents: 'export const getAdminFirestore = () => fixture.db;', loader: 'js' }));
  } }] });
  const testModule = { exports: {} as { GET: (request: { nextUrl: URL }) => Promise<Response> } };
  new Function('fixture', 'require', 'module', bundle.outputFiles[0].text)(fixture, createRequire(import.meta.url), testModule);
  for (const [q, expected] of [['英伟达', 'US:NVDA'], ['yingweida', 'US:NVDA'], ['ying wei da', 'US:NVDA'], ['YWD', 'US:NVDA'], ['nvidia', 'US:NVDA'], ['$nvda', 'US:NVDA'], ['微软', 'US:MSFT'], ['weiruan', 'US:MSFT'], ['wr', 'US:MSFT'], ['Microsoft', 'US:MSFT'], ['600519', 'XSHG:600519'], ['gzmt', 'XSHG:600519'], ['Kweichow Moutai', 'XSHG:600519'], ['Taiwan Semiconductor Manufacturing Company Limited', 'US:TSM'], ['AT&T Inc.', 'US:T']]) {
    queries.length = 0;
    const response = await testModule.exports.GET({ nextUrl: new URL('https://example.test/api/tickers/search?' + new URLSearchParams({ q, scope: 'all' })) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).items[0]?.id, expected, q);
    assert(queries.length <= 3);
  }
});

test('long legal names preserve localized names and alias search prefixes', () => {
  const legalName = Array.from({length: 140}, (_, i) => String.fromCharCode(0x4e00 + i)).join('');
  const localizedName = String.fromCharCode(0x793a, 0x4f8b, 0x516c, 0x53f8);
  const fields = companyFields('US:TEST', {name: 'Example', legalName, names: {'zh-CN': localizedName}, aliases: ['SpecialAlias']});
  assert(fields.searchPrefixes.includes('specialalias'));
  assert(fields.searchPrefixes.includes(localizedName));
  assert(fields.searchPrefixes.length <= 6000);
});
