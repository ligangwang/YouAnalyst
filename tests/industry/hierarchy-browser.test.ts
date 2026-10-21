import { test } from 'node:test';
import assert from 'node:assert/strict';
import { industryHierarchy } from '../../src/lib/hierarchy/industries';
import { hierarchyHref, hierarchyPath, validateHierarchy } from '../../src/lib/hierarchy/model';
import { isLocalizedPage, languageUrl } from '../../src/lib/ui/i18n/urls';
import { companyThemeNodeIds } from '../../src/lib/hierarchy/company-memberships';

test('SIC and CNI codes remain separate and deep links preserve leading zeros', () => {
  const nodes = industryHierarchy();
  assert.equal(hierarchyPath(nodes, 'SIC:3674').at(-1)?.names.en, 'Semiconductors & Related Devices');
  assert.equal(hierarchyPath(nodes, 'SIC:3674')[0].id, 'SIC');
  assert.equal(hierarchyHref('industries', 'SIC:0111'), '/industries?taxonomy=SIC&code=0111');
  assert.equal(hierarchyHref('investment-themes', 'ai.chips'), '/investment-themes?node=ai.chips');
  assert.deepEqual(hierarchyPath(nodes, 'SIC:unknown'), []);
});

test('invalid published catalogs cannot introduce cycles or dangling parents', () => {
  const node = { id: 'ai', parentId: null, names: { en: 'AI', 'zh-CN': '人工智能' }, order: 0 };
  assert.throws(() => validateHierarchy([node, node]));
  assert.throws(() => validateHierarchy([{ ...node, parentId: 'missing' }]));
  assert.throws(() => validateHierarchy([{ ...node, parentId: 'ai' }]));
});

test('locale switching preserves selected industry and theme', () => {
  for (const path of ['/industries?taxonomy=SIC&code=3674', '/investment-themes?node=ai.chips']) {
    const url = new URL(path, 'https://youanalyst.com');
    assert.ok(isLocalizedPage(url.pathname));
    const localized = languageUrl(url, 'zh-CN');
    assert.equal(localized.search, url.search);
    assert.equal(localized.pathname, `/zh-cn${url.pathname}`);
  }
});

test('company links include published assignments and legacy roles, excluding unknown or withdrawn assignments', () => {
  const nodes = ['ai', 'ai.chips', 'robotics', 'robotics.compute-control'].map((id, order) => ({ id, parentId: id.includes('.') ? id.split('.')[0] : null, names: { en: id, 'zh-CN': id }, order }));
  const result = companyThemeNodeIds({ themeMemberships: {
    ai: { status: 'PUBLISHED', assignments: [{nodeId:'ai.chips',status:'PUBLISHED'}, {nodeId:'missing',status:'PUBLISHED'}] },
    robotics: { status: 'PUBLISHED', primarySector: 'compute-control' },
    space: {status:'WITHDRAWN'},
  } }, nodes);
  assert.deepEqual(new Set(result), new Set(['ai', 'ai.chips', 'robotics', 'robotics.compute-control']));
  assert.deepEqual(companyThemeNodeIds({themeMemberships:{ai:{status:'DRAFT',assignments:[{nodeId:'ai.chips',status:'PUBLISHED'}]}}},nodes), []);
});
