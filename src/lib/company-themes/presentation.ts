import type { KnowledgeGraph } from '../knowledge-graph/model';
import { graphFromMarket, type MarketCompany, type MarketRelationship } from '../knowledge-graph/market-store';
import { catalogGraphSectors } from './catalog-graph';
import type { ThemeCatalog } from './catalog-model';
import { graphSectors } from '../knowledge-graph/sectors';
import type { CompanyThemeId } from './model';
import type { ThemedCompany } from './model';

/** A view of canonical companies, never a second directory or inferred supplier graph. */
export function themedGraph(theme: Exclude<CompanyThemeId,'ai'>, companies: ThemedCompany[], relationships: MarketRelationship[] = [], catalog?:ThemeCatalog): KnowledgeGraph {
  const sectors=catalog?catalogGraphSectors(catalog,theme):graphSectors(theme);
  const rows = companies.filter(company => company.themeMemberships?.[theme]?.status === 'PUBLISHED').map(company => {
    const member = company.themeMemberships![theme];
    const stageIds = member.assignments ? member.assignments.filter(item=>item.status==='PUBLISHED').map(item=>item.nodeId) : [member.primarySector, ...(member.secondaryRoles ?? [])].filter((id):id is string=>Boolean(id)).map(id => id.startsWith(`${theme}:`) || catalog?.some(node=>node.id===id) ? id : `${theme}:${id}`);
    const sources = (member.sources ?? []).map((source, index) => ({id: `${theme}:${company.id}:${index}`, title: source.title, titleTranslations: source.titleTranslations, url: source.url, sourceDate: null}));
    return {...company, description: (member.sources ?? []).map(source => source.summary).filter(Boolean).join(' '), descriptionTranslations: member.summaryTranslations, inGraph: {status: 'PUBLISHED', stageIds,
      stages: stageIds.map((stage,order)=>{const sector=sectors.find(sector=>sector.stages.includes(stage));return {id:`stage:${stage}`,kind:'STAGE',order,label:sector?.en??stage,labels:{en:sector?.en??stage,'zh-CN':sector?.zh??stage}};}),
      memberships: [], sources, order: 1000, asOf: member.reviewedAt,
    }} as MarketCompany;
  });
  const ids = new Set(rows.map(row => row.id));
  const reviewed = relationships.filter(edge => Array.isArray(edge.themeIds) && edge.themeIds.includes(theme) && ids.has(edge.source) && ids.has(edge.target));
  return graphFromMarket(rows, reviewed);
}

export const roboticsGraph = (companies: ThemedCompany[], relationships: MarketRelationship[] = []) => themedGraph('robotics',companies,relationships);
