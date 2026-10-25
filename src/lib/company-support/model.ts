import type { Timestamp } from 'firebase-admin/firestore';
import type { ThemedCompany } from '../company-themes/model';
import type { GraphNode, KnowledgeGraph } from '../knowledge-graph/model';
import { companyGeography } from '../market-companies/identity';

export type CompanyOnboarding = {
  status: 'QUEUED' | 'PROCESSING' | 'BLOCKED' | 'SUPPORTED';
  version: 1;
  requestedAt: Timestamp | null;
  startedAt: Timestamp | null;
  supportedAt: Timestamp | null;
  updatedAt: Timestamp;
  blockedReason: string | null;
};

/** The sole regular-job membership rule. Theme decisions do not enroll a company. */
export function isSupportedCompany(company: Record<string, unknown>) {
  const onboarding = company.onboarding as Partial<CompanyOnboarding> | undefined;
  return company.isDeleted !== true && ['PUBLISHED', 'DIRECTORY'].includes(String(company.status))
    && typeof company.name === 'string' && Boolean(company.name.trim())
    && onboarding?.status === 'SUPPORTED';
}

/** A metadata projection, never a graph traversal that enrolls relationship neighbors. */
export function supportedCompanyUniverse(records: ThemedCompany[]): KnowledgeGraph {
  const nodes: GraphNode[] = records.filter(isSupportedCompany).sort((a,b)=>a.id.localeCompare(b.id)).map(company => ({
    id: company.id, kind: 'COMPANY', name: String(company.name),
    symbol: String(company.symbol ?? (company.id.startsWith('ORG:') ? '' : company.id.split(':')[1])),
    market: company.id.startsWith('US:') ? 'US' : /^(XSHG|XSHE):/.test(company.id) ? 'CN_A' : 'GLOBAL',
    ...companyGeography(company), order: 1000,
    stageIds: supportedCompanyStages(company),
    names: company.names as GraphNode['names'],
    ...(typeof company.slug === 'string' ? {slug: company.slug} : {}),
    aliases: Array.isArray(company.aliases) ? company.aliases.filter((alias): alias is string => typeof alias === 'string') : [],
  }));
  return {nodes, relationships: [], sources: [], asOf: ''};
}

function supportedCompanyStages(company: ThemedCompany) {
  const legacy=company.inGraph as {status?:string;stageIds?:unknown} | undefined;
  const stages=legacy?.status==='PUBLISHED' && !company.themeMemberships?.ai && Array.isArray(legacy.stageIds)
    ? legacy.stageIds.filter((stage):stage is string=>typeof stage==='string') : [];
  return [...new Set([...stages,...Object.entries(company.themeMemberships ?? {})
    .filter(([,member])=>member.status==='PUBLISHED').flatMap(([theme,member])=>{
      const roles=member.assignments?member.assignments.filter(item=>item.status==='PUBLISHED').map(item=>item.nodeId):[member.primarySector,...member.secondaryRoles??[]];
      return roles.map(role=>theme==='ai'?role:role.startsWith(`${theme}:`)?role:`${theme}:${role.replace(new RegExp(`^${theme}\\.`),'')}`);
    })])];
}
