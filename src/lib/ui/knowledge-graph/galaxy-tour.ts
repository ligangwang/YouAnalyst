import { CatmullRomCurve3, Vector3 } from 'three';
import { galaxyArmPoint, galaxyToWorld, type GalaxyArm } from './layout-galaxy';

type TourNode = { galaxyArm: number; galaxyT: number };
type TourCompany = TourNode & { id: string; x: number; y: number; z: number };
// arm: the arm being ridden at this point, or -1 while gliding between arms.
type Focus = { r: number; angle: number; arm: number };

const TAU = Math.PI * 2;
// The glide back towards the core always turns at least this far onwards.
const MIN_RETURN_TURN = Math.PI / 3;
// Weight of view rotation against travel when pacing the flight: turns slow it down.
const TURN_WEIGHT = 2;
// The loop never turns faster than this on average, however few companies it shows.
export const GALAXY_TOUR_MAX_TURN_DEGREES = 2.5;

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * Disc-plane focus points (radius, unwrapped angle) for a tour that only ever turns
 * one way. Arms are log spirals whose angle grows with radius, so riding an arm
 * outwards turns steadily forwards. From each arm's tip the camera keeps turning the
 * same way while gliding back in to the start of the next arm ahead of it.
 */
export function galaxyTourFocus(nodes: readonly TourNode[], arms: readonly GalaxyArm[], galaxyRadius: number): Focus[] {
  const R = galaxyRadius, radiusAt = (t: number) => R * (.16 + .8 * Math.pow(t, .85));
  const legs = [...new Set(nodes.map(n => n.galaxyArm))].sort((a, b) => a - b).map(arm => {
    const ts = nodes.filter(n => n.galaxyArm === arm).map(n => n.galaxyT), base = arms[arm]?.angle ?? 0;
    const from = radiusAt(Math.min(...ts)), to = radiusAt(Math.max(...ts));
    return { arm, from, to, base, start: galaxyArmPoint(from, base, R) };
  });
  if (!legs.length) return [];
  const points: Focus[] = [];
  const ride = (leg: (typeof legs)[number], offset: number) => {
    const samples = leg.to - leg.from < R * .01 ? 1 : Math.max(2, Math.ceil((leg.to - leg.from) / (R * .06)) + 1);
    for (let k = 0; k < samples; k++) {
      const r = samples === 1 ? leg.from : leg.from + (leg.to - leg.from) * k / (samples - 1);
      points.push({ r, angle: galaxyArmPoint(r, leg.base, R) + offset, arm: leg.arm });
    }
  };
  // Unwrap a start angle so it lies at least MIN_RETURN_TURN ahead of the current one.
  const ahead = (angle: number, after: number) => angle + TAU * Math.ceil((after + MIN_RETURN_TURN - angle) / TAU);
  const glide = (from: Focus, to: Focus) => {
    const samples = Math.max(2, Math.ceil((to.angle - from.angle) / (Math.PI / 12)));
    // Interior points only: the leg ends are already on the path.
    for (let k = 1; k < samples; k++) {
      const f = k / samples;
      points.push({ r: from.r + (to.r - from.r) * smooth(f), angle: from.angle + (to.angle - from.angle) * f, arm: -1 });
    }
  };
  const remaining = legs.slice(1);
  ride(legs[0], 0);
  while (remaining.length) {
    const last = points[points.length - 1];
    // The next arm is whichever starts soonest ahead: the rotation never reverses.
    let best = 0, bestAngle = Infinity;
    remaining.forEach((leg, i) => { const angle = ahead(leg.start, last.angle); if (angle < bestAngle) { best = i; bestAngle = angle; } });
    const [leg] = remaining.splice(best, 1);
    glide(last, { r: leg.from, angle: bestAngle, arm: leg.arm });
    ride(leg, bestAngle - leg.start);
  }
  // Close the loop by gliding on to the first arm, a whole number of turns later.
  const last = points[points.length - 1];
  glide(last, { r: points[0].r, angle: ahead(points[0].angle, last.angle), arm: points[0].arm });
  return points;
}

