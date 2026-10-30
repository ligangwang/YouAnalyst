"use client";

import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { BackSide, BufferGeometry, Float32BufferAttribute, Vector2 } from 'three';

const SKY_RADIUS = 60000;
// The galactic plane crosses the default view diagonally; its bright bulge sits
// off to one side so the company cluster stays over darker sky.
const PLANE = [.45, .89, .08];
const BULGE = [-.71, .36, -.6];

function skyRandom(index: number) {
  let value = Math.imul(index + 1931, 2654435761);
  value = Math.imul(value ^ (value >>> 15), 2246822519);
  return ((value ^ (value >>> 13)) >>> 0) / 4294967296;
}

function normalize([x, y, z]: number[]) {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

const skyVertex = `varying vec3 skyDirection; void main() { skyDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// A static, full-sphere sky: a luminous galactic band with dust lanes and two
// faint emission nebulae. It has no time uniform, so the demand frameloop stays asleep.
const skyFragment = `
  varying vec3 skyDirection;
  uniform vec3 plane;
  uniform vec3 bulgeDirection;
  uniform vec2 resolution;
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 p) {
    vec3 cell = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(cell), hash(cell + vec3(1, 0, 0)), f.x), mix(hash(cell + vec3(0, 1, 0)), hash(cell + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(cell + vec3(0, 0, 1)), hash(cell + vec3(1, 0, 1)), f.x), mix(hash(cell + vec3(0, 1, 1)), hash(cell + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float value = 0.0, weight = 0.5;
    for (int octave = 0; octave < 5; octave++) {
      value += weight * noise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      weight *= 0.5;
    }
    return value;
  }
  void main() {
    vec3 d = normalize(skyDirection);
    float warp = fbm(d * 2.6 + 7.0) - 0.5;
    float latitude = dot(d, plane) + warp * 0.14;
    float band = exp(-latitude * latitude / 0.022);
    float haze = exp(-latitude * latitude / 0.16);
    float bulge = pow(max(dot(d, bulgeDirection), 0.0), 5.0);
    float detail = fbm(d * 7.0 + 2.0);
    float lanes = smoothstep(0.48, 0.68, fbm(d * 11.0 + vec3(3.0, -4.0, 9.0))) * band;
    float ridge = 1.0 - abs(fbm(d * 5.0 + vec3(4.0)) * 2.0 - 1.0);
    float filaments = ridge * ridge * ridge * ridge;

    vec3 light = vec3(0.0);
    vec3 milky = mix(vec3(0.34, 0.46, 0.86), vec3(0.92, 0.8, 0.68), bulge);
    light += milky * band * (0.16 + 0.42 * detail * detail) * (1.0 - lanes * 0.85);
    light += vec3(0.92, 0.78, 0.64) * bulge * (band * 0.18 + haze * 0.05) * (1.0 - lanes * 0.7);

    float cyan = smoothstep(0.5, 0.82, fbm(d * 1.9 + vec3(11.0, 3.0, -2.0)));
    float magenta = smoothstep(0.52, 0.84, fbm(d * 2.3 + vec3(-5.0, 2.0, 8.0)));
    light += vec3(0.04, 0.48, 0.7) * cyan * (0.12 + filaments * 0.5);
    light += vec3(0.5, 0.12, 0.66) * magenta * (0.08 + filaments * 0.36);
    light += vec3(0.85, 0.3, 0.55) * cyan * magenta * filaments * 0.2;

    // Keep the sky calm behind the company cluster so sector colors keep their
    // contrast; the galaxy and nebulae stay vivid toward the frame edges.
    vec2 screen = (gl_FragCoord.xy / resolution - 0.5) * vec2(resolution.x / resolution.y, 1.0);
    float calm = smoothstep(0.12, 0.62, length(screen * vec2(0.8, 1.0)));
    vec3 sky = mix(vec3(0.012, 0.02, 0.05), vec3(0.03, 0.04, 0.095), haze) + light * mix(0.28, 1.0, calm);

    // A small dither keeps the dark gradients from banding on 8-bit displays.
    sky += (hash(d * 4000.0) - 0.5) / 255.0;
    gl_FragColor = vec4(sky, 1.0);
  }
`;

const bandVertex = `attribute float size; varying vec3 starColor;
  void main() { starColor = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = size; }`;
const bandFragment = `varying vec3 starColor;
  void main() { float r = length(gl_PointCoord - 0.5); float alpha = 1.0 - smoothstep(0.1, 0.5, r); if (alpha < 0.02) discard; gl_FragColor = vec4(starColor, alpha); }`;

export function DeepSpaceSky({ height }: { height: number }) {
  const { gl, size } = useThree();
  const uniforms = useMemo(() => ({ plane: { value: normalize(PLANE) }, bulgeDirection: { value: normalize(BULGE) }, resolution: { value: new Vector2(1, 1) } }), []);
  useEffect(() => { gl.getDrawingBufferSize(uniforms.resolution.value); }, [gl, size, uniforms]);
  // Fine stars crowd the galactic band and thin out toward its edges.
  const bandStars = useMemo(() => {
    const plane = normalize(PLANE), bulge = normalize(BULGE);
    const across = normalize([plane[1] * bulge[2] - plane[2] * bulge[1], plane[2] * bulge[0] - plane[0] * bulge[2], plane[0] * bulge[1] - plane[1] * bulge[0]]);
    const positions: number[] = [], colors: number[] = [], sizes: number[] = [];
    for (let i = 0; i < 3200; i++) {
      const angle = skyRandom(i * 5) * Math.PI * 2;
      const spread = (skyRandom(i * 5 + 1) + skyRandom(i * 5 + 2) + skyRandom(i * 5 + 3) - 1.5) * .34;
      const direction = normalize([0, 1, 2].map(axis => Math.cos(angle) * bulge[axis] + Math.sin(angle) * across[axis] + spread * plane[axis]));
      const radius = SKY_RADIUS * .92;
      positions.push(direction[0] * radius, direction[1] * radius, direction[2] * radius);
      const tone = skyRandom(i * 5 + 4), brightness = .45 + skyRandom(i + 90000) * .55;
      const [r, g, b] = tone > .9 ? [1, .78, .55] : tone > .78 ? [.62, .86, 1] : [.82, .86, 1];
      colors.push(r * brightness, g * brightness, b * brightness);
      sizes.push(1.4 + skyRandom(i + 70000) * 1.6);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.setAttribute('size', new Float32BufferAttribute(sizes, 1));
    return geometry;
  }, []);
  useEffect(() => () => bandStars.dispose(), [bandStars]);
  return <group name="deep-space-sky" position={[0, height / 2, 0]}>
    <mesh renderOrder={-3} raycast={() => {}} frustumCulled={false}>
      <sphereGeometry args={[SKY_RADIUS, 64, 32]}/>
      <shaderMaterial side={BackSide} depthWrite={false} toneMapped={false} uniforms={uniforms} vertexShader={skyVertex} fragmentShader={skyFragment}/>
    </mesh>
    <points geometry={bandStars} renderOrder={-2} raycast={() => {}} frustumCulled={false}>
      <shaderMaterial transparent depthWrite={false} vertexColors toneMapped={false} vertexShader={bandVertex} fragmentShader={bandFragment}/>
    </points>
  </group>;
}
