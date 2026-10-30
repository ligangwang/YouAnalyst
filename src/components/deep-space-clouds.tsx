"use client";

import { Color, DoubleSide } from 'three';

// Distant, irregular dust clouds: fixed in world space so camera movement gives
// depth without an extra animation loop. No bright cores or spiral silhouettes.
const clouds = Array.from({ length: 5 }, (_, i) => {
  const angle = Math.PI - .38 + i * Math.PI * 2 / 5;
  const radius = 39000 + i % 2 * 4000;
  return {
    position: [Math.sin(angle) * radius, [8000, -6000, 12000, -2000, 5000][i], Math.cos(angle) * radius] as [number, number, number],
    rotation: [0, angle + Math.PI, -.35 + i * .63] as [number, number, number],
    scale: [36000, 23000 + i % 2 * 6000, 1] as [number, number, number],
    uniforms: {
      tint: { value: new Color(['#688fba', '#826eaf', '#53a0ad', '#657fae', '#8b729d'][i]) },
      seed: { value: i * 13.71 },
    },
  };
});

const fragmentShader = `
  varying vec2 cloudUv;
  uniform vec3 tint;
  uniform float seed;
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 cell = floor(p), f = fract(p);
    vec2 blend = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), blend.x),
      mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), blend.x), blend.y);
  }
  float dust(vec2 p) {
    float value = 0.0, weight = 0.57;
    for (int octave = 0; octave < 4; octave++) {
      value += weight * noise(p);
      p = mat2(1.6, -1.2, 1.2, 1.6) * p + 7.3;
      weight *= 0.48;
    }
    return value;
  }
  void main() {
    vec2 p = cloudUv * vec2(7.0, 4.8) + seed;
    float warp = noise(p * 0.7 + 4.6);
    float cloud = dust(p + vec2(warp * 2.1, warp * 0.8));
    float veil = smoothstep(0.32, 0.76, cloud);
    float lane = smoothstep(0.42, 0.65, dust(p * 1.4 + 19.0));
    // Fade on all sides without the oval outline of a galaxy sprite.
    vec2 edge = smoothstep(vec2(0.0), vec2(0.28), cloudUv)
      * smoothstep(vec2(0.0), vec2(0.28), 1.0 - cloudUv);
    float alpha = veil * (1.0 - lane * 0.75) * edge.x * edge.y * 0.42;
    if (alpha < 0.002) discard;
    vec3 color = mix(tint * 0.55, tint, smoothstep(0.45, 0.72, cloud));
    gl_FragColor = vec4(color, alpha);
  }
`;

export function DeepSpaceClouds({ height }: { height: number }) {
  return <group name="deep-space-clouds" position={[0, height / 2, 0]}>
    {clouds.map((cloud, i) => <mesh key={i} position={cloud.position} rotation={cloud.rotation} scale={cloud.scale} renderOrder={-2} raycast={() => {}}>
      <planeGeometry args={[1, 1]}/>
      <shaderMaterial transparent depthWrite={false} side={DoubleSide} toneMapped={false} uniforms={cloud.uniforms}
        vertexShader="varying vec2 cloudUv; void main() { cloudUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }"
        fragmentShader={fragmentShader}/>
    </mesh>)}
  </group>;
}