export type GalaxyTour = {
  /** Writes the eye and target for loop progress 0..1 into the given vectors. */
  at(progress: number, eye: Vector3, target: Vector3): void;
  /**
   * The company to present at this point of the loop: the one nearest the target on
   * the arm being ridden, so each company comes up front once per loop, from the core
   * outwards. Empty while gliding between arms. `held` keeps the current company until
   * another is clearly nearer, so the label does not flicker between neighbours.
   */
  company(progress: number, target: Vector3, held: string): string;
  /**
   * Loop length: the given seconds per company, but never so short that the view
   * turns faster than GALAXY_TOUR_MAX_TURN_DEGREES per second (a filtered graph of a
   * few companies still circles the galaxy at least once).
   */
  loopSeconds(perCompany: number): number;
};

export function galaxyTour(nodes: readonly TourCompany[], arms: readonly GalaxyArm[], galaxyRadius: number): GalaxyTour | null {
  const focus = galaxyTourFocus(nodes, arms, galaxyRadius);
  if (!focus.length) return null;
  const R = galaxyRadius, normal = galaxyToWorld(0, 1, 0), up = new Vector3(normal.x, normal.y, normal.z);
  const targets = focus.map(({ r, angle }) => { const p = galaxyToWorld(Math.cos(angle) * r, 0, Math.sin(angle) * r); return new Vector3(p.x, p.y, p.z); });
  // Each point is seen from just outside it, with the nebula and core behind it.
  const eyes = targets.map(at => at.clone().addScaledVector(at.clone().normalize(), R * .36).addScaledVector(up, R * .14));
  if (targets.length === 1) { eyes.push(eyes[0].clone().addScaledVector(up, 1)); targets.push(targets[0].clone()); }
  const eyeCurve = new CatmullRomCurve3(eyes, true, 'centripetal'), targetCurve = new CatmullRomCurve3(targets, true, 'centripetal');
  // Pace by travel plus turning, so the flight keeps one calm speed through bends.
  const samples = eyes.length * 40, pace = new Float64Array(samples + 1);
  let rotation = 0;
  const eye = new Vector3(), target = new Vector3(), view = new Vector3(), previousEye = eyeCurve.getPoint(0), previousView = targetCurve.getPoint(0).sub(previousEye);
  previousView.addScaledVector(up, -previousView.dot(up)).normalize();
  for (let i = 1; i <= samples; i++) {
    eyeCurve.getPoint(i / samples, eye); targetCurve.getPoint(i / samples, target);
    // Measure turning around the galaxy's axis: the tilt of the view is constant.
    view.subVectors(target, eye);
    view.addScaledVector(up, -view.dot(up)).normalize();
    const turn = view.angleTo(previousView);
    rotation += turn;
    pace[i] = pace[i - 1] + eye.distanceTo(previousEye) / R + turn * TURN_WEIGHT;
    previousEye.copy(eye); previousView.copy(view);
  }
  const total = pace[samples] || 1;
  const curveAt = (progress: number) => {
    const want = (progress - Math.floor(progress)) * total;
    let low = 0, high = samples;
    while (high - low > 1) { const middle = (low + high) >> 1; if (pace[middle] <= want) low = middle; else high = middle; }
    return (low + (want - pace[low]) / Math.max(1e-9, pace[high] - pace[low])) / samples;
  };
  const members = new Map<number, { id: string; at: Vector3 }[]>();
  for (const node of nodes) members.set(node.galaxyArm, [...members.get(node.galaxyArm) ?? [], { id: node.id, at: new Vector3(node.x, node.y, node.z) }]);
  const rotationDegrees = rotation * 180 / Math.PI;
  return {
    loopSeconds: perCompany => Math.max(perCompany * nodes.length, rotationDegrees / GALAXY_TOUR_MAX_TURN_DEGREES),
    at(progress, eyeOut, targetOut) {
      const u = curveAt(progress);
      eyeCurve.getPoint(u, eyeOut); targetCurve.getPoint(u, targetOut);
    },
    company(progress, target, held) {
      // The closed curve has one segment per focus point; a segment touching a ridden
      // point belongs to that arm, which also covers arms with a single company.
      const segment = Math.min(focus.length - 1, Math.floor(curveAt(progress) * focus.length));
      const arm = focus[segment].arm >= 0 ? focus[segment].arm : focus[(segment + 1) % focus.length].arm;
      const candidates = members.get(arm);
      if (arm < 0 || !candidates) return '';
      let best = candidates[0], distance = Infinity;
      for (const candidate of candidates) { const d = candidate.at.distanceToSquared(target); if (d < distance) { distance = d; best = candidate; } }
      const current = candidates.find(candidate => candidate.id === held);
      return current && current.at.distanceToSquared(target) < distance * 1.5 ? current.id : best.id;
    },
  };
}
