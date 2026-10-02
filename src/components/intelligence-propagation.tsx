"use client";
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { layout3D } from '@/lib/knowledge-graph/layout-3d';

export function IntelligencePropagation({layout,origin,edges}:{layout:ReturnType<typeof layout3D>;origin:string;edges:string[]}) {
  const dots=useRef<(Mesh|null)[]>([]),rings=useRef<(Mesh|null)[]>([]),elapsed=useRef(0),reduced=useRef(false);
  const {invalidate}=useThree();
  useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>{reduced.current=media.matches;invalidate();};update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[invalidate]);
  useEffect(()=>{elapsed.current=0;invalidate();},[origin,edges,invalidate]);
  const paths=useMemo(()=>{const positions=new Map(layout.nodes.map(n=>[n.id,n]));return layout.edges.filter(e=>edges.includes(e.id)&&(e.source===origin||e.target===origin)).flatMap(e=>{const a=positions.get(origin),b=positions.get(e.source===origin?e.target:e.source);return a&&b?[{a:new Vector3(a.x,a.y,a.z),b:new Vector3(b.x,b.y,b.z)}]:[];});},[layout,origin,edges]);
  const center=layout.nodes.find(n=>n.id===origin);
  useFrame(({camera},delta)=>{
    elapsed.current+=Math.min(delta,.05);
    paths.forEach((p,i)=>{const dot=dots.current[i];if(dot)dot.position.copy(p.a).lerp(p.b,reduced.current?.5:(elapsed.current/2.6+i*.17)%1);});
    rings.current.forEach((ring,i)=>{if(ring){const phase=reduced.current?.25:(elapsed.current/2.5+i*.5)%1;ring.quaternion.copy(camera.quaternion);ring.scale.setScalar(1+phase*2.5);(ring.material as MeshBasicMaterial).opacity=(1-phase)*.5;}});
    if(!reduced.current&&(paths.length||center))invalidate();
  });
  return <group>{paths.map((p,i)=><mesh key={i} ref={m=>{dots.current[i]=m;}} position={p.a}><sphereGeometry args={[1.7,8,8]}/><meshBasicMaterial color="#97efdf" toneMapped={false}/></mesh>)}{center&&[0,1].map(i=><mesh key={i} ref={m=>{rings.current[i]=m;}} position={[center.x,center.y,center.z]}><ringGeometry args={[7,7.5,48]}/><meshBasicMaterial color="#97efdf" transparent opacity={.4} depthWrite={false}/></mesh>)}</group>;
}
