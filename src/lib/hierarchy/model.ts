export type HierarchyNode = {
  id: string;
  parentId: string | null;
  names: { en: string; 'zh-CN': string };
  descriptions?: { en: string; 'zh-CN': string };
  order: number;
  code?: string;
};

export function validateHierarchy(nodes: HierarchyNode[]): HierarchyNode[] {
  const index = new Map<string, HierarchyNode>();
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || !node.id || index.has(node.id)
      || !(node.parentId === null || typeof node.parentId === 'string')
      || typeof node.names?.en !== 'string' || !node.names.en.trim()
      || typeof node.names?.['zh-CN'] !== 'string' || !node.names['zh-CN'].trim()
      || !Number.isFinite(node.order)
      || (node.descriptions !== undefined && (typeof node.descriptions?.en !== 'string' || !node.descriptions.en.trim() || typeof node.descriptions?.['zh-CN'] !== 'string' || !node.descriptions['zh-CN'].trim())))
      throw new Error('Invalid hierarchy node');
    index.set(node.id, node);
  }
  for (const node of nodes) {
    const seen = new Set<string>();
    let current: HierarchyNode | undefined = node;
    while (current) {
      if (seen.has(current.id)) throw new Error('Hierarchy cycle');
      seen.add(current.id);
      if (current.parentId === null) break;
      current = index.get(current.parentId);
      if (!current) throw new Error('Missing hierarchy parent');
    }
  }
  return nodes;
}

export function hierarchyPath(nodes: HierarchyNode[], id: string): HierarchyNode[] {
  const index = new Map(nodes.map(node => [node.id, node]));
  const path: HierarchyNode[] = [], seen = new Set<string>();
  let node = index.get(id);
  while (node && !seen.has(node.id)) {
    path.unshift(node); seen.add(node.id);
    node = node.parentId === null ? undefined : index.get(node.parentId);
  }
  return path;
}

export function hierarchyHref(kind: 'industries' | 'investment-themes', id: string) {
  if (kind === 'investment-themes') return `/investment-themes?node=${encodeURIComponent(id)}`;
  const separator = id.indexOf(':');
  const taxonomy = separator < 0 ? id : id.slice(0, separator);
  const code = separator < 0 ? '' : id.slice(separator + 1);
  return `/industries?taxonomy=${encodeURIComponent(taxonomy)}${code ? `&code=${encodeURIComponent(code)}` : ''}`;
}
