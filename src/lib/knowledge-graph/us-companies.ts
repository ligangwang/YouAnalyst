import type { KnowledgeGraph } from "./model";

// Use listing market, not headquarters country: US-listed ADRs belong here too.
export function usMapTickers(graph: Pick<KnowledgeGraph, "nodes">) {
  return [...new Set(graph.nodes.filter(node => node.kind === "COMPANY" && node.id.startsWith("US:"))
    .map(node => node.id.slice(3)).filter(ticker => /^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker)))].sort();
}
