"use client";

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AddEquation, BufferGeometry, Color, CustomBlending, Float32BufferAttribute, OneFactor, Vector3, ZeroFactor, type Points, type ShaderMaterial } from 'three';
import { galaxyArmPoint, galaxyToWorld, type GalaxyArm } from '@/lib/knowledge-graph/layout-galaxy';

// The nebula is made of the companies: every company carries a swarm of stars
// and dust in its sector colour, and each sector arm is filled with the same
// light, so from afar the companies read as a spiral nebula.
const addLight = { blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor } as const;

type NebulaNode = { x: number; y: number; z: number; galaxyArm: number };

function random(index: number) {
  let value = Math.imul(index + 4219, 2654435761);
  value = Math.imul(value ^ (value >>> 15), 2246822519);
  return ((value ^ (value >>> 13)) >>> 0) / 4294967296;
}
function gauss(index: number) {
  return Math.sqrt(-2 * Math.log(random(index) + 1e-9)) * Math.cos(2 * Math.PI * random(index + 7919));
}

const starVertex = `attribute float size; uniform float intensity; varying vec3 tint; varying float alpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.);
    gl_Position = projectionMatrix * mv;
    float pixels = size * 620. / max(1., -mv.z);
    gl_PointSize = clamp(pixels, 1., 3.4);
    tint = color; alpha = intensity * clamp(pixels, .3, 1.);
  }`;
const starFragment = `varying vec3 tint; varying float alpha;
  void main() { float r = length(gl_PointCoord - .5); float a = (1. - smoothstep(.15, .5, r)) * alpha; if (a < .01) discard; gl_FragColor = vec4(tint, a); }`;
const dustVertex = `attribute float size; uniform float intensity; uniform float nearFade; varying vec3 tint; varying float alpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(size * 620. / max(1., -mv.z), 2., 60.);
    tint = color;
    // Clouds right beside the camera would read as smudges on the lens.
    alpha = intensity * smoothstep(nearFade * .4, nearFade, -mv.z);
  }`;
const dustFragment = `varying vec3 tint; varying float alpha;
  void main() { float r = length(gl_PointCoord - .5) * 2.; float a = exp(-r * r * 4.) * alpha; if (a < .004) discard; gl_FragColor = vec4(tint * a, 1.); }`;
const glowVertex = `uniform float glowSize; uniform float intensity; varying vec2 local; varying float alpha;
  void main() {
    local = position.xy;
    vec4 mv = modelViewMatrix * vec4(0., 0., 0., 1.);
    mv.xy += position.xy * glowSize;
    gl_Position = projectionMatrix * mv;
    alpha = intensity;
  }`;
const glowFragment = `uniform vec3 glowColor; varying vec2 local; varying float alpha;
  void main() { float r = length(local) * 2.; float a = exp(-r * r * 7.) * alpha; if (a < .003) discard; gl_FragColor = vec4(glowColor * a, 1.); }`;

function geometry(positions: number[], colors: number[], sizes: number[]) {
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(positions, 3));
  result.setAttribute('color', new Float32BufferAttribute(colors, 3));
  result.setAttribute('size', new Float32BufferAttribute(sizes, 1));
  result.computeBoundingSphere();
  return result;
}

