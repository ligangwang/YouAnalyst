import { forceSimulation, forceManyBody, forceLink, forceX, forceY, forceZ } from "d3-force-3d";
import type { KnowledgeGraph } from "./model";
import { companySector, GRAPH_SECTORS } from "./sectors";

export function layout3D(graph: KnowledgeGraph) {
  const nodes = graph.nodes.filter(n => n.kind === "COMPANY").sort((a, b) => a.id.localeCompare(b.id)).map((node, i) => {
    const sector = Math.max(0, GRAPH_SECTORS.findIndex(s => s.id === companySector(node).id));
    const angle = sector / GRAPH_SECTORS.length * Math.PI * 2;
    const ax = Math.cos(angle) * 140, ay = (sector % 3 - 1) * 80, az = Math.sin(angle) * 140;
    return { ...node, x: ax + Math.cos(i * 2.4) * 70, y: ay + Math.sin(i * 1.7) * 70, z: az + Math.cos(i * 1.3) * 70, ax, ay, az };
  });
  const ids = new Set(nodes.map(n => n.id));
  const edges = graph.relationships.filter(e => e.type !== "PARTICIPATES_IN" && ids.has(e.source) && ids.has(e.target));
  // Run once and stop: no drifting layout or background simulation loop.
  const simulation = forceSimulation(nodes, 3).stop()
    .force("charge", forceManyBody().strength(-100))
    .force("links", forceLink(edges.map(e => ({ source: e.source, target: e.target }))).id((n: { id?: string }) => n.id!).distance(100).strength(.08))
    .force("x", forceX((n: { ax?: number }) => n.ax ?? 0).strength(.06))
    .force("y", forceY((n: { ay?: number }) => n.ay ?? 0).strength(.06))
    .force("z", forceZ((n: { az?: number }) => n.az ?? 0).strength(.06));
  simulation.tick(120);
  const center = nodes.reduce((p, n) => [p[0] + n.x, p[1] + n.y, p[2] + n.z], [0, 0, 0]).map(v => v / Math.max(nodes.length, 1));
  nodes.forEach(n => { n.x -= center[0]; n.y -= center[1]; n.z -= center[2]; });
  return { nodes, edges, radius: Math.max(60, ...nodes.map(n => Math.hypot(n.x, n.y, n.z))) };
}
