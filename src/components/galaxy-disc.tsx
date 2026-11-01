"use client";

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Group, Quaternion, Vector3, type Mesh, type Points, type ShaderMaterial } from 'three';

// The company graph sits on an outer arm of a spiral galaxy, like the Sun in the
// Milky Way. The camera opens far enough out to frame the whole spiral, flies in
// to the graph, and the galaxy then settles behind the data.
const GALAXY_RADIUS = 6500;
const NORMAL = new Vector3(0, .82, .57).normalize();
// From the graph, the core lies behind, a little left and above the default view.
const ACROSS = new Vector3(1, 0, 0);
const AWAY = new Vector3().crossVectors(NORMAL, ACROSS).negate().normalize();
const TO_CORE = ACROSS.clone().multiplyScalar(-.45).add(AWAY).normalize();
const CORE = TO_CORE.clone().multiplyScalar(3000).addScaledVector(NORMAL, -250);
const ORIENTATION = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), NORMAL);
const STAR_COUNT = 14000;
const ARM_DUST_COUNT = 1250;
const HAZE_COUNT = 150;
// Full detail only pays off from afar: up close, large dust sprites dominate the
// frame cost while the galaxy is dimmed behind the data, so draw a thinned subset.
const NEAR_VIEW = 2500, FAR_VIEW = 9000;

/** Camera distance whose view frames the spiral around the graph. */
export function galaxyOpeningDistance(aspect: number) {
  // The camera opens on +z looking at the graph; the core sits deeper at CORE.z.
  const halfHeight = Math.tan(Math.PI / 8);
  const wide = (Math.abs(CORE.x) + GALAXY_RADIUS) * 1.08 / (halfHeight * aspect);
  const tall = (Math.abs(CORE.y) + GALAXY_RADIUS * Math.abs(AWAY.y)) * 1.12 / halfHeight;
  // Arms thin out well inside the nominal radius, so frame them a little tighter.
  return Math.min(24000, (Math.max(wide, tall) + CORE.z) * .95);
}

function random(index: number) {
  let value = Math.imul(index + 7547, 2654435761);
  value = Math.imul(value ^ (value >>> 15), 2246822519);
  return ((value ^ (value >>> 13)) >>> 0) / 4294967296;
}
function gauss(index: number) {
  return Math.sqrt(-2 * Math.log(random(index) + 1e-9)) * Math.cos(2 * Math.PI * random(index + 991));
}
// Two trailing logarithmic arms.
function armPoint(i: number, t: number, spread: number) {
  const radius = 300 + t * GALAXY_RADIUS;
  // Two main arms and two fainter spurs between them.
  const arm = random(i * 7 + 3) < .72 ? (i % 2) * Math.PI : (i % 2) * Math.PI + Math.PI / 2;
  const angle = arm + Math.log(radius / 300) / .46 + gauss(i * 7 + 1) * spread * (1 - .3 * t);
  const wobble = 1 + gauss(i * 7 + 2) * .1;
  return [Math.cos(angle) * radius * wobble, Math.sin(angle) * radius * wobble] as const;
}

const shared = `
  uniform float intensity; uniform float calmFloor; uniform float aspect; uniform float graphRadius;
  float calm(vec4 clip, vec3 world) {
    vec2 ndc = clip.xy / clip.w;
    float center = smoothstep(.12, .62, length(vec2(ndc.x * aspect, ndc.y)) * .5);
    float clear = smoothstep(graphRadius * 1.15, graphRadius * 2.2, length(world));
    return mix(calmFloor, 1., center) * clear * intensity;
  }`;

const starVertex = `attribute float size; varying vec3 tint; varying float alpha; ${shared}
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.);
    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;
    float pixels = size * 620. / max(1., -mv.z);
    gl_PointSize = clamp(pixels, 1., 3.6);
    tint = color;
    alpha = calm(gl_Position, world.xyz) * clamp(pixels, .25, 1.);
  }`;
const starFragment = `varying vec3 tint; varying float alpha;
  void main() { float r = length(gl_PointCoord - .5); float a = (1. - smoothstep(.15, .5, r)) * alpha; if (a < .01) discard; gl_FragColor = vec4(tint, a); }`;

const dustVertex = `attribute float size; varying vec3 tint; varying float alpha; ${shared}
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.);
    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * 620. / max(1., -mv.z), 2., 90.);
    tint = color;
    // Clumps right beside the camera would read as smudges on the lens.
    alpha = calm(gl_Position, world.xyz) * smoothstep(500., 1600., -mv.z);
  }`;
