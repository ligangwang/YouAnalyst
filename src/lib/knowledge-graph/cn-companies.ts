import type { KnowledgeGraph } from "./model";

export const CN_COMPANY_ID = /^(XSHG:6\d{5}|XSHE:[03]\d{5})$/;

// The same published graph the website renders (inGraph, legacy aiGraph and
// relationship neighbours), restricted to Shanghai/Shenzhen A-share listings.
export function cnMapCompanies(graph: Pick<KnowledgeGraph, "nodes">) {
  return [...new Set(graph.nodes.filter(node => node.kind === "COMPANY" && CN_COMPANY_ID.test(node.id))
    .map(node => node.id))].sort();
}
