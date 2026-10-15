"use client";

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, Material, Mesh, Texture } from 'three';
import type { TreePoint } from '@/lib/ui/knowledge-graph/industry-tree';
import { createStrandWriter, verticalTreeDust, verticalTreeObjects, verticalTreeStrandGeometries, verticalTreeStrands } from '@/lib/ui/knowledge-graph/vertical-tree-geometry';

// Tapered, shaded tubes give the wood depth while sharing geometry on phones.
// Their endpoints follow animated node groups, so branches move with the tree.
export function VerticalTreeBranches({nodes,groups,focus}:{nodes:TreePoint[];groups:RefObject<Map<string,Group>>;focus:string}){
  const strands=useMemo(()=>verticalTreeStrands(nodes),[nodes]);
  const geometries=useMemo(()=>verticalTreeStrandGeometries(strands,focus),[strands,focus]);
  const dust=useMemo(()=>verticalTreeDust(nodes),[nodes]);
  const objects=useMemo(()=>verticalTreeObjects(geometries,dust),[geometries,dust]);
  useEffect(()=>()=>{
    for(const object of objects){
      const {geometry,material}=object as Mesh;const disposable=material as Material&{map?:Texture|null};
      disposable.map?.dispose();disposable.dispose();geometry.dispose();
    }
  },[objects]);
  const colors=useMemo(()=>geometries.map(g=>({base:new Float32Array(g.getAttribute('color').array),alpha:new Map<string,number>()})),[geometries]);
  const write=useMemo(()=>createStrandWriter(),[]);
  const layerIds=useMemo(()=>nodes.filter(n=>n.kind==='layer').map(n=>n.id),[nodes]);
  const previous=useRef<{geometries:typeof geometries;positions:number[]}|null>(null);
  useFrame(()=>{
    const map=groups.current;
    // Fade each ribbon with its endpoint, retaining collapsing ribbons until the exit ends.
    geometries.forEach((geometry,index)=>{
      const color=geometry.getAttribute('color'),{base,alpha}=colors[index];
      let changed=false;
      const count=strands.length?color.count/strands.length:0;
      strands.forEach((strand,j)=>{
        const wood=['trunk','fiber','ring'].includes(strand.kind);
        // Energy is present from the first growth stage and fades when the
        // whole tree collapses; the persistent title/root group does not.
        const opacity=Number(map.get(wood||strand.kind==='root'?(layerIds.includes('energy')?'energy':layerIds[0]):strand.to)?.userData.presenceAlpha??0);
        const key=String(j);if(alpha.get(key)===opacity)return;alpha.set(key,opacity);changed=true;
        for(let k=j*count;k<(j+1)*count;k++)color.setW(k,base[k*4+3]*opacity);
      });
      if(changed)color.needsUpdate=true;
    });
    const positions=nodes.flatMap(n=>{const p=map.get(n.id)?.position;return [p?.x??0,p?.y??0,p?.z??0];});
    if(previous.current?.geometries===geometries&&positions.every((v,i)=>v===previous.current!.positions[i]))return;
    previous.current={geometries,positions};
    write(strands,geometries,id=>map.get(id)?.position,layerIds.map(id=>map.get(id)?.position.y??0));
    colors.forEach(c=>c.alpha.clear());
  });
  return <>{objects.map(object=><primitive key={object.uuid} object={object}/>)}</>;
}
