import type { TreeLayer } from './industry-tree';
import { TOUR_MOTION } from './tour-motion';

export type HierarchyStop = { open: string[]; focus: string; members?: string[]; duration: number; hold: number };
// Keep labels readable; pan through overlapping groups instead of fitting a tall
// branch into a tiny overview. Every company appears in at least one group.
export function hierarchyTourPlan(layers: TreeLayer[], width: number, height: number): HierarchyStop[] {
  const zoom = Math.min(.8, Math.max(120, width - 80) / 240);
  const count = Math.max(2, Math.min(6, Math.floor((height - 100) / (88 * zoom))));
  const overview = (open: string[], focus: string): HierarchyStop => ({open, focus, duration: TOUR_MOTION.overview, hold: TOUR_MOTION.overviewHold});
  const plan: HierarchyStop[] = [overview(['root'], 'root')];
  for (const layer of layers) {
    plan.push(overview(['root', layer.id], layer.id));
    for (const branch of layer.branches) {
      for (let i = 0; i < branch.companies.length; i += count - 1) {
        const group = branch.companies.slice(i, i + count);
        plan.push({open: ['root', layer.id, branch.id], focus: branch.id,
          members: group.map(c => branch.id + '/' + c.id), duration: TOUR_MOTION.group, hold: TOUR_MOTION.hold});
        if (i + count >= branch.companies.length) break;
      }
    }
  }
  return plan;
}
