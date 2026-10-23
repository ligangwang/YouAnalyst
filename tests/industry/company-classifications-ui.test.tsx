import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { initialSnapshotWithinBudget } from '../../src/lib/intelligence/initial-snapshot';
import { industryPath } from '../../src/lib/industry-classification/catalog';
import type { HierarchyNode } from '../../src/lib/hierarchy/model';
import themeSeed from '../../data/investment-themes/catalog-v1.json';

const require = createRequire(import.meta.url);
require.extensions['.css'] = module => { module.exports = {}; };
const { CompanyClassificationsView } = require('../../src/components/company-classifications-view') as typeof import('../../src/components/company-classifications-view');
const { LocaleProvider } = require('../../src/components/providers/locale-provider') as typeof import('../../src/components/providers/locale-provider');
const { HierarchyBrowser } = require('../../src/components/hierarchy-browser') as typeof import('../../src/components/hierarchy-browser');
const industries = [{ taxonomy: 'SIC', code: '3674', names: {
  en: industryPath('SIC', '3674', 'en').at(-1)!.name,
  'zh-CN': industryPath('SIC', '3674', 'zh-CN').at(-1)!.name,
} }];
const themePaths: HierarchyNode[][] = [[
  { id: 'robotics', parentId: null, names: { en: 'Robotics', 'zh-CN': '机器人' }, order: 0 },
  { id: 'robotics.compute-control', parentId: 'robotics', names: { en: 'Compute & control', 'zh-CN': '算力与控制' }, order: 0 },
]];

test('classification labels, names and links follow the profile locale', () => {
  for (const locale of ['zh-CN', 'en', 'zh-CN'] as const) {
    const html = renderToStaticMarkup(<LocaleProvider locale={locale}><CompanyClassificationsView industries={industries} themePaths={themePaths} /></LocaleProvider>);
    const zh = locale === 'zh-CN';
    for (const label of zh ? ['行业分类', '投资主题', '半导体及相关器件', '机器人', '算力与控制'] : ['Industry', 'Investment themes', 'Semiconductors &amp; Related Devices', 'Robotics', 'Compute &amp; control']) assert.ok(html.includes(label), label);
    assert.ok(html.includes(`href="/${zh ? 'zh-cn' : 'en'}/industries?taxonomy=SIC&amp;code=3674"`));
    assert.ok(html.includes(`href="/${zh ? 'zh-cn' : 'en'}/investment-themes?node=robotics.compute-control"`));
    assert.ok(html.includes('SIC 3674'));
    if (zh) assert.doesNotMatch(html, /Industry|Investment themes|Semiconductors|Robotics|Compute &amp; control/);
  }
});

test('theme structure descriptions render in the active language without an English fallback',()=>{
  const ai=themeSeed.nodes.find(node=>node.id==='ai')!;
  for(const locale of ['en','zh-CN'] as const){
    const html=renderToStaticMarkup(<LocaleProvider locale={locale}><HierarchyBrowser kind="investment-themes" nodes={themeSeed.nodes} selectedId="ai" /></LocaleProvider>);
    assert.ok(html.includes(ai.descriptions![locale]));
    assert.ok(!html.includes(ai.descriptions![locale==='en'?'zh-CN':'en']));
  }
});

test('empty and unavailable classifications also use the active locale', () => {
  const render = (unavailable = false) => renderToStaticMarkup(<LocaleProvider locale="zh-CN"><CompanyClassificationsView unavailable={unavailable} /></LocaleProvider>);
  assert.match(render(), /尚未分类/);
  assert.match(render(), /暂无已发布的主题分类/);
  assert.match(render(true), /分类信息暂时无法加载/);
});

test('catalog outages preserve industry classifications and distinguish unavailable themes from empty assignments', () => {
  for (const locale of ['en', 'zh-CN'] as const) {
    const html = renderToStaticMarkup(<LocaleProvider locale={locale}><CompanyClassificationsView industries={industries} themesUnavailable /></LocaleProvider>);
    assert.match(html, /SIC 3674/);
    assert.ok(html.includes(locale === 'en' ? 'Investment themes are temporarily unavailable.' : '投资主题暂时无法加载。'));
    assert.doesNotMatch(html, /No published theme assignments yet|暂无已发布的主题分类/);
  }
});

test('profile classifications survive rejected and stalled catalog reads without losing industry labels', async () => {
  const external = ['@/lib/firebase/admin', '@/lib/company-document-cache', '@/lib/hierarchy/investment-themes', '@/lib/intelligence/initial-snapshot', './company-classifications-view'];
  const bundle = await build({ entryPoints: ['src/components/company-classifications.tsx'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', external, jsx: 'automatic' });
  for (const load of [() => Promise.reject(new Error('Unavailable')), () => new Promise(() => {})]) {
    const evaluated = { exports: {} as { CompanyClassifications: (props: unknown) => Promise<React.ReactElement<{industries: unknown[]; themesUnavailable: boolean}>> } };
    const injected = (name: string) => {
      if (name === '@/lib/firebase/admin' || name === '@/lib/company-document-cache') return {};
      if (name === '@/lib/hierarchy/investment-themes') return { investmentThemeHierarchy: load };
      if (name === '@/lib/intelligence/initial-snapshot') return { initialSnapshotWithinBudget: (request: Promise<unknown>) => initialSnapshotWithinBudget(request, 10) };
      if (name === './company-classifications-view') return { CompanyClassificationsView };
      return require(name);
    };
    new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(injected, evaluated, evaluated.exports);
    const result = await evaluated.exports.CompanyClassifications({ companyId: 'US:TEST', data: {taxonomy: 'SIC', classification: ['3674']} });
    assert.equal(result.props.themesUnavailable, true);
    assert.equal(result.props.industries.length, 1);
  }
});
