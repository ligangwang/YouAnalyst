"use client";

import { useEffect, useMemo, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Vector3, type Group } from 'three';
import type { TreePoint } from '@/lib/knowledge-graph/industry-tree';

const segments=24;
type Strand={from:string;to:string;kind:'trunk'|'root'|'limb';color:string;width:number;offset:number;layer?:string;branch?:string};
const trunkX=(y:number,top:number)=>Math.sin(y/Math.max(top,1)*Math.PI*1.5)*28;

// Curved, tapered ribbons keep the optical-fiber look inexpensive on phones.
// Their endpoints follow animated node groups, so branches grow with the tree.
export function VerticalTreeBranches({nodes,groups,focus}:{nodes:TreePoint[];groups:RefObject<Map<string,Group>>;focus:string}){
  const strands=useMemo(()=>{
    const layers=nodes.filter(n=>n.kind==='layer');
    const result:Strand[]=[];
    if(layers.length){
      for(let i=-3;i<=3;i++)result.push({from:'root',to:layers[layers.length-1].id,kind:'trunk',color:i%2?'#54c5ff':'#8df1ed',width:i===0?14:.65,offset:i*6});
      for(let i=-4;i<=4;i++)if(i)result.push({from:'root',to:'root',kind:'root',color:'#428daa',width:.65,offset:i*44});
    }
    for(const n of nodes.filter(n=>n.parent)){
      const width=n.kind==='layer'?3.6:n.kind==='branch'?1.9:.7;
      result.push({from:n.parent!,to:n.id,kind:'limb',color:n.color,width,offset:0,layer:n.layer,branch:n.branch});
      if(n.kind!=='company')for(const offset of [-20,-9,9,20])result.push({from:n.parent!,to:n.id,kind:'limb',color:n.color,width:.5,offset,layer:n.layer,branch:n.branch});
    }
    return result;
  },[nodes]);
  const geometries=useMemo(()=>[1,3.5].map(()=>{
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new Float32BufferAttribute(new Float32Array(strands.length*segments*18),3));
    geometry.setAttribute('color',new Float32BufferAttribute(strands.flatMap(s=>{
      const color=new Color(s.color).multiplyScalar(!focus||s.kind!=='limb'||s.layer===focus||s.branch===focus?1:.25);
      return Array.from({length:segments*6},()=>color.toArray()).flat();
    }),3));return geometry;
  }),[strands,focus]);
  useEffect(()=>()=>geometries.forEach(g=>g.dispose()),[geometries]);
  const scratch=useMemo(()=>({a:new Vector3(),b:new Vector3(),p:new Vector3(),q:new Vector3()}),[]);
  useFrame(()=>{
    const root=groups.current.get('root');if(!root)return;
    const top=Math.max(1,...nodes.filter(n=>n.kind==='layer').map(n=>groups.current.get(n.id)?.position.y??0));
    strands.forEach((strand,index)=>{
      const source=groups.current.get(strand.from),target=groups.current.get(strand.to);if(!source||!target)return;
      const {a,b,p,q}=scratch;a.copy(source.position);b.copy(target.position);
      if(strand.kind==='trunk'){a.set(0,0,-4);b.set(trunkX(top,top),top+25,-4);}
      if(strand.kind==='root'){a.set(0,0,-4);b.set(strand.offset,-75-Math.abs(strand.offset)*.12,-4);}
      if(strand.kind==='limb'&&strand.from==='root')a.set(trunkX(b.y-95,top),Math.max(0,b.y-95),-2);
      const point=(t:number,out:Vector3)=>{
        if(strand.kind==='trunk')return out.set(trunkX(b.y*t,top)+strand.offset*(1-t),b.y*t,-4);
        if(strand.kind==='root')return out.set(strand.offset*t*t,-35*t-40*(1-(1-t)**3),-4);
        const u=1-t,dx=b.x-a.x;
        const c1x=a.x+dx*.22,c2x=b.x-dx*.35;
        const c1y=strand.from==='root'?a.y+Math.max(40,(b.y-a.y)*.55):a.y;
        out.set(u*u*u*a.x+3*u*u*t*c1x+3*u*t*t*c2x+t*t*t*b.x,u*u*u*a.y+3*u*u*t*c1y+3*u*t*t*b.y+t*t*t*b.y,-2);
        out.y+=strand.offset*Math.sin(Math.PI*t);return out;
      };
      for(let step=0;step<segments;step++){
        const t=step/segments;point(t,p);point((step+1)/segments,q);
        const dx=q.x-p.x,dy=q.y-p.y,length=Math.hypot(dx,dy)||1;
        const width=strand.width*(strand.kind==='trunk'?1-t*.8:1-t*.55);
        geometries.forEach((g,glow)=>{
          const w=width*(glow?3.5:1),nx=-dy/length*w,ny=dx/length*w;
          const pos=g.getAttribute('position'),base=(index*segments+step)*6;
          pos.setXYZ(base,p.x+nx,p.y+ny,p.z);pos.setXYZ(base+1,p.x-nx,p.y-ny,p.z);pos.setXYZ(base+2,q.x+nx,q.y+ny,q.z);
          pos.setXYZ(base+3,p.x-nx,p.y-ny,p.z);pos.setXYZ(base+4,q.x-nx,q.y-ny,q.z);pos.setXYZ(base+5,q.x+nx,q.y+ny,q.z);
        });
      }
    });
    geometries.forEach(g=>{g.getAttribute('position').needsUpdate=true;});
  });
  return <>{geometries.map((geometry,i)=><mesh key={i} geometry={geometry} frustumCulled={false} renderOrder={-2+i}>
    <meshBasicMaterial vertexColors side={DoubleSide} transparent opacity={i?.09:.62} depthWrite={false} blending={AdditiveBlending}/>
  </mesh>)}</>;
}
