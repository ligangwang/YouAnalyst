"use client";

import { Color, DoubleSide } from 'three';

// Stationary background landmarks beyond both star layers. Their different
// inclinations and warm cores stay subtle while the camera travels around them.
const galaxies = Array.from({ length: 7 }, (_, i) => {
  const angle = Math.PI - .27 + i * Math.PI * 2 / 7;
  const radius = 38000 + (i % 3) * 3000;
  return {
    position: [Math.sin(angle) * radius, [-800, 4200, -3500, 7000, 1600, -2200, 5500][i], Math.cos(angle) * radius] as [number, number, number],
    rotation: [0, angle + Math.PI, .45 + i * .81] as [number, number, number],
    scale: [6500 + (i % 3) * 700, 4500 + (i % 2) * 1500, 1] as [number, number, number],
    uniforms: {
      tint: { value: new Color(['#879dde', '#bc9ee0', '#7baac6'][i % 3]) },
      inclination: { value: [.56, .8, .36, .65, .42, .72, .5][i] },
      phase: { value: i * 1.7 },
    },
  };
});

export function TreeGalaxies({ height }: { height: number }) {
  return <group position={[0, height / 2, 0]}>
    {galaxies.map((galaxy, i) => <mesh key={i} position={galaxy.position} rotation={galaxy.rotation} scale={galaxy.scale} renderOrder={-2}>
      <planeGeometry args={[1, 1]}/>
      <shaderMaterial transparent depthWrite={false} side={DoubleSide} toneMapped={false} uniforms={galaxy.uniforms}
        vertexShader={`varying vec2 galaxyUv;
          void main() { galaxyUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`}
        fragmentShader={`varying vec2 galaxyUv; uniform vec3 tint; uniform float inclination; uniform float phase;
          float grain(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          void main() {
            vec2 p = (galaxyUv - 0.5) * 2.0; p.y /= inclination;
            float r = length(p); float angle = atan(p.y, p.x);
            float envelope = exp(-r * 4.5) * (1.0 - smoothstep(0.65, 0.95, r));
            float winding = angle * 2.0 - log(r + 0.06) * 5.0 + phase;
            float arms = pow(0.5 + 0.5 * cos(winding), 7.0);
            float dust = 0.65 + 0.35 * grain(floor(p * 180.0));
            float core = exp(-r * r * 230.0);
            float glow = envelope * (0.12 + arms * 1.15) * dust;
            vec3 light = mix(tint, vec3(1.0, 0.85, 0.68), core);
            float fade = 1.0 - smoothstep(0.85, 1.0, length((galaxyUv - 0.5) * 2.0));
            float alpha = min(0.7, (glow + core * 0.65) * 0.8) * fade;
            if (alpha < 0.002) discard;
            gl_FragColor = vec4(light, alpha);
          }`}
      />
    </mesh>)}
  </group>;
}
