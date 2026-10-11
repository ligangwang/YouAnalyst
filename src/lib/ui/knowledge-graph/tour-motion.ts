// Shared wall-clock pacing. Clamp stalls before applying the user's multiplier.
export const TOUR_MOTION = { approach: 12, group: 20, overview: 12, hold: 5, overviewHold: 3, degreesPerSecond: 2 } as const;
export const tourDelta = (delta: number, speed = 1) => Math.max(0, Math.min(.25, delta)) * speed;
export const tourEase = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x*x*x*(x*(x*6-15)+10); };