const dustFragment = `varying vec3 tint; varying float alpha;
  void main() { float r = length(gl_PointCoord - .5) * 2.; float a = exp(-r * r * 4.) * alpha; if (a < .004) discard; gl_FragColor = vec4(tint * a, 1.); }`;

const glowVertex = `uniform float glowSize; varying vec2 local; varying float alpha; ${shared}
  void main() {
    local = position.xy;
    vec4 mv = modelViewMatrix * vec4(0., 0., 0., 1.);
    mv.xy += position.xy * glowSize;
    gl_Position = projectionMatrix * mv;
    vec4 center = projectionMatrix * modelViewMatrix * vec4(0., 0., 0., 1.);
    alpha = calm(center, (modelMatrix * vec4(0., 0., 0., 1.)).xyz);
  }`;
const glowFragment = `uniform vec3 glowColor; uniform float falloff; varying vec2 local; varying float alpha;
  void main() { float r = length(local) * 2.; float a = exp(-r * r * falloff) * alpha; if (a < .003) discard; gl_FragColor = vec4(glowColor * a, 1.); }`;

function geometry(positions: number[], colors: number[], sizes: number[]) {
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(positions, 3));
  result.setAttribute('color', new Float32BufferAttribute(colors, 3));
  result.setAttribute('size', new Float32BufferAttribute(sizes, 1));
  result.computeBoundingSphere();
  return result;
}

