const DEG = Math.PI / 180;
const smoothstep = (t: number) => Math.max(0, Math.min(1, t * t * t * (t * (t * 6 - 15) + 10)));

export function createIntroCamera(startDistance: number, closeDistance: number, random: () => number = Math.random) {
  const orbit = createIntroOrbit(random);
  let elapsed = 0;
  return (delta: number, polar: number, speed = 1) => {
    const dt = Math.max(0, Math.min(delta, .05)) * speed;
    elapsed += dt;
    // Eight seconds to approach, then four seconds to ease into the orbit.
    // Quintic easing starts and ends with zero velocity and acceleration.
    const approach = smoothstep(Math.min(1, elapsed / 8));
    const orbitGain = smoothstep(Math.max(0, Math.min(1, (elapsed - 8) / 4)));
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
  const azimuthSpeed = direction * (1.7 + random() * .6) * DEG;
  let above = random() < .5;
  let remaining = 0;
  let targetPolar = Math.PI / 2;

  return (delta: number, polar: number, speed = 1) => {
    // Background tabs and slow frames must not cause sudden camera jumps.
    const dt = Math.max(0, Math.min(delta, .05)) * speed;
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
