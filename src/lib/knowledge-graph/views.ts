import type { GraphNode } from './model';
import { GRAPH_SECTORS, ROBOTICS_GRAPH_SECTORS, OTHER_SECTOR } from './sectors';

// Membership can span multiple supply-chain roles; primary color stays unchanged.
export function companySectors(company: Pick<GraphNode, 'stageIds'>) {
  const matches = [...GRAPH_SECTORS, ...ROBOTICS_GRAPH_SECTORS].filter(s => s.stages.some(stage => company.stageIds?.includes(stage)));
  return matches.length ? matches : [OTHER_SECTOR];
}
export type IndustryView = 'table' | 'tree' | 'graph' | 'hierarchy';
export const INDUSTRY_VIEWS: readonly IndustryView[] = ['graph', 'tree', 'hierarchy', 'table'];
export const isIndustryView = (value: unknown): value is IndustryView => INDUSTRY_VIEWS.includes(value as IndustryView);
// Keep old vertical-tree links and saved preferences working with the Tree tab.
export const LEGACY_VERTICAL_VIEW = 'vertical';
export function parseIndustryView(value: unknown): IndustryView | undefined {
  if (value === LEGACY_VERTICAL_VIEW) return 'tree';
  return isIndustryView(value) ? value : undefined;
}
