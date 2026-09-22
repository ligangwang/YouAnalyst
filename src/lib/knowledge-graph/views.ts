import type { GraphNode } from './model';
import { GRAPH_SECTORS, OTHER_SECTOR } from './sectors';

// Membership can span multiple supply-chain roles; primary color stays unchanged.
export function companySectors(company: Pick<GraphNode, 'stageIds'>) {
  const matches = GRAPH_SECTORS.filter(s => s.stages.some(stage => company.stageIds?.includes(stage)));
  return matches.length ? matches : [OTHER_SECTOR];
}
export type IndustryView = 'table' | 'tree' | 'graph';
export const isIndustryView = (value: unknown): value is IndustryView => ['table', 'tree', 'graph'].includes(String(value));