export function GalaxyDisc({ graphRadius, introRef, focused }: { graphRadius: number; introRef: { current: boolean }; focused: boolean }) {
  const invalidate = useThree(state => state.invalidate);
  const spin = useRef<Group>(null);
  const starMaterial = useRef<ShaderMaterial>(null);
  const starPoints = useRef<Points>(null);
  const dustPoints = useRef<Points>(null);
  const halo = useRef<Mesh>(null);
  const reduced = useRef(false);
  const blend = useRef({ intensity: 1.3, intro: 1 });
  const uniforms = useMemo(() => ({ intensity: { value: 1 }, calmFloor: { value: .75 }, aspect: { value: 1 }, graphRadius: { value: 1 } }), []);
  const core = useMemo(() => ({ ...uniforms, glowSize: { value: 4200 }, glowColor: { value: new Vector3(1, .8, .9).multiplyScalar(.85) }, falloff: { value: 11 } }), [uniforms]);
  const haloGlow = useMemo(() => ({ ...uniforms, glowSize: { value: 11000 }, glowColor: { value: new Vector3(.42, .32, .78).multiplyScalar(.3) }, falloff: { value: 6 } }), [uniforms]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reduced.current = media.matches; };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const stars = useMemo(() => {
    const positions: number[] = [], colors: number[] = [], sizes: number[] = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      const kind = random(i * 3);
      let x: number, z: number, y: number, color: number[];
      if (kind < .22) {
        const r = Math.abs(gauss(i * 5)) * 900, a = random(i * 5 + 1) * Math.PI * 2;
        x = Math.cos(a) * r; z = Math.sin(a) * r; y = gauss(i * 5 + 2) * r * .45;
        color = random(i * 5 + 3) > .5 ? [1, .86, .76] : [1, .74, .86];
      } else if (kind < .84) {
        const t = Math.pow(random(i * 5 + 1), .9);
        [x, z] = armPoint(i, t, .5);
        y = gauss(i * 5 + 2) * (50 + 160 * (1 - t));
        const tone = random(i * 5 + 3);
        color = tone > .94 ? [1, .55, .82] : tone > .55 ? [.66, .78, 1] : [.82, .76, 1];
      } else {
        const r = Math.sqrt(random(i * 5 + 1)) * GALAXY_RADIUS * 1.15, a = random(i * 5 + 4) * Math.PI * 2;
        x = Math.cos(a) * r; z = Math.sin(a) * r; y = gauss(i * 5 + 2) * 140;
        color = [.74, .8, 1];
      }
      const brightness = .45 + random(i * 5 + 4) * .55;
      positions.push(x, y, z);
      colors.push(color[0] * brightness, color[1] * brightness, color[2] * brightness);
      sizes.push(9 + random(i * 5 + 6) * 14);
    }
    return geometry(positions, colors, sizes);
  }, []);
  const dust = useMemo(() => {
    const positions: number[] = [], colors: number[] = [], sizes: number[] = [];
    const palette = [[.42, .3, .95], [.3, .42, .95], [.72, .3, .85], [.95, .45, .75]];
    for (let i = 0; i < ARM_DUST_COUNT; i++) {
      const t = Math.pow(random(i * 11 + 1), .8);
      const [x, z] = armPoint(i + 50000, t, .24);
      const tone = palette[Math.floor(random(i * 11 + 2) * (t < .25 ? 4 : 3))];
      const strength = (.055 + random(i * 11 + 3) * .08) * (1.3 - t * .7);
      positions.push(x, gauss(i * 11 + 4) * 70, z);
      colors.push(tone[0] * strength, tone[1] * strength, tone[2] * strength);
      sizes.push(320 + random(i * 11 + 5) * 600);
    }
    // A faint disc haze fills the space between the arms.
    for (let i = 0; i < HAZE_COUNT; i++) {
      const r = Math.sqrt(random(i * 13 + 1)) * GALAXY_RADIUS * .85, a = random(i * 13 + 2) * Math.PI * 2;
      const strength = .011 * (1.2 - r / GALAXY_RADIUS);
      positions.push(Math.cos(a) * r, gauss(i * 13 + 3) * 90, Math.sin(a) * r);
      colors.push(.45 * strength, .4 * strength, .95 * strength);
      sizes.push(1600 + random(i * 13 + 4) * 1400);
    }
    return geometry(positions, colors, sizes);
  }, []);
  useEffect(() => () => { stars.dispose(); dust.dispose(); }, [stars, dust]);

  useFrame(({ size, camera }, delta) => {
    // Every galaxy material shares these uniform objects.
    const shared = starMaterial.current?.uniforms;
    if (!shared) return;
    shared.aspect.value = size.width / Math.max(1, size.height);
    shared.graphRadius.value = graphRadius;
    const intro = introRef.current;
    const target = intro ? 1.3 : focused ? .32 : .58;
    const step = 1 - Math.exp(-Math.min(delta, .1) * 1.4);
    const state = blend.current;
    state.intensity += (target - state.intensity) * step;
    state.intro += ((intro ? 1 : 0) - state.intro) * step;
    shared.intensity.value = state.intensity;
    shared.calmFloor.value = .28 + .5 * state.intro;
    if (Math.abs(target - state.intensity) > .005) invalidate();
    const wide = Math.min(1, Math.max(0, (camera.position.length() - NEAR_VIEW) / (FAR_VIEW - NEAR_VIEW)));
    starPoints.current?.geometry.setDrawRange(0, Math.round(STAR_COUNT * (.5 + .5 * wide)));
    // Arm dust comes first and the large disc haze last, so thinning drops the haze first.
    dustPoints.current?.geometry.setDrawRange(0, Math.round(ARM_DUST_COUNT * (.2 + .8 * wide)) + (wide > .5 ? HAZE_COUNT : 0));
    // The wide halo covers most of the frame, so it only draws while the whole spiral is in view.
    if (halo.current) halo.current.visible = wide > .6;
    // A slow turn rides on frames the camera already renders; it never wakes the loop.
    if (spin.current && !reduced.current) spin.current.rotation.y -= Math.min(delta, .1) * .006;
  });

  return <group name="galaxy-disc" position={CORE} quaternion={ORIENTATION}>
    <group ref={spin}>
      <points ref={starPoints} geometry={stars} renderOrder={-1} raycast={() => {}} frustumCulled={false}>
        <shaderMaterial ref={starMaterial} uniforms={uniforms} vertexShader={starVertex} fragmentShader={starFragment} transparent depthWrite={false} vertexColors toneMapped={false}/>
      </points>
      <points ref={dustPoints} geometry={dust} renderOrder={-1} raycast={() => {}} frustumCulled={false}>
        <shaderMaterial uniforms={uniforms} vertexShader={dustVertex} fragmentShader={dustFragment} transparent depthWrite={false} blending={AdditiveBlending} vertexColors toneMapped={false}/>
      </points>
    </group>
    {[haloGlow, core].map((glow, i) => <mesh key={i} ref={i ? undefined : halo} renderOrder={-1} raycast={() => {}} frustumCulled={false}>
      <planeGeometry args={[1, 1]}/>
      <shaderMaterial uniforms={glow} vertexShader={glowVertex} fragmentShader={glowFragment} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false}/>
    </mesh>)}
  </group>;
}