export function CompanyNebula({ nodes, arms, galaxyRadius, introRef, focused }: { nodes: NebulaNode[]; arms: GalaxyArm[]; galaxyRadius: number; introRef: { current: boolean }; focused: boolean }) {
  const invalidate = useThree(state => state.invalidate);
  const starMaterial = useRef<ShaderMaterial>(null);
  const dustPoints = useRef<Points>(null);
  const blend = useRef(1.2);
  const reduced = useRef(false);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reduced.current = media.matches; invalidate(); };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [invalidate]);
  const R = galaxyRadius;
  const uniforms = useMemo(() => ({ intensity: { value: 1.2 }, nearFade: { value: R * .3 } }), [R]);
  const core = useMemo(() => ({ ...uniforms, glowSize: { value: R * .5 }, glowColor: { value: new Vector3(1, .82, .92).multiplyScalar(.38) } }), [uniforms, R]);

  const { stars, dust, dustCount } = useMemo(() => {
    const armColors = arms.map(arm => new Color(arm.color));
    const starPositions: number[] = [], starColors: number[] = [], starSizes: number[] = [];
    const dustPositions: number[] = [], dustColors: number[] = [], dustSizes: number[] = [];
    let seed = 0;
    const disc = (x: number, y: number, z: number) => galaxyToWorld(x, y, z);
    const star = (p: { x: number; y: number; z: number }, color: Color, brightness: number, size: number) => {
      starPositions.push(p.x, p.y, p.z);
      const white = .35 * random(seed++);
      starColors.push((color.r + (1 - color.r) * white) * brightness, (color.g + (1 - color.g) * white) * brightness, (color.b + (1 - color.b) * white) * brightness);
      starSizes.push(size);
    };
    const cloud = (p: { x: number; y: number; z: number }, color: Color, strength: number, size: number) => {
      dustPositions.push(p.x, p.y, p.z);
      dustColors.push(color.r * strength, color.g * strength, color.b * strength);
      dustSizes.push(size);
    };
    // Each sector arm: a continuous lane of stars and dust from the core outwards.
    arms.forEach((arm, a) => {
      for (let i = 0; i < 700; i++) {
        const t = Math.pow(random(seed++), .8), r = R * (.12 + .92 * t);
        const angle = galaxyArmPoint(r, arm.angle, R) + gauss(seed++) * .3 * (1 - .3 * t);
        const p = disc(Math.cos(angle) * r, gauss(seed++) * R * .025 * (1 - .5 * t), Math.sin(angle) * r);
        star(p, armColors[a], .35 + random(seed++) * .5, 3 + random(seed++) * 4);
      }
      for (let i = 0; i < 240; i++) {
        const t = Math.pow(random(seed++), .85), r = R * (.12 + .9 * t);
        const angle = galaxyArmPoint(r, arm.angle, R) + gauss(seed++) * .14;
        const p = disc(Math.cos(angle) * r, gauss(seed++) * R * .015, Math.sin(angle) * r);
        cloud(p, armColors[a], (.05 + random(seed++) * .06) * (1.2 - .5 * t), R * (.05 + random(seed++) * .07));
      }
    });
    // Each company: a bright knot of its own stars and dust inside the arm.
    for (const node of nodes) {
      const color = armColors[node.galaxyArm] ?? new Color('#b6c3d2');
      for (let i = 0; i < 45; i++) {
        const offset = disc(gauss(seed++) * R * .035, gauss(seed++) * R * .012, gauss(seed++) * R * .035);
        star({ x: node.x + offset.x, y: node.y + offset.y, z: node.z + offset.z }, color, .5 + random(seed++) * .5, 3 + random(seed++) * 4);
      }
      for (let i = 0; i < 4; i++) {
        const offset = disc(gauss(seed++) * R * .03, gauss(seed++) * R * .01, gauss(seed++) * R * .03);
        cloud({ x: node.x + offset.x, y: node.y + offset.y, z: node.z + offset.z }, color, .08 + random(seed++) * .05, R * (.04 + random(seed++) * .04));
      }
    }
    // The core: a warm bulge where the arms meet.
    const warm = new Color(1, .86, .8);
    for (let i = 0; i < 800; i++) {
      const r = Math.abs(gauss(seed++)) * R * .08, a = random(seed++) * Math.PI * 2;
      star(disc(Math.cos(a) * r, gauss(seed++) * r * .4, Math.sin(a) * r), warm, .35 + random(seed++) * .4, 3 + random(seed++) * 3);
    }
    return { stars: geometry(starPositions, starColors, starSizes), dust: geometry(dustPositions, dustColors, dustSizes), dustCount: dustSizes.length };
  }, [nodes, arms, R]);
  useEffect(() => () => { stars.dispose(); dust.dispose(); }, [stars, dust]);

  useFrame(({ camera }, delta) => {
    const shared = starMaterial.current?.uniforms;
    if (!shared) return;
    const target = introRef.current ? 1.2 : focused ? .35 : .75;
    // Each easing frame redraws the whole graph: keep it short, and skip it for reduced motion.
    blend.current = reduced.current ? target : blend.current + (target - blend.current) * (1 - Math.exp(-Math.min(delta, .1) * 4));
    if (Math.abs(target - blend.current) < .01) blend.current = target;
    shared.intensity.value = blend.current;
    if (blend.current !== target) invalidate();
    // Up close, large dust sprites dominate the frame cost: draw a thinned subset.
    const wide = Math.min(1, Math.max(0, (camera.position.length() - R * 1.2) / (R * 3)));
    dustPoints.current?.geometry.setDrawRange(0, Math.round(dustCount * (.2 + .8 * wide)));
  });

  return <group name="company-nebula">
    <points geometry={stars} renderOrder={-1} raycast={() => {}} frustumCulled={false}>
      <shaderMaterial ref={starMaterial} uniforms={uniforms} vertexShader={starVertex} fragmentShader={starFragment} transparent depthWrite={false} vertexColors toneMapped={false}/>
    </points>
    <points ref={dustPoints} geometry={dust} renderOrder={-1} raycast={() => {}} frustumCulled={false}>
      <shaderMaterial uniforms={uniforms} vertexShader={dustVertex} fragmentShader={dustFragment} transparent depthWrite={false} {...addLight} vertexColors toneMapped={false}/>
    </points>
    <mesh renderOrder={-1} raycast={() => {}} frustumCulled={false}>
      <planeGeometry args={[1, 1]}/>
      <shaderMaterial uniforms={core} vertexShader={glowVertex} fragmentShader={glowFragment} transparent depthWrite={false} {...addLight} toneMapped={false}/>
    </mesh>
  </group>;
}
