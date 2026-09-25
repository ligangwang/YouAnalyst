import { industryTree, type TreeLayer } from './industry-tree';
import type { GraphNode, KnowledgeGraph } from './model';

export type ConnectedCompany = { company: GraphNode; connections: number; layer?: Pick<TreeLayer, 'id' | 'en' | 'zh' | 'color'> };

// Companies ranked by documented company-to-company relationships. Industry-role
// memberships (PARTICIPATES_IN) are not connections. Ties keep a stable name order.
export function mostConnectedCompanies(graph: KnowledgeGraph, limit = 10): ConnectedCompany[] {
  const companies = graph.nodes.filter(n => n.kind === 'COMPANY');
  const byId = new Map(companies.map(c => [c.id, c]));
  const counts = new Map<string, number>();
  for (const edge of graph.relationships) {
    if (edge.type === 'PARTICIPATES_IN' || edge.source === edge.target || !byId.has(edge.source) || !byId.has(edge.target)) continue;
    for (const id of [edge.source, edge.target]) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const layers = industryTree(companies);
  // The layer of a company's primary role, as the industry trees and sector colours use it.
  const layerOf = (company: GraphNode) => {
    const member = layers.filter(l => l.companies.some(c => c.id === company.id));
    const layer = member.find(l => (l.stages as readonly string[]).includes(company.stageIds?.[0] ?? '')) ?? member[0];
    return layer && { id: layer.id, en: layer.en, zh: layer.zh, color: layer.color };
  };
  return [...counts]
    .map(([id, connections]) => ({ company: byId.get(id)!, connections }))
    .sort((a, b) => b.connections - a.connections || (a.company.name ?? a.company.id).localeCompare(b.company.name ?? b.company.id))
    .slice(0, limit)
    .map(entry => ({ ...entry, layer: layerOf(entry.company) }));
}
