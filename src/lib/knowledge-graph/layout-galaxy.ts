import type { KnowledgeGraph } from "./model";
import { companySector, graphSectors, graphTheme, OTHER_SECTOR } from "./sectors";

// The companies themselves form a spiral galaxy: each sector is an arm, and the
// most significant companies sit closest to the core. From afar the arms read
// as a nebula; up close every point of light is a company.
export const GALAXY_PITCH = .42;
// Tilt the disc so the default camera (+z) sees the arms in perspective.
const TILT = -.95;

function hash(text: string, salt = 0) {
  let value = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return ((value >>> 0) % 100000) / 100000;
}

export type GalaxyArm = { sector: string; color: string; angle: number };

export function galaxyArmPoint(radius: number, armAngle: number, galaxyRadius: number) {
  const inner = galaxyRadius * .16;
  return armAngle + Math.log(Math.max(radius, inner) / inner) / GALAXY_PITCH;
}

/** Disc coordinates (x along the disc, z across it, y out of plane) to world space. */
export function galaxyToWorld(x: number, y: number, z: number) {
  const cos = Math.cos(TILT), sin = Math.sin(TILT);
  return { x, y: y * cos - z * sin, z: y * sin + z * cos };
}

export function layoutGalaxy(graph: KnowledgeGraph) {
  const sectors = [...graphSectors(graphTheme(graph.nodes), graph.nodes), OTHER_SECTOR];
  const companies = graph.nodes.filter(n => n.kind === "COMPANY").sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set(companies.map(n => n.id));
  const edges = graph.relationships.filter(e => e.type !== "PARTICIPATES_IN" && ids.has(e.source) && ids.has(e.target));
  const degree = new Map<string, number>();
  for (const e of edges) for (const id of [e.source, e.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const weight = (n: (typeof companies)[number]) => n.marketCap?.value ?? 0;
  const radius = Math.max(260, Math.sqrt(companies.length) * 60);
  const groups = sectors.map(sector => companies.filter(n => companySector(n).id === sector.id)
    // Largest (or, without market caps, best connected) companies sit nearest the core.
    .sort((a, b) => weight(b) - weight(a) || (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id)))
    .map((members, i) => ({ sector: sectors[i], members })).filter(group => group.members.length);
  const arms: GalaxyArm[] = groups.map((group, i) => ({ sector: group.sector.id, color: group.sector.color, angle: i / groups.length * Math.PI * 2 }));
  const nodes = groups.flatMap((group, arm) => {
    const anchorRadius = radius * (.16 + .8 * Math.pow(.5, .85));
    const anchorAngle = galaxyArmPoint(anchorRadius, arms[arm].angle, radius);
    const anchor = galaxyToWorld(Math.cos(anchorAngle) * anchorRadius, 0, Math.sin(anchorAngle) * anchorRadius);
    return group.members.map((node, j) => {
      const t = group.members.length === 1 ? .35 : (j + .5) / group.members.length;
      // Alternate sides of the arm so neighbours do not stack on one curve.
      const r = radius * (.16 + .8 * Math.pow(t, .85)) * (1 + (hash(node.id) - .5) * .08);
      const angle = galaxyArmPoint(r, arms[arm].angle, radius) + (j % 2 ? 1 : -1) * (.05 + hash(node.id, 1) * .1) * (1 - t * .4);
      const thickness = (hash(node.id, 2) - .5) * radius * .08 * (1 - t * .5);
      const world = galaxyToWorld(Math.cos(angle) * r, thickness, Math.sin(angle) * r);
      return { ...node, ...world, ax: anchor.x, ay: anchor.y, az: anchor.z, galaxyArm: arm, galaxyT: t };
    });
  });
  return { nodes, edges, radius: Math.max(60, ...nodes.map(n => Math.hypot(n.x, n.y, n.z))), arms, galaxyRadius: radius };
}
