import { companySector } from './sectors';
import type { GraphNode, KnowledgeGraph } from './model';

export type ConnectedCompany = { company: GraphNode; connections: number; layer?: ReturnType<typeof companySector> };

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
  return [...counts]
    .map(([id, connections]) => ({ company: byId.get(id)!, connections }))
    .sort((a, b) => b.connections - a.connections || (a.company.name ?? a.company.id).localeCompare(b.company.name ?? b.company.id))
    .slice(0, limit)
    .map(entry => ({ ...entry, layer: companySector(entry.company) }));
}
