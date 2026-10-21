import { hierarchyPath, type HierarchyNode } from './model';
import { graphSectors } from '../knowledge-graph/sectors';

export type CompanyThemeData = { themeMemberships?: Record<string, { status?: string; primarySector?: string; secondaryRoles?: string[]; assignments?: {nodeId:string; status:string}[] }>; inGraph?: {stageIds?:string[]} };

export function companyThemeNodeIds(company: CompanyThemeData, nodes: HierarchyNode[]) {
  const direct = new Set<string>();
  for (const [theme, membership] of Object.entries(company.themeMemberships ?? {})) {
    if (membership.status !== 'PUBLISHED') continue;
    direct.add(theme);
    if (membership.assignments) {
      membership.assignments.filter(item => item.status === 'PUBLISHED').forEach(item => direct.add(item.nodeId));
    } else if (theme !== 'ai') {
      [membership.primarySector, ...(membership.secondaryRoles ?? [])].filter(Boolean).forEach(role => direct.add(`${theme}.${role}`));
    } else {
      // Only source-backed stage assignments provide precise legacy AI placement.
      for (const stage of company.inGraph?.stageIds ?? []) {
        const node = nodes.find(node => node.id.startsWith('ai.') && node.id.split('.').at(-1) === stage);
        if (node) direct.add(node.id);
      }
      // Broad sectors may span several layers, so never infer their children.
      if (!company.inGraph?.stageIds?.length) {
        const sector = graphSectors('ai').find(item => item.id === membership.primarySector);
        const layers = new Set(sector?.stages.flatMap(stage => nodes.filter(node => node.id.startsWith('ai.') && node.id.split('.').at(-1) === stage).map(node => hierarchyPath(nodes,node.id)[1]?.id)).filter(Boolean));
        if (layers.size === 1) direct.add([...layers][0]!);
      }
    }
  }
  return [...direct].filter(id => nodes.some(node => node.id === id));
}
