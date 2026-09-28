import { Spherical, Vector3 } from "three";

// Keep the user's pivot and distance, even when a large pan makes a full orbit
// intersect the graph. Turn back along the safe arc instead of dollying outward.
export function safeGraphOrbitStep(position: Vector3, target: Vector3, step: { azimuth: number; polar: number }, minimumRadius: number) {
  const offset = position.clone().sub(target);
  // A deliberate close view may already be inside the extra orbit buffer. Allow
  // tangential/outward travel there, without forcing the user to zoom out first.
  const safeRadius = Math.min(minimumRadius, position.length());
  const safe = (azimuth: number, polar: number) => {
    const spherical = new Spherical().setFromVector3(offset);
    spherical.theta += azimuth;
    spherical.phi = Math.max(0, Math.min(Math.PI, spherical.phi + polar));
    spherical.makeSafe();
    return new Vector3().setFromSpherical(spherical).add(target).length() >= safeRadius - 1e-8;
  };
  if (safe(step.azimuth, step.polar)) return { ...step, reversed: false };
  if (safe(-step.azimuth, 0)) return { azimuth: -step.azimuth, polar: 0, reversed: true };
  return { azimuth: 0, polar: 0, reversed: false };
}
