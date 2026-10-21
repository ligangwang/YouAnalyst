import { getAdminFirestore } from '../firebase/admin';
import { graphSectors } from '../knowledge-graph/sectors';
import { validateHierarchy, type HierarchyNode } from './model';
import ai from '../../../data/ai-supply-chain/ai-us.json';
import cn from '../../../data/ai-supply-chain/ai-cn-a.json';

// Compatibility catalog reflects existing graph stages, not unreviewed company assignments.
export function existingThemeHierarchy(): HierarchyNode[] {
  const nodes: HierarchyNode[] = [
    { id: 'ai', parentId: null, names: { en: 'Artificial Intelligence', 'zh-CN': '人工智能' }, order: 0 },
    { id: 'robotics', parentId: null, names: { en: 'Robotics', 'zh-CN': '机器人' }, order: 1 },
    { id: 'space', parentId: null, names: { en: 'Space', 'zh-CN': '航天' }, order: 2 },
  ];
  const layers = [
    ['applications', 'Applications', '应用', ['applications', 'edge']],
    ['models', 'Models', '模型', []],
    ['infrastructure', 'Infrastructure', '基础设施', ['cloud', 'datacenters', 'servers', 'networking', 'interconnect', 'optics', 'boards']],
    ['chips', 'Chips', '芯片', ['materials', 'equipment', 'design', 'foundry', 'packaging', 'compute', 'memory']],
    ['energy', 'Energy', '能源', ['power', 'cooling', 'energy']],
  ] as const;
  layers.forEach(([id, en, zh, stages], order) => {
    nodes.push({ id: `ai.${id}`, parentId: 'ai', names: { en, 'zh-CN': zh }, order });
    stages.forEach((stage, order) => {
      const source = ai.nodes.find(node => node.id === `stage:${stage}`);
      if (source && stage !== id) nodes.push({ id: `ai.${id}.${stage}`, parentId: `ai.${id}`,
        names: { en: source.label ?? stage, 'zh-CN': cn.nodes.find(node => node.id === source.id)?.label ?? source.label ?? stage }, order });
    });
  });
  for (const theme of ['robotics', 'space']) graphSectors(theme).forEach((sector, order) => {
    nodes.push({ id: `${theme}.${sector.id}`, parentId: theme, names: { en: sector.en, 'zh-CN': sector.zh }, order });
  });
  return validateHierarchy(nodes);
}

let cached: HierarchyNode[] | undefined;
let nextRefresh = 0;
let pending: Promise<HierarchyNode[]> | undefined;

/** One bounded catalog read per minute per process, shared by concurrent requests. No writes. */
export async function investmentThemeHierarchy(): Promise<HierarchyNode[]> {
  if (cached && Date.now() < nextRefresh) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const snapshot = await getAdminFirestore().collection('investment_themes').where('status', '==', 'PUBLISHED')
        .select('parentId', 'names', 'descriptions', 'order', 'isDeleted').limit(2001).get();
      if (snapshot.size > 2000) throw new Error('Investment theme catalog exceeds safe size');
      const nodes = snapshot.docs.filter(doc => doc.data().isDeleted !== true).map(doc => {
        const data = doc.data();
        return { id: doc.id, parentId: data.parentId, names: data.names,
          ...(data.descriptions ? { descriptions: data.descriptions } : {}), order: data.order } as HierarchyNode;
      });
      cached = nodes.length ? validateHierarchy(nodes) : existingThemeHierarchy();
    } catch {
      // Keep the last valid catalog available through an outage or incomplete edit.
      console.warn('Investment theme catalog unavailable; retaining compatibility catalog');
      cached ??= existingThemeHierarchy();
    }
    nextRefresh = Date.now() + 60_000;
    return cached;
  })();
  try { return await pending; } finally { pending = undefined; }
}
