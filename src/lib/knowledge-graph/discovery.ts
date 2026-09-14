import type { GraphEdge, KnowledgeGraph } from "./model";

export function recentConnections(graph: KnowledgeGraph, now = Date.now()) {
  return graph.relationships.filter(e => {
    const date = Date.parse(e.publishedAt ?? "");
    return e.type !== "PARTICIPATES_IN" && Number.isFinite(date) && date <= now && now - date < 7 * 86400000;
  });
}

// Journeys are sourced graph paths, never inferred commercial relationships.
export function connectionJourney(graph: KnowledgeGraph, start: string, maxSteps = 5): GraphEdge[] {
  const companies = new Set(graph.nodes.filter(n => n.kind === "COMPANY").map(n => n.id));
  const edges = graph.relationships.filter(e => e.type !== "PARTICIPATES_IN" && e.sourceIds.length && companies.has(e.source) && companies.has(e.target));
  let best: GraphEdge[] = []; let budget = 2000;
  function walk(current: string, visited: Set<string>, path: GraphEdge[]) {
    if (path.length > best.length) best = path;
    if (best.length >= maxSteps || budget-- <= 0) return;
    for (const edge of edges) {
      const next = edge.source === current ? edge.target : edge.target === current ? edge.source : null;
      if (next && !visited.has(next)) walk(next, new Set([...visited, next]), [...path, edge]);
      if (best.length >= maxSteps || budget <= 0) return;
    }
  }
  walk(start, new Set([start]), []);
  return best;
}
