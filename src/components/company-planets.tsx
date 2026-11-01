"use client";

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import { InstancedBufferAttribute, InstancedBufferGeometry, SphereGeometry, Vector2, type BufferAttribute, type BufferGeometry } from 'three';

// Up close, each company in the galaxy universe becomes a small planet in its
// sector colour, lit by the galactic core. Planets stay modest in size so
// neighbours and labels remain readable; from afar they fade back into points.
const vertex = `attribute vec3 center; attribute vec3 tint; attribute float emphasis; attribute float capScale; attribute float seed;
  uniform vec2 range; uniform float baseRadius; uniform vec2 nearRange;
  varying vec3 vNormal; varying vec3 vView; varying vec3 vLight; varying vec3 vTint; varying vec3 vLocal; varying float vAlpha; varying float vSeed; varying float vDim;
  void main() {
    float depth = -(viewMatrix * vec4(center, 1.)).z;
    float fade = 1. - smoothstep(range.x, range.y, depth);
    float focus = smoothstep(1., 2., emphasis);
    // Dimmed companies stay solid but darker; planets right beside the camera fade
    // out instead of filling the lens.
    vAlpha = fade * smoothstep(nearRange.x, nearRange.y, depth);
    vDim = mix(.3, 1., clamp(emphasis, 0., 1.));
    if (vAlpha < .01) { gl_Position = vec4(2., 2., 2., 1.); return; }
    float radius = baseRadius * clamp(sqrt(capScale), .85, 1.35) * mix(1., 1.2, focus);
    vec3 world = center + position * radius;
    vNormal = normalize(position);
    vLocal = position;
    vView = normalize(cameraPosition - world);
    // The galactic core at the origin is the sun of every company planet.
    vLight = normalize(-center + vec3(0., 1e-3, 0.));
    vTint = tint; vSeed = seed;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.);
  }`;
const fragment = `varying vec3 vNormal; varying vec3 vView; varying vec3 vLight; varying vec3 vTint; varying vec3 vLocal; varying float vAlpha; varying float vSeed; varying float vDim;
  void main() {
    // Tilted cloud bands with a little turbulence, different for every company.
    vec3 axis = normalize(vec3(sin(vSeed * 6.3) * .35, 1., cos(vSeed * 4.1) * .35));
    float latitude = dot(vLocal, axis);
    float swirl = sin(vLocal.x * 3. + vSeed * 20.) * sin(vLocal.z * 2.5 + vSeed * 13.) * .07;
    float bands = .5 + .5 * sin((latitude + swirl) * (3.2 + vSeed * 2.4) + vSeed * 40.);
    float fine = .5 + .5 * sin((latitude + swirl * 1.6) * 11. + vSeed * 17.);
    vec3 surface = mix(vTint * .62, mix(vTint, vec3(1.), .18), smoothstep(.15, .85, bands)) * (.93 + .07 * fine);
    // The core lights one side; a soft fill from the viewer keeps the face you see readable.
    float light = max(dot(vNormal, vLight), 0.);
    float fill = max(dot(vNormal, vView), 0.);
    vec3 color = surface * (.18 + .55 * light + .5 * fill);
    // A thin atmosphere glows at the rim, brighter on the lit side.
    float rim = pow(1. - max(dot(vNormal, vView), 0.), 2.5);
    color += vTint * rim * (.35 + .65 * light) * .9;
    gl_FragColor = vec4(color * vDim, vAlpha);
  }`;

export function CompanyPlanets({ geometry, range, galaxyRadius }: { geometry: BufferGeometry; range: Vector2; galaxyRadius: number }) {
  const planets = useMemo(() => {
    // Planets are only ever a few dozen pixels wide: a light sphere keeps vertex cost low.
    const sphere = new SphereGeometry(1, 16, 10);
    const result = new InstancedBufferGeometry();
    result.index = sphere.index;
    result.setAttribute('position', sphere.getAttribute('position'));
    const count = geometry.getAttribute('position').count;
    const copy = (name: string, size: number) => new InstancedBufferAttribute(new Float32Array(geometry.getAttribute(name).array), size);
    result.setAttribute('center', copy('position', 3));
    result.setAttribute('tint', copy('tint', 3));
    result.setAttribute('capScale', copy('capScale', 1));
    result.setAttribute('emphasis', copy('emphasis', 1));
    const fract = (value: number) => value - Math.floor(value);
    result.setAttribute('seed', new InstancedBufferAttribute(Float32Array.from({ length: count }, (_, i) => fract(Math.sin(i * 12.9898 + 1) * 43758.5453)), 1));
    result.instanceCount = count;
    return result;
  }, [geometry]);
  useEffect(() => () => planets.dispose(), [planets]);
  const uniforms = useMemo(() => ({ range: { value: range }, baseRadius: { value: galaxyRadius * .011 }, nearRange: { value: new Vector2(galaxyRadius * .05, galaxyRadius * .12) } }), [range, galaxyRadius]);
  const copiedVersion = useRef(-1);
  const mesh = useRef<Mesh>(null);
  // Follow the stars' hover and selection emphasis, which the graph animates per frame.
  useFrame(({ camera }) => {
    // Beyond the planet range every planet has faded out: skip the whole draw.
    if (mesh.current) mesh.current.visible = camera.position.length() < range.y + galaxyRadius * 1.1;
    const source = geometry.getAttribute('emphasis') as BufferAttribute, target = planets.getAttribute('emphasis');
    if (source.version === copiedVersion.current) return;
    (target.array as Float32Array).set(source.array as Float32Array);
    copiedVersion.current = source.version;
    target.needsUpdate = true;
  });
  return <mesh ref={mesh} geometry={planets} frustumCulled={false} raycast={() => {}}>
    <shaderMaterial uniforms={uniforms} vertexShader={vertex} fragmentShader={fragment} transparent toneMapped={false}/>
  </mesh>;
}
