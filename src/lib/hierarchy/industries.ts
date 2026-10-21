import { taxonomyCatalog } from '../industry-classification/catalog';
import { validateHierarchy, type HierarchyNode } from './model';

export function industryHierarchy(): HierarchyNode[] {
  return validateHierarchy((['SIC', 'CNI'] as const).flatMap(taxonomy => [
    { id: taxonomy, parentId: null, names: { en: taxonomy, 'zh-CN': taxonomy }, order: taxonomy === 'SIC' ? 0 : 1 },
    ...taxonomyCatalog(taxonomy).nodes.map((node, order) => ({
      id: `${taxonomy}:${node.code}`, code: node.code,
      parentId: node.parentCode ? `${taxonomy}:${node.parentCode}` : taxonomy,
      names: { en: node.translations.en!, 'zh-CN': node.translations['zh-CN']! }, order,
    })),
  ]));
}
