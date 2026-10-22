import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { industryPath } from '../../src/lib/industry-classification/catalog';
import type { HierarchyNode } from '../../src/lib/hierarchy/model';

const require = createRequire(import.meta.url);
require.extensions['.css'] = module => { module.exports = {}; };
const { CompanyClassificationsView } = require('../../src/components/company-classifications-view') as typeof import('../../src/components/company-classifications-view');
const { LocaleProvider } = require('../../src/components/providers/locale-provider') as typeof import('../../src/components/providers/locale-provider');
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

test('empty and unavailable classifications also use the active locale', () => {
  const render = (unavailable = false) => renderToStaticMarkup(<LocaleProvider locale="zh-CN"><CompanyClassificationsView unavailable={unavailable} /></LocaleProvider>);
  assert.match(render(), /尚未分类/);
  assert.match(render(), /暂无已发布的主题分类/);
  assert.match(render(true), /分类信息暂时无法加载/);
});
