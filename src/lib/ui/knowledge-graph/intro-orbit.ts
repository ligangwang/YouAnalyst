import { TOUR_MOTION, tourDelta, tourEase } from './tour-motion';
const DEG = Math.PI / 180;
const smoothstep = tourEase;

export function createIntroCamera(startDistance: number, closeDistance: number, random: () => number = Math.random) {
  const orbit = createIntroOrbit(random);
  let elapsed = 0;
  return (delta: number, polar: number, speed = 1) => {
    const dt = tourDelta(delta, speed);
    elapsed += dt;
    // Use the same approach duration and easing as the other charts.
    // Quintic easing starts and ends with zero velocity and acceleration.
    const approach = smoothstep(Math.min(1, elapsed / TOUR_MOTION.approach));
    const orbitGain = smoothstep(Math.max(0, Math.min(1, (elapsed - TOUR_MOTION.approach) / 4)));
    const step = orbit(dt / speed * orbitGain, polar, speed);
    return {
      ...step,
      distance: startDistance + (Math.min(startDistance, closeDistance) - startDistance) * approach,
    };
  };
}

// Keep travelling around the graph, while alternating randomized high and low
// viewpoints. An unconstrained random walk can linger on the same side forever.
export function createIntroOrbit(random: () => number = Math.random) {
  const direction = random() < .5 ? -1 : 1;
  const azimuthSpeed = direction * (TOUR_MOTION.degreesPerSecond + (random() - .5) * .6) * DEG;
  let above = random() < .5;
  let remaining = 0;
  let targetPolar = Math.PI / 2;

  return (delta: number, polar: number, speed = 1) => {
    // Background tabs and slow frames must not cause sudden camera jumps.
    const dt = tourDelta(delta, speed);
    remaining -= dt;
    if (remaining <= 0) {
      targetPolar = (above ? 55 + random() * 25 : 100 + random() * 25) * DEG;
      above = !above;
      remaining = 45 + random() * 20;
    }
    // Ease into each new elevation and stay clear of the poles.
    const polarStep = (targetPolar - polar) * (1 - Math.exp(-.07 * dt));
    const maxStep = 1.2 * DEG * dt;
    return { azimuth: azimuthSpeed * dt, polar: Math.max(-maxStep, Math.min(maxStep, polarStep)) };
  };
}
