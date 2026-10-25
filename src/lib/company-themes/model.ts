import type { GraphNode, KnowledgeGraph } from '../knowledge-graph/model';
import { companyGeography } from '../market-companies/identity';

export type CompanyThemeId = string;
export function parseCompanyTheme(value: unknown): CompanyThemeId {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(value) ? value : 'ai';
}
export const SPACE_SECTORS = ['components','spacecraft','payloads','launch','ground','operators','applications','orbital-services'] as const;
export const ROBOTICS_SECTORS = [
  'compute-control', 'sensors-vision', 'motion-mechanics', 'grippers-tools',
  'software-simulation', 'robot-manufacturers', 'systems-integration',
] as const;
export type ThemeMembership = {
  assignments?: {nodeId:string;status:'PUBLISHED'|'DRAFT'|'WITHDRAWN'}[];
  summaryTranslations?: Partial<Record<'zh-CN', import('../knowledge-graph/summary-translations').SummaryTranslation>>;
  status: 'PUBLISHED' | 'DRAFT' | 'WITHDRAWN'; primarySector: string;
  secondaryRoles?: string[]; reviewedAt: string;
  sources?: { url: string; title: string; titleTranslations?: Partial<Record<"zh-CN", import("../knowledge-graph/summary-translations").SummaryTranslation>>; summary: string }[];
};
export type ThemedCompany = Record<string, unknown> & {
  id: string; themeIds?: string[]; themeMemberships?: Record<string, ThemeMembership>;
  onboarding?: import('../company-support/model').CompanyOnboarding;
};

/** The array is a query index; membership status remains authoritative. */
export function activeThemeIds(company: Pick<ThemedCompany, 'themeMemberships'>) {
  return Object.entries(company.themeMemberships ?? {})
    .filter(([, membership]) => membership?.status === 'PUBLISHED')
    .map(([id]) => id).sort();
}
export function isCollectionCompany(company: ThemedCompany, allowedThemes?:readonly string[]) {
  if (!['PUBLISHED', 'DIRECTORY'].includes(String(company.status)) || !company.name) return false;
  if (activeThemeIds(company).some(id=>!allowedThemes || allowedThemes.includes(id))) return true;
  // Compatibility for existing AI records until memberships have been migrated.
  const legacy = (company.inGraph) as { status?: string } | undefined;
  return (!allowedThemes || allowedThemes.includes('ai')) && !company.themeMemberships?.ai && legacy?.status === 'PUBLISHED';
}

/** Theme presentation compatibility only. Regular jobs use company-support/service. */
export function collectionUniverse(legacy: KnowledgeGraph, records: ThemedCompany[], allowedThemes?:readonly string[]): KnowledgeGraph {
  const byId = new Map(records.map(company => [company.id, company]));
  const companies = new Map(legacy.nodes.filter(node => {
    if (node.kind !== 'COMPANY') return false;
    const company = byId.get(node.id);
    // Missing membership records can be relationship-only neighbors. An explicit
    // AI decision overrides its legacy graph flag, unless another theme enrolls it.
    return (!allowedThemes || allowedThemes.includes('ai')) && !company?.themeMemberships?.ai || Boolean(company && isCollectionCompany(company,allowedThemes));
  }).map(node => [node.id, node]));
  for (const company of records.filter(record=>isCollectionCompany(record,allowedThemes))) {
    if (companies.has(company.id)) continue;
    const membership = Object.values(company.themeMemberships ?? {}).find(value => value.status === 'PUBLISHED');
    const node: GraphNode = {
      id: company.id, kind: 'COMPANY', name: String(company.name),
      symbol: String(company.symbol ?? (company.id.startsWith('ORG:') ? '' : company.id.split(':')[1])),
      market: company.id.startsWith('US:') ? 'US' : /^(XSHG|XSHE):/.test(company.id) ? 'CN_A' : 'GLOBAL',
      ...companyGeography(company), order: 1000,
      stageIds: membership ? [membership.primarySector] : [],
      names: company.names as GraphNode['names'],
      ...(typeof company.slug === 'string' ? {slug:company.slug}:{}),
      aliases: Array.isArray(company.aliases) ? company.aliases.filter((alias): alias is string => typeof alias === 'string') : [],
    };
    companies.set(node.id, node);
  }
  return { ...legacy, nodes: [...legacy.nodes.filter(node => node.kind === 'STAGE'), ...companies.values()] };
}
