import type { GraphNode, KnowledgeGraph } from '../knowledge-graph/model';
import { companyGeography } from '../market-companies/identity';

export const COMPANY_THEMES = ['ai', 'robotics'] as const;
export type CompanyThemeId = typeof COMPANY_THEMES[number];
export function parseCompanyTheme(value: unknown): CompanyThemeId {
  return COMPANY_THEMES.includes(value as CompanyThemeId) ? value as CompanyThemeId : 'ai';
}
export const themeName = (theme: CompanyThemeId, chinese = false) => theme === 'robotics' ? chinese ? '机器人' : 'Robotics' : 'AI';
export const ROBOTICS_SECTORS = [
  'compute-control', 'sensors-vision', 'motion-mechanics', 'grippers-tools',
  'software-simulation', 'robot-manufacturers', 'systems-integration',
] as const;
export type ThemeMembership = {
  status: 'PUBLISHED' | 'DRAFT' | 'WITHDRAWN'; primarySector: string;
  secondaryRoles?: string[]; reviewedAt: string;
  sources?: { url: string; title: string; summary: string }[];
};
export type ThemedCompany = Record<string, unknown> & {
  id: string; themeIds?: string[]; themeMemberships?: Record<string, ThemeMembership>;
};

/** The array is a query index; membership status remains authoritative. */
export function activeThemeIds(company: Pick<ThemedCompany, 'themeMemberships'>) {
  return Object.entries(company.themeMemberships ?? {})
    .filter(([, membership]) => membership?.status === 'PUBLISHED')
    .map(([id]) => id).sort();
}
export function isCollectionCompany(company: ThemedCompany) {
  if (!['PUBLISHED', 'DIRECTORY'].includes(String(company.status)) || !company.name) return false;
  if (activeThemeIds(company).some(id => COMPANY_THEMES.includes(id as CompanyThemeId))) return true;
  // Compatibility for existing AI records until memberships have been migrated.
  const legacy = (company.inGraph ?? company.aiGraph) as { status?: string } | undefined;
  return !company.themeMemberships?.ai && legacy?.status === 'PUBLISHED';
}

/** Job scope is the unique union, not a graph layout or a second company store. */
export function collectionUniverse(legacy: KnowledgeGraph, records: ThemedCompany[]): KnowledgeGraph {
  const byId = new Map(records.map(company => [company.id, company]));
  const companies = new Map(legacy.nodes.filter(node => {
    if (node.kind !== 'COMPANY') return false;
    const company = byId.get(node.id);
    // Missing membership records can be relationship-only neighbors. An explicit
    // AI decision overrides its legacy graph flag, unless another theme enrolls it.
    return !company?.themeMemberships?.ai || isCollectionCompany(company);
  }).map(node => [node.id, node]));
  for (const company of records.filter(isCollectionCompany)) {
    if (companies.has(company.id)) continue;
    const membership = Object.values(company.themeMemberships ?? {}).find(value => value.status === 'PUBLISHED');
    const node: GraphNode = {
      id: company.id, kind: 'COMPANY', name: String(company.name),
      symbol: String(company.symbol ?? (company.id.startsWith('ORG:') ? '' : company.id.split(':')[1])),
      market: company.id.startsWith('US:') ? 'US' : /^(XSHG|XSHE):/.test(company.id) ? 'CN_A' : 'GLOBAL',
      ...companyGeography(company), order: 1000,
      stageIds: membership ? [membership.primarySector] : [],
      names: company.names as GraphNode['names'],
      aliases: Array.isArray(company.aliases) ? company.aliases.filter((alias): alias is string => typeof alias === 'string') : [],
    };
    companies.set(node.id, node);
  }
  return { ...legacy, nodes: [...legacy.nodes.filter(node => node.kind === 'STAGE'), ...companies.values()] };
}
