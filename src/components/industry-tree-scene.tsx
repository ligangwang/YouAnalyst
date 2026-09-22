"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { CameraControls, Html } from '@react-three/drei';
import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, Vector3, type Group, type Mesh } from 'three';
import { layoutIndustryTree, type TreeLayer, type TreePoint } from '@/lib/knowledge-graph/industry-tree';
import { marketCapDescription, marketCapLabel, marketCapScale } from '@/lib/knowledge-graph/market-cap';
import { useLocale } from './providers/locale-provider';
import styles from './industry-tree.module.css';

export type TreeSceneProps={layers:TreeLayer[];open:string[];focus:string;selected:string;followedIds:string[];request:number;onToggle:(id:string)=>void;onSelect:(id:string)=>void;onUnavailable:()=>void};
const flags=new Set(['CA','CN','FR','GB','IE','NL','SG','TW','US']);
class Boundary extends Component<{children:ReactNode;onUnavailable:()=>void},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onUnavailable();}
  render(){return this.state.failed?null:this.props.children;}
}
function Scene(props:TreeSceneProps){
  const {locale,text}=useLocale();
  const {size,invalidate,gl}=useThree();
  const {onUnavailable}=props;
  useEffect(()=>{const canvas=gl.domElement;const lost=()=>onUnavailable();canvas.addEventListener("webglcontextlost",lost);return ()=>canvas.removeEventListener("webglcontextlost",lost);},[gl,onUnavailable]);
  const controls=useRef<CameraControls>(null);
  const groups=useRef(new Map<string,Group>());
  const particles=useRef(new Map<string,Mesh>());
  const reduced=useRef(false);
  const nodes=useMemo(()=>layoutIndustryTree(props.layers,new Set(props.open),locale),[props.layers,props.open,locale]);
  const all=useMemo(()=>layoutIndustryTree(props.layers,new Set(['root',...props.layers.flatMap(l=>[l.id,...l.branches.map(b=>b.id)])]),locale),[props.layers,locale]);
  const targets=useMemo(()=>{
    const visible=new Map(nodes.map(n=>[n.id,n]));
    const catalog=new Map(all.map(n=>[n.id,n]));
    return all.map(n=>{
      let ancestor:TreePoint|undefined=n;
      while(ancestor&&!visible.has(ancestor.id))ancestor=ancestor.parent?catalog.get(ancestor.parent):undefined;
      return {node:n,visible:visible.get(n.id),position:visible.get(n.id)?.position??visible.get(ancestor?.id??'root')!.position};
    });
  },[nodes,all]);
  const edges=useMemo(()=>all.filter(n=>n.parent),[all]);
  const flowing=useMemo(()=>nodes.filter(n=>n.parent&&props.focus&&(n.layer===props.focus||n.branch===props.focus)).slice(0,6),[nodes,props.focus]);
  const geometry=useMemo(()=>{
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(new Float32Array(edges.length*6),3));
    g.setAttribute('color',new Float32BufferAttribute(edges.flatMap(n=>{
      const color=new Color(n.color).multiplyScalar(!props.focus||n.layer===props.focus||n.branch===props.focus? .65:.1);
      return [...color.toArray(),...color.toArray()];
    }),3));return g;
  },[edges,props.focus]);
  useEffect(()=>()=>geometry.dispose(),[geometry]);
  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    const update=()=>{reduced.current=media.matches;invalidate();};update();media.addEventListener('change',update);
    return ()=>media.removeEventListener('change',update);
  },[invalidate]);
  useEffect(()=>{
    const c=controls.current;if(!c)return;
    let fitting=props.focus?nodes.filter(n=>n.id===props.focus||n.layer===props.focus||n.branch===props.focus):nodes;
    if(!fitting.length)fitting=nodes;
    const xs=fitting.map(n=>n.position[0]),ys=fitting.map(n=>n.position[1]);
    const center=new Vector3((Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2,0);
    const halfW=Math.max(210,(Math.max(...xs)-Math.min(...xs))/2+180),halfH=Math.max(160,(Math.max(...ys)-Math.min(...ys))/2+80);
    const distance=Math.max(halfH,halfW/(size.width/size.height))/Math.tan(Math.PI/8)*1.18;
    void c.setLookAt(center.x+distance*.1,center.y+distance*.18,distance,center.x,center.y,0,!reduced.current);
    invalidate();
  },[nodes,props.focus,props.request,size.width,size.height,invalidate]);
  const vector=useMemo(()=>new Vector3(),[]);
  useFrame((state,delta)=>{
    let moving=false;
    for(const target of targets){
      const group=groups.current.get(target.node.id);if(!group)continue;
      vector.set(...target.position);
      const scale=target.visible?1:0;
      const amount=reduced.current?1:1-Math.exp(-Math.min(delta,.05)*12);
      group.position.lerp(vector,amount);
      group.scale.lerp(vector.setScalar(scale),amount);
      group.visible=group.scale.x>.002;
      if(group.position.distanceToSquared(vector.set(...target.position))>.01||Math.abs(group.scale.x-scale)>.002)moving=true;
    }
    const positions=geometry.getAttribute('position');
    edges.forEach((edge,i)=>{
      const a=groups.current.get(edge.parent!)?.position,b=groups.current.get(edge.id)?.position;
      if(a&&b){positions.setXYZ(i*2,a.x,a.y,a.z);positions.setXYZ(i*2+1,b.x,b.y,b.z);}
    });positions.needsUpdate=true;geometry.computeBoundingSphere();
    flowing.forEach((n,i)=>{
      const particle=particles.current.get(n.id),a=groups.current.get(n.parent!)?.position,b=groups.current.get(n.id)?.position;
      if(particle&&a&&b){particle.visible=!reduced.current;particle.position.copy(a).lerp(b,(state.clock.elapsedTime*.16+i/6)%1);}
    });
    if(flowing.length&&!reduced.current&&!document.hidden)moving=true;
    if(moving)invalidate();
  });
  return <>
    <CameraControls ref={controls} makeDefault minDistance={180} maxDistance={18000} smoothTime={.3}/>
    <lineSegments geometry={geometry}><lineBasicMaterial vertexColors transparent opacity={.7}/></lineSegments>
    {flowing.map(n=><mesh key={n.id} ref={m=>{if(m)particles.current.set(n.id,m);else particles.current.delete(n.id);}}><sphereGeometry args={[2.1,8,8]}/><meshBasicMaterial color={n.color} transparent opacity={.7}/></mesh>)}
    {targets.map(({node,visible,position})=>{
      const dim=Boolean(props.focus&&node.id!=='root'&&node.id!==props.focus&&node.layer!==props.focus&&node.branch!==props.focus);
      const radius=node.company?4*marketCapScale(node.company.marketCap):node.kind==='layer'?12:7;
      return <group key={node.id} ref={g=>{if(g){if(!g.userData.treeInitialized){g.userData.treeInitialized=true;g.position.set(...position);g.scale.setScalar(visible?1:0);}groups.current.set(node.id,g);}else groups.current.delete(node.id);}}>
        <mesh><sphereGeometry args={[radius,16,12]}/><meshBasicMaterial color={node.color} transparent opacity={dim ? .12 : 1}/></mesh>
        <mesh><sphereGeometry args={[radius*2.6,16,12]}/><meshBasicMaterial color={node.color} transparent opacity={dim ? .01 : .08} depthWrite={false} blending={AdditiveBlending}/></mesh>
        {node.kind==='layer'&&<mesh position={[0,-15,0]}><cylinderGeometry args={[115,115,3,64]}/><meshBasicMaterial color={node.color} transparent opacity={dim ? .015 : .09} depthWrite={false}/></mesh>}
        {visible&&<Html position={[node.kind==='company'?16:22,0,0]} distanceFactor={node.kind==='company'||node.kind==='branch'?1100:undefined} zIndexRange={[15,0]} style={{pointerEvents:'none'}}><button
          className={`${styles.node} ${styles[node.kind]}`} style={{color:node.color,opacity:dim ? .2 : 1,pointerEvents:'auto'}}
          data-tree-node={node.id} data-tree-layer={node.layer} data-tree-kind={node.kind} data-tree-dimmed={dim}
          data-tree-company={node.company?.id} data-cap-scale={node.company?marketCapScale(node.company.marketCap):undefined}
          aria-expanded={node.kind==='company'?undefined:props.open.includes(node.id)} aria-pressed={node.company?props.selected===node.company.id:undefined}
          title={node.company?[node.label,marketCapDescription(node.company.marketCap,locale)].filter(Boolean).join(' · '):undefined}
          onClick={()=>node.company?props.onSelect(node.company.id):props.onToggle(node.id)}>
          <strong>{node.company?.country&&flags.has(node.company.country)&&<Image src={`/flags/${node.company.country.toLowerCase()}.svg`} alt="" width={14} height={10} unoptimized/>}{node.label}{node.company&&props.followedIds.includes(node.company.id)&&<span aria-label={text('Following','已关注')}> ★</span>}</strong>
          {node.company?<small>{[node.company.symbol,marketCapLabel(node.company.marketCap)].filter(Boolean).join(' · ')||text('Private / unlisted','非上市')}</small>:<span className={styles.count}>{node.count??''} {props.open.includes(node.id)?'−':'+'}</span>}
        </button></Html>}
      </group>;
    })}
  </>;
}
export default function IndustryTreeScene(props:TreeSceneProps){
  const [supported,setSupported]=useState(false);
  const {onUnavailable}=props;
  useEffect(()=>{
    let active=true;
    void Promise.resolve().then(()=>{
      if(!active)return;
      try{
        const context=document.createElement('canvas').getContext('webgl2');
        if(!context){onUnavailable();return;}
        context.getExtension('WEBGL_lose_context')?.loseContext();setSupported(true);
      }catch{onUnavailable();}
    });
    return ()=>{active=false;};
  },[onUnavailable]);
  if(!supported)return null;
  return <Boundary onUnavailable={props.onUnavailable}><Canvas frameloop="demand" dpr={[1,1.5]} camera={{position:[0,0,1600],fov:45,near:1,far:30000}} gl={{antialias:true}} fallback={null}><Scene {...props}/></Canvas></Boundary>;
}
