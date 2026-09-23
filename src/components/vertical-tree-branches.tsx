"use client";

import { useEffect, useMemo, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, Material, Mesh, Texture } from 'three';
import type { TreePoint } from '@/lib/knowledge-graph/industry-tree';
import { createStrandWriter, verticalTreeDust, verticalTreeObjects, verticalTreeStrandGeometries, verticalTreeStrands } from '@/lib/knowledge-graph/vertical-tree-geometry';

// Curved, tapered ribbons keep the optical-fiber look inexpensive on phones.
// Their endpoints follow animated node groups, so branches grow with the tree.
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
  const write=useMemo(()=>createStrandWriter(),[]);
  const layerIds=useMemo(()=>nodes.filter(n=>n.kind==='layer').map(n=>n.id),[nodes]);
  useFrame(()=>{
    const map=groups.current;
    write(strands,geometries,id=>map.get(id)?.position,layerIds.map(id=>map.get(id)?.position.y??0));
  });
  return <>{objects.map(object=><primitive key={object.uuid} object={object}/>)}</>;
}
