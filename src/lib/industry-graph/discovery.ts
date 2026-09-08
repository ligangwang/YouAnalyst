import type { IndustryGraph } from "./model";

const QUESTIONS = [
  { id: "nvda-suppliers", ticker: "NVDA", title: "Who supplies NVIDIA?", direction: "incoming" },
  { id: "mu-customers", ticker: "MU", title: "Who does Micron supply?", direction: "outgoing" },
  { id: "tsm-customers", ticker: "TSM", title: "Who does TSMC supply?", direction: "outgoing" },
] as const;

// These are entry points into available evidence, not new claims or a complete supply chain.
export function discoveryQuestions(graph: IndustryGraph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return QUESTIONS.flatMap((question) => {
    const company = graph.nodes.find((node) => node.ticker === question.ticker);
    if (!company) return [];
    const edges = graph.edges.filter((edge) => edge.type === "SUPPLIER_OF" && !edge.bidirectional && edge.evidence.length > 0 &&
      (question.direction === "incoming" ? edge.target === company.id : edge.source === company.id) &&
      nodes.has(edge.source) && nodes.has(edge.target) &&
      nodes.get(edge.source)!.kind !== "category" && nodes.get(edge.target)!.kind !== "category");
    return edges.length ? [{ ...question, company, edges }] : [];
  });
}

export function discoveryView(graph: IndustryGraph, question: ReturnType<typeof discoveryQuestions>[number]) {
  const ids = new Set([question.company.id, ...question.edges.flatMap((edge) => [edge.source, edge.target])]);
  return { nodes: graph.nodes.filter((node) => ids.has(node.id)), edges: question.edges };
}
