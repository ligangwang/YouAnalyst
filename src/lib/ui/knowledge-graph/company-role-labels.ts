import type { GraphNode } from '../../knowledge-graph/model';
import { graphTheme } from '../../knowledge-graph/sectors';
import { companySectors } from '../../knowledge-graph/views';
import { industryTree } from './industry-tree';

/** Match AI roles to the same layer/branch membership used by the tree. */
export function companyRoleLabels(company: GraphNode) {
  if (graphTheme([company]) !== 'ai') return companySectors(company);
  return industryTree([company]).flatMap(layer => layer.branches.map(branch => ({
    id: branch.id,
    en: `${layer.en} ${branch.en}`,
    zh: `${layer.zh} ${branch.zh}`,
    color: layer.color,
  })));
}
