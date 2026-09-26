import type { GraphNode } from './model';
import { GRAPH_SECTORS, OTHER_SECTOR } from './sectors';

// Membership can span multiple supply-chain roles; primary color stays unchanged.
export function companySectors(company: Pick<GraphNode, 'stageIds'>) {
  const matches = GRAPH_SECTORS.filter(s => s.stages.some(stage => company.stageIds?.includes(stage)));
  return matches.length ? matches : [OTHER_SECTOR];
}
export type IndustryView = 'table' | 'tree' | 'graph';
export const INDUSTRY_VIEWS: readonly IndustryView[] = ['graph', 'tree', 'table'];
export const isIndustryView = (value: unknown): value is IndustryView => INDUSTRY_VIEWS.includes(value as IndustryView);
// The vertical tree used to be its own tab; it now leads the merged industry-structure page,
// so old links and saved preferences for 'vertical' open that page.
export const LEGACY_VERTICAL_VIEW = 'vertical';
export function parseIndustryView(value: unknown): IndustryView | undefined {
  if (value === LEGACY_VERTICAL_VIEW) return 'tree';
  return isIndustryView(value) ? value : undefined;
}
