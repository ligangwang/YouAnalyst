"use client";

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, Float32BufferAttribute, type ShaderMaterial } from 'three';

function starRandom(index: number) {
  let value = Math.imul(index + 7319, 374761393);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

// Fixed world positions, with two depths so the orbit has visible parallax.
// Twinkling uses the scene's frame loop; positions remain stationary.
export function TreeStarField({ height, paused }: { height: number; paused?: boolean }) {
  const material = useRef<ShaderMaterial>(null);
  const reduced = useRef(false);
  const uniforms = useMemo(() => ({ time: { value: 0 }, motion: { value: 1 } }), []);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reduced.current = media.matches; if (material.current) material.current.uniforms.motion.value = media.matches ? 0 : 1; };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useFrame((state, delta) => {
    if (paused || reduced.current || document.hidden || !material.current) return;
    material.current.uniforms.time.value += Math.min(delta, .1);
    state.invalidate();
  });
  const geometry = useMemo(() => {
    const positions: number[] = [], colors: number[] = [], sizes: number[] = [], sparkles: number[] = [];
    for (let i = 0; i < 2600; i++) {
      const near = i < 180;
      const angle = starRandom(i * 6) * Math.PI * 2;
      const radius = near ? 6200 + starRandom(i * 6 + 1) * 2200 : 18000 + starRandom(i * 6 + 1) * 9000;
      positions.push(Math.sin(angle) * radius, height / 2 + (starRandom(i * 6 + 2) - .5) * radius * 2.3, Math.cos(angle) * radius);
      const brightness = near ? .7 + starRandom(i * 6 + 3) * .25 : .4 + starRandom(i * 6 + 3) * .4;
      const warm = starRandom(i * 6 + 4) > .88;
      colors.push(brightness * (warm ? 1 : .72), brightness * .86, brightness * (warm ? .78 : 1));
      const shining = starRandom(i * 6 + 5) > .84;
      sizes.push(shining ? 7 + starRandom(i + 20000) * 4 : near ? 3.8 : 2 + starRandom(i * 6 + 5) * 1.5);
      sparkles.push(starRandom(i + 30000) * Math.PI * 2, .65 + starRandom(i + 40000) * .8, shining ? 1 : 0);
    }
    const result = new BufferGeometry();
    result.setAttribute('position', new Float32BufferAttribute(positions, 3));
    result.setAttribute('color', new Float32BufferAttribute(colors, 3));
    result.setAttribute('size', new Float32BufferAttribute(sizes, 1));
    result.setAttribute('sparkle', new Float32BufferAttribute(sparkles, 3));
    return result;
  }, [height]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <points geometry={geometry} renderOrder={-1}>
    <shaderMaterial ref={material} uniforms={uniforms} transparent depthWrite={false} vertexColors toneMapped={false}
      vertexShader={`attribute float size; attribute vec3 sparkle; uniform float time; uniform float motion;
        varying vec3 starColor; varying float shine; varying float brightness;
        void main() { starColor = color; shine = sparkle.z;
          float pulse = 0.5 + 0.5 * sin(time * sparkle.y + sparkle.x);
          brightness = mix(0.85, mix(0.5, 1.0, pulse), motion);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (1.0 + shine * pulse * motion * 0.15); }`}
      fragmentShader={`varying vec3 starColor; varying float shine; varying float brightness;
        void main() { vec2 p = gl_PointCoord - vec2(0.5); float r = length(p);
          float dotGlow = 1.0 - smoothstep(0.08, 0.5, r);
          float core = exp(-r * r * 110.0);
          float rays = (exp(-abs(p.x) * 65.0) + exp(-abs(p.y) * 65.0)) * (1.0 - smoothstep(0.0, 0.5, r));
          float alpha = mix(dotGlow, core + rays * 0.42 + dotGlow * 0.12, shine) * brightness;
          if (alpha < 0.01) discard; gl_FragColor = vec4(mix(starColor, vec3(0.9, 0.95, 1.0), shine * core), min(alpha, 1.0)); }`}
    />
  </points>;
}
