import type { KnowledgeGraph } from "./model";
import { companySector, GRAPH_SECTORS, OTHER_SECTOR } from "./sectors";

export function layout3D(graph: KnowledgeGraph) {
  const sectors = [...GRAPH_SECTORS, OTHER_SECTOR];
  const companies = graph.nodes.filter(n => n.kind === "COMPANY").sort((a, b) => a.id.localeCompare(b.id));
  const radius = Math.max(90, Math.cbrt(companies.length) * 48);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  // Equal-area directions plus cube-root radii fill a ball, not a hollow shell.
  // The two sequences are independent, avoiding rings and a dense central knot.
  const slots = companies.map((_, i) => {
    const y = 1 - 2 * (i + .5) / companies.length;
    const ring = Math.sqrt(1 - y * y);
    const distance = companies.length === 1 ? 0 : radius * Math.cbrt(((i + .5) * Math.SQRT2) % 1);
    return { x: Math.cos(i * goldenAngle) * ring * distance, y: y * distance, z: Math.sin(i * goldenAngle) * ring * distance };
  });
  // Give each sector a distinct 3D anchor. Assign nearby available slots while
  // preserving the ball's distribution, independent of relationship density.
  const anchors = sectors.map((_, i) => {
    const y = 1 - 2 * (i + .5) / sectors.length;
    const ring = Math.sqrt(1 - y * y);
    return { ax: Math.cos(i * goldenAngle) * ring * radius * .7, ay: y * radius * .7, az: Math.sin(i * goldenAngle) * ring * radius * .7 };
  });
  const nodes = companies.map(node => {
    const sector = Math.max(0, sectors.findIndex(s => s.id === companySector(node).id));
    const { ax, ay, az } = anchors[sector];
    let nearest = 0, best = Infinity;
    slots.forEach((p, i) => {
      const distance = (p.x - ax) ** 2 + (p.y - ay) ** 2 + (p.z - az) ** 2;
      if (distance < best) { best = distance; nearest = i; }
    });
    return { ...node, ...slots.splice(nearest, 1)[0], ax, ay, az };
  });
  const ids = new Set(nodes.map(n => n.id));
  const edges = graph.relationships.filter(e => e.type !== "PARTICIPATES_IN" && ids.has(e.source) && ids.has(e.target));
  // No simulation: only the camera moves, so the ball never flattens or drifts.
  return { nodes, edges, radius: Math.max(60, ...nodes.map(n => Math.hypot(n.x, n.y, n.z))) };
}
