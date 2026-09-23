"use client";

import { useEffect, useMemo, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, NormalBlending, Vector3, type Group } from 'three';
import type { TreePoint } from '@/lib/knowledge-graph/industry-tree';

const segments=24;
type Strand={from:string;to:string;kind:'trunk'|'root'|'limb';color:string;width:number;offset:number;layer?:string;branch?:string};
const trunkX=(y:number,top:number)=>Math.sin(y/Math.max(top,1)*Math.PI*1.5)*42;

// Curved, tapered ribbons keep the optical-fiber look inexpensive on phones.
// Their endpoints follow animated node groups, so branches grow with the tree.
export function VerticalTreeBranches({nodes,groups,focus}:{nodes:TreePoint[];groups:RefObject<Map<string,Group>>;focus:string}){
  const strands=useMemo(()=>{
    const layers=nodes.filter(n=>n.kind==='layer');
    const result:Strand[]=[];
    if(layers.length){
      for(let i=-7;i<=7;i++)result.push({from:'root',to:layers[layers.length-1].id,kind:'trunk',color:i===0?'#169ce8':i%2?'#3b9ff5':'#8de8ff',width:i===0?105:1.5,offset:i*11});
      for(let i=-21;i<=21;i++)if(i)result.push({from:'root',to:'root',kind:'root',color:i%3?'#3097dc':'#7bdcff',width:i%4?1.6:2.3,offset:i*126});
    }
    for(const n of nodes.filter(n=>n.parent)){
      const width=n.kind==='layer'?16:n.kind==='branch'?7:1.1;
      result.push({from:n.parent!,to:n.id,kind:'limb',color:n.color,width,offset:0,layer:n.layer,branch:n.branch});
      for(const offset of n.kind==='company'?[-6,6]:[-32,-21,-11,11,21,32])result.push({from:n.parent!,to:n.id,kind:'limb',color:n.color,width:n.kind==='company'?.35:.75,offset,layer:n.layer,branch:n.branch});
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
  const dust=useMemo(()=>{
    const geometry=new BufferGeometry();
    const byId=new Map(nodes.map(node=>[node.id,node]));
    const positions:number[]=[],colors:number[]=[];
    for(const node of nodes){
      const parent=node.parent&&byId.get(node.parent);if(!parent)continue;
      const color=new Color(node.color);
      const count=node.kind==='company'?9:25;
      for(let i=0;i<count;i++){
        const t=(i+.5)/count;
        const scatter=node.kind==='company'?100:26;
        const seed=Math.sin((i+1)*78.233+node.id.length*43.17)*43758.5453;
        const noise=seed-Math.floor(seed);
        positions.push(parent.position[0]+(node.position[0]-parent.position[0])*t+(noise-.5)*scatter,
          parent.position[1]+(node.position[1]-parent.position[1])*t+Math.sin(t*Math.PI)*(noise-.5)*scatter*2,-3);
        colors.push(...color.toArray());
      }
    }
    for(let i=-55;i<=55;i++)if(i){
      const x=i*48;
      const distance=Math.abs(x)/2800;
      const y=-180-300*Math.pow(distance,.72);
      const seed=Math.sin(i*16.319)*43758.5453;
      positions.push(x*.88+(seed-Math.floor(seed))*.12*x,y+(i%4)*14,-3);
      colors.push(...new Color(i%3?'#3285be':'#79c8f6').toArray());
    }
    geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
    geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
    return geometry;
  },[nodes]);
  useEffect(()=>()=>dust.dispose(),[dust]);
  const scratch=useMemo(()=>({a:new Vector3(),b:new Vector3(),p:new Vector3(),q:new Vector3()}),[]);
  useFrame(()=>{
    const root=groups.current.get('root');if(!root)return;
    const top=Math.max(1,...nodes.filter(n=>n.kind==='layer').map(n=>groups.current.get(n.id)?.position.y??0));
    strands.forEach((strand,index)=>{
      const source=groups.current.get(strand.from),target=groups.current.get(strand.to);if(!source||!target)return;
      const {a,b,p,q}=scratch;a.copy(source.position);b.copy(target.position);
      if(strand.kind==='trunk'){a.set(0,0,-4);b.set(trunkX(top,top),top+25,-4);}
      if(strand.kind==='root'){a.set(0,-8,-4);b.set(strand.offset,-180-300*Math.pow(Math.abs(strand.offset)/2800,.72)-45*Math.sin(Math.abs(strand.offset)*.008),-4);}
      if(strand.kind==='limb'&&strand.from==='root')a.set(trunkX(b.y-95,top),Math.max(0,b.y-95),-2);
      const point=(t:number,out:Vector3)=>{
        if(strand.kind==='trunk')return out.set(trunkX(b.y*t,top)+strand.offset*(1-t),b.y*t,-4);
        if(strand.kind==='root')return out.set(strand.offset*t*t*(3-2*t),b.y*Math.pow(t,.78)+28*Math.sin(Math.PI*t),-4);
        const u=1-t,dx=b.x-a.x;
        const c1x=a.x+dx*.22,c2x=b.x-dx*.35;
        const c1y=strand.from==='root'?a.y+Math.max(40,(b.y-a.y)*.55):a.y;
        out.set(u*u*u*a.x+3*u*u*t*c1x+3*u*t*t*c2x+t*t*t*b.x,u*u*u*a.y+3*u*u*t*c1y+3*u*t*t*b.y+t*t*t*b.y,-2);
        out.y+=strand.offset*Math.sin(Math.PI*t);return out;
      };
      for(let step=0;step<segments;step++){
        const t=step/segments;point(t,p);point((step+1)/segments,q);
        const dx=q.x-p.x,dy=q.y-p.y,length=Math.hypot(dx,dy)||1;
        const taper=(fraction:number)=>strand.kind==='trunk'?.28+.72*Math.pow(1-fraction,1.7):1-fraction*.58;
        const width=strand.width*taper(t);
        geometries.forEach((g,glow)=>{
          const w=width*(glow?2.6:1),nx=-dy/length*w,ny=dx/length*w;
          const nextWidth=strand.width*taper((step+1)/segments)*(glow?2.6:1);
          const qx=-dy/length*nextWidth,qy=dx/length*nextWidth;
          const pos=g.getAttribute('position'),base=(index*segments+step)*6;
          pos.setXYZ(base,p.x+nx,p.y+ny,p.z);pos.setXYZ(base+1,p.x-nx,p.y-ny,p.z);pos.setXYZ(base+2,q.x+qx,q.y+qy,q.z);
          pos.setXYZ(base+3,p.x-nx,p.y-ny,p.z);pos.setXYZ(base+4,q.x-qx,q.y-qy,q.z);pos.setXYZ(base+5,q.x+qx,q.y+qy,q.z);
        });
      }
    });
    geometries.forEach(g=>{g.getAttribute('position').needsUpdate=true;});
  });
  return <>
    <mesh position={[0,-12,-8]} scale={[2.5,.55,1]}><sphereGeometry args={[78,24,16]}/><meshBasicMaterial color="#4abbff" transparent opacity={.07} depthWrite={false} blending={AdditiveBlending}/></mesh>
    {geometries.map((geometry,i)=><mesh key={i} geometry={geometry} frustumCulled={false} renderOrder={-2+i}>
      <meshBasicMaterial vertexColors side={DoubleSide} transparent opacity={i?.06:.82} depthWrite={false} blending={i?AdditiveBlending:NormalBlending}/>
    </mesh>)}
    <points geometry={dust} frustumCulled={false}><pointsMaterial vertexColors size={2.4} sizeAttenuation={false} transparent opacity={.65} depthWrite={false} blending={AdditiveBlending}/></points>
  </>;
}
