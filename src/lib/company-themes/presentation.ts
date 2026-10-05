import type { KnowledgeGraph } from '../knowledge-graph/model';
import { graphFromMarket, type MarketCompany, type MarketRelationship } from '../knowledge-graph/market-store';
import { graphSectors } from '../knowledge-graph/sectors';
import type { CompanyThemeId } from './model';
import type { ThemedCompany } from './model';

/** A view of canonical companies, never a second directory or inferred supplier graph. */
export function themedGraph(theme: Exclude<CompanyThemeId,'ai'>, companies: ThemedCompany[], relationships: MarketRelationship[] = []): KnowledgeGraph {
  const rows = companies.filter(company => company.themeMemberships?.[theme]?.status === 'PUBLISHED').map(company => {
    const member = company.themeMemberships![theme];
    const stageIds = [member.primarySector, ...(member.secondaryRoles ?? [])].map(id => `${theme}:${id}`);
    const sources = (member.sources ?? []).map((source, index) => ({id: `${theme}:${company.id}:${index}`, title: source.title, url: source.url, sourceDate: null}));
    return {...company, description: (member.sources ?? []).map(source => source.summary).filter(Boolean).join(' '), inGraph: {status: 'PUBLISHED', stageIds,
      stages: graphSectors(theme).filter(sector => sector.stages.some(stage => stageIds.includes(stage))).map((sector, order) => ({id:`stage:${sector.stages[0]}`, kind:'STAGE', order, label:sector.en, labels:{en:sector.en,'zh-CN':sector.zh}})),
      memberships: [], sources, order: 1000, asOf: member.reviewedAt,
    }} as MarketCompany;
  });
  const ids = new Set(rows.map(row => row.id));
  const reviewed = relationships.filter(edge => Array.isArray(edge.themeIds) && edge.themeIds.includes(theme) && ids.has(edge.source) && ids.has(edge.target));
  return graphFromMarket(rows, reviewed);
}

export const roboticsGraph = (companies: ThemedCompany[], relationships: MarketRelationship[] = []) => themedGraph('robotics',companies,relationships);
