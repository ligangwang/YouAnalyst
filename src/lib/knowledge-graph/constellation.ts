import type { KnowledgeGraph } from "./model";

// A deterministic layout: filters never fabricate links, and isolated companies
// remain present even when their only recorded information is an industry role.
export function layoutCompanies(graph: KnowledgeGraph) {
  const companies = graph.nodes.filter(n => n.kind === "COMPANY").sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set(companies.map(n => n.id));
  const edges = graph.relationships.filter(e => e.type !== "PARTICIPATES_IN" && ids.has(e.source) && ids.has(e.target));
  const degree = new Map(companies.map(n => [n.id, 0]));
  edges.forEach(e => { degree.set(e.source, degree.get(e.source)! + 1); degree.set(e.target, degree.get(e.target)! + 1); });
  const stages = [...new Set(companies.map(n => n.stageIds?.[0] ?? "other"))].sort();
  const radius = Math.max(100, Math.sqrt(companies.length) * 44);
  const points = companies.map((node, i) => {
    const angle = stages.indexOf(node.stageIds?.[0] ?? "other") / Math.max(1, stages.length) * Math.PI * 2;
    const ax = Math.cos(angle) * radius, ay = Math.sin(angle) * radius * .72;
    return { node, x: ax + Math.cos(i * 2.39996) * 115, y: ay + Math.sin(i * 2.39996) * 115, ax, ay };
  });
  const index = new Map(points.map((p, i) => [p.node.id, i]));
  for (let step = 0; step < 150; step++) {
    const forces = points.map(p => ({ x: (p.ax - p.x) * .008, y: (p.ay - p.y) * .008 }));
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].x - points[j].x || .01, dy = points[i].y - points[j].y || .01;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const strength = Math.min(16, 650 / (distance * distance) + Math.max(0, 110 - distance) * .13);
      const x = dx / distance * strength, y = dy / distance * strength;
      forces[i].x += x; forces[i].y += y; forces[j].x -= x; forces[j].y -= y;
    }
    for (const edge of edges) {
      const i = index.get(edge.source)!, j = index.get(edge.target)!;
      const dx = points[j].x - points[i].x, dy = points[j].y - points[i].y, distance = Math.max(1, Math.hypot(dx, dy));
      const strength = (distance - 150) * .012;
      forces[i].x += dx / distance * strength; forces[i].y += dy / distance * strength;
      forces[j].x -= dx / distance * strength; forces[j].y -= dy / distance * strength;
    }
    points.forEach((p, i) => { p.x += forces[i].x; p.y += forces[i].y; });
  }
  const minX = Math.min(0, ...points.map(p => p.x)) - 75, minY = Math.min(0, ...points.map(p => p.y)) - 75;
  const width = Math.max(300, Math.max(0, ...points.map(p => p.x)) - minX + 75);
  const height = Math.max(260, Math.max(0, ...points.map(p => p.y)) - minY + 75);
  return { nodes: points.map(p => ({ ...p.node, x: p.x - minX, y: p.y - minY, degree: degree.get(p.node.id)! })), edges, width, height };
}
