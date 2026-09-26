"use client";

import { Component, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Image from 'next/image';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CameraControls, CameraControlsImpl, Html } from '@react-three/drei';
import { AdditiveBlending, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Vector3, type Group, type Mesh } from 'three';
import { layoutIndustryTree, type TreeLayer, type TreePoint } from '@/lib/knowledge-graph/industry-tree';
import { marketCapDescription, marketCapLabel, marketCapScale } from '@/lib/knowledge-graph/market-cap';
import { useLocale } from './providers/locale-provider';
import { layoutVerticalTree, VERTICAL_ROOT_REACH, VERTICAL_ROOT_DEPTH } from '@/lib/knowledge-graph/vertical-tree';
import { VerticalTreeBranches } from './vertical-tree-branches';
import { verticalLeafPose, verticalTreeNodeStyle, VERTICAL_LEAF_BLADE, VERTICAL_LEAF_VEIN } from '@/lib/knowledge-graph/vertical-tree-geometry';
import styles from './industry-tree.module.css';
import { createTreeTour, treeTourStops } from '@/lib/knowledge-graph/tree-tour';

export type TreeSceneProps={tour:{current:boolean};paused?:boolean;vertical?:boolean;layers:TreeLayer[];open:string[];focus:string;selected:string;followedIds:string[];request:number;onToggle:(id:string)=>void;onSelect:(id:string)=>void;onUnavailable:()=>void};
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
  const {onUnavailable,tour:tourRef}=props;
  useEffect(()=>{const canvas=gl.domElement;const lost=()=>onUnavailable();canvas.addEventListener("webglcontextlost",lost);return ()=>canvas.removeEventListener("webglcontextlost",lost);},[gl,onUnavailable]);
  // Leaves set a pointer cursor on hover; never leave it behind when the scene goes away.
  useEffect(()=>()=>{gl.domElement.style.cursor='';},[gl]);
  // Redraw on resume so changes made while scrolled away (e.g. a selection in the other tree) appear.
  useEffect(()=>{if(!props.paused)invalidate();},[props.paused,invalidate]);
  const controls=useRef<CameraControls>(null);
  const flight=useRef<ReturnType<typeof createTreeTour>|null>(null);
  useEffect(()=>{if(props.selected||props.focus)tourRef.current=false;},[props.selected,props.focus,tourRef]);
  useEffect(()=>{
    const resume=()=>{if(!document.hidden&&!props.paused)invalidate();};
    document.addEventListener('visibilitychange',resume);
    return ()=>document.removeEventListener('visibilitychange',resume);
  },[props.paused,invalidate]);
  const groups=useRef(new Map<string,Group>());
  const labels=useRef(new Map<string,HTMLButtonElement>());
  // Labels mount after the frame that placed them; redraw once they settle so their scale is applied.
  const labelsSettled=useRef<number|undefined>(undefined);
  useEffect(()=>()=>window.clearTimeout(labelsSettled.current),[]);
  const particles=useRef(new Map<string,Mesh>());
  const reduced=useRef(false);
  const layout=props.vertical?layoutVerticalTree:layoutIndustryTree;
  const nodes=useMemo(()=>layout(props.layers,new Set(props.open),locale),[props.layers,props.open,locale,layout]);
  const all=useMemo(()=>layout(props.layers,new Set(['root',...props.layers.flatMap(l=>[l.id,...l.branches.map(b=>b.id)])]),locale),[props.layers,locale,layout]);
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
  const allById=useMemo(()=>new Map(all.map(n=>[n.id,n])),[all]);
  const trunkTop=useMemo(()=>Math.max(1,...nodes.filter(n=>n.kind==='layer').map(n=>n.position[1])),[nodes]);
  const flowing=useMemo(()=>nodes.filter(n=>!props.vertical&&n.parent&&props.focus&&(n.layer===props.focus||n.branch===props.focus)).slice(0,6),[nodes,props.focus,props.vertical]);
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
    if(props.vertical&&!props.focus){
      xs.push(-VERTICAL_ROOT_REACH,VERTICAL_ROOT_REACH);ys.push(-VERTICAL_ROOT_DEPTH);
    }
    // Labels extend to the right of their anchors. Reserve their projected width,
    // including on narrow screens, instead of centering only the node spheres.
    const reach=Math.max(240,340*1100/size.height);
    const center=new Vector3(0,(Math.min(...ys)+Math.max(...ys))/2,0);
    const halfH=Math.max(160,(Math.max(...ys)-Math.min(...ys))/2+80);
    let distance:number;
    if(props.vertical){
      // Fit the complete tree on phones as well. Zoom and pan reveal local detail.
      const fitWidth=size.width-96;
      distance=Math.max((Math.max(...ys)-Math.min(...ys)+100)/2*size.height/Math.max(100,size.height-84),(Math.max(...xs)-Math.min(...xs)+80)/2*size.height/Math.max(120,fitWidth))/Math.tan(Math.PI/8)*1.05;
      center.x=(Math.min(...xs)+Math.max(...xs))/2;
    }else{
      // The root's label sits left of its node at a fixed pixel size, so its world width depends
      // on the fitted distance: settle the two together.
      const rootLabel=fitting.some(n=>n.kind==='root')?(labels.current.get('root')?.offsetWidth||150)+40:0;
      const branchReach=nodes.some(n=>n.kind==='company')?reach:Math.max(160,220*1100/size.height);
      let pad=80;distance=0;
      for(let i=0;i<6;i++){
        const left=Math.min(...xs)-pad,right=Math.max(...xs)+branchReach;
        distance=Math.max(halfH,Math.max(210,(right-left)/2+40)/(size.width/size.height))/Math.tan(Math.PI/8)*1.18;
        center.x=(left+right)/2;
        pad=Math.max(80,rootLabel*2*distance*Math.tan(Math.PI/8)/size.height);
      }
    }
    const z=props.focus?fitting.reduce((sum,n)=>sum+n.position[2],0)/fitting.length:0;
    const position:[number,number,number]=[center.x+distance*(props.vertical?0:.1),center.y,z+distance];
    const target:[number,number,number]=[center.x,center.y,z];
    void c.setLookAt(...position,...target,!reduced.current&&!props.tour.current);
    flight.current=createTreeTour({position,target},treeTourStops(nodes),size.width/size.height);
    invalidate();
  },[nodes,props.focus,props.request,props.vertical,props.tour,size.width,size.height,invalidate]);
  const vector=useMemo(()=>new Vector3(),[]);
  useFrame((state,delta)=>{
    let moving=false;
    const touring=props.tour.current&&!props.selected&&!props.focus&&!props.paused&&!reduced.current&&!document.hidden;
    gl.domElement.setAttribute('data-tour',touring?'playing':props.tour.current?'paused':'stopped');
    if(touring&&flight.current&&controls.current){
      const shot=flight.current(delta);
      void controls.current.setLookAt(...shot.position,...shot.target,false);
      moving=true;
    }
    for(const target of targets){
      const group=groups.current.get(target.node.id);if(!group)continue;
      vector.set(...target.position);
      const scale=target.visible?1:0;
      const amount=reduced.current?1:1-Math.exp(-Math.min(delta,.05)*12);
      group.position.lerp(vector,amount);
      group.scale.lerp(vector.setScalar(scale),amount);
      group.visible=group.scale.x>.002;
      const label=labels.current.get(target.node.id);
      if(label&&(target.node.kind==='branch'||target.node.kind==='company')){
        // Html scales with distance; cap the final label size during close focus.
        const htmlScale=1100/(2*Math.tan(Math.PI/8)*group.position.distanceTo(state.camera.position));
        const compact=props.vertical&&(target.node.kind==='company'?htmlScale<.65:htmlScale<.72);
        if(compact){
          // A compact dot replaces the label: centre it on the node instead of beside it.
          const px=htmlScale*size.height/1100,offset=(target.node.kind==='company'?16:22)*px;
          const dot=target.node.kind==='company'?3+2.4*marketCapScale(target.node.company?.marketCap):12;
          label.style.transform=`translate(${target.position[0]<0?offset+dot/2:-offset-dot/2}px,${-dot/2}px)`;
        }else if(!props.vertical&&target.node.kind==='branch'){
          // Collapsed sibling branches sit 72 units apart: grow their labels up to that gap, never past natural size.
          const gap=72*htmlScale*size.height/1100;
          label.style.transform=`scale(${Math.min(1,Math.max(htmlScale,gap/34))/htmlScale})`;
        }else label.style.transform=`scale(${props.vertical?(target.node.kind==='company'?Math.min(1,Math.max(.7,htmlScale)):1):Math.min(1,1/htmlScale)})`;
        if(props.vertical)label.dataset.compact=String(compact);
      }
      if(group.position.distanceToSquared(vector.set(...target.position))>.01||Math.abs(group.scale.x-scale)>.002)moving=true;
    }
    if(props.vertical){
      // Around a real canopy, foreground and rear leaves can project onto one
      // another. Keep nearby names readable and use dots for competing labels.
      const target=controls.current?.getTarget(new Vector3())??new Vector3();
      const ordered=[...nodes].sort((a,b)=>Number(b.company?.id===props.selected)-Number(a.company?.id===props.selected)
        ||Number(b.kind==='layer'||b.kind==='root')-Number(a.kind==='layer'||a.kind==='root')
        ||new Vector3(...a.position).distanceToSquared(target)-new Vector3(...b.position).distanceToSquared(target));
      const occupied:DOMRect[]=[];
      for(const node of ordered){
        const el=labels.current.get(node.id);if(!el||el.dataset.compact==='true')continue;
        const box=el.getBoundingClientRect();
        if(node.kind==='company'||node.kind==='branch'){
          if(occupied.some(r=>box.left<r.right+5&&box.right>r.left-5&&box.top<r.bottom+5&&box.bottom>r.top-5)){
            el.dataset.compact='true';continue;
          }
        }
        occupied.push(box);
      }
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
    <CameraControls ref={controls} makeDefault
      mouseButtons={{left:CameraControlsImpl.ACTION.TRUCK,middle:CameraControlsImpl.ACTION.DOLLY,right:props.vertical?CameraControlsImpl.ACTION.ROTATE:CameraControlsImpl.ACTION.TRUCK,wheel:CameraControlsImpl.ACTION.DOLLY}}
      touches={{one:CameraControlsImpl.ACTION.TOUCH_TRUCK,two:CameraControlsImpl.ACTION.TOUCH_DOLLY_TRUCK,three:CameraControlsImpl.ACTION.TOUCH_TRUCK}} minDistance={180} maxDistance={60000} smoothTime={.3}/>
    {props.vertical?<VerticalTreeBranches nodes={nodes} groups={groups} focus={props.focus}/>:<lineSegments geometry={geometry}><lineBasicMaterial vertexColors transparent opacity={.7}/></lineSegments>}
    {flowing.map(n=><mesh key={n.id} ref={m=>{if(m)particles.current.set(n.id,m);else particles.current.delete(n.id);}}><sphereGeometry args={[2.1,8,8]}/><meshBasicMaterial color={n.color} transparent opacity={.7}/></mesh>)}
    {targets.map(({node,visible,position})=>{
      const dim=Boolean(props.selected ? node.company?.id!==props.selected && node.kind!=='root' : props.focus&&node.id!=='root'&&node.id!==props.focus&&node.layer!==props.focus&&node.branch!==props.focus);
      // In the horizontal tree the root label points away from the layers, so it never covers the middle layer's label.
      const left=Boolean(props.vertical?position[0]<0:node.kind==='root');
      // Layer pills sit on their limb like knots, so fans of sub-branches never run under a label.
      // Horizontal layer labels are centred on their node too, between the root's fan and their branches.
      const centered=props.vertical?node.kind==='root'||node.kind==='layer':node.kind==='layer';
      const capScale=marketCapScale(node.company?.marketCap);
      const look=props.vertical?verticalTreeNodeStyle(node,dim,capScale):{radius:node.company?4*capScale:node.kind==='layer'?12:7,core:dim?.12:1,glow:dim?.01:.08,glowRadius:0};
      const radius=look.radius;
      // Companies grow as leaves in the vertical tree; the stem sits on the node. Roots carry no
      // leaves: energy companies are round nodules on the root strands.
      const leaf=props.vertical&&node.company&&node.layer!=='energy'?verticalLeafPose(node,node.parent?allById.get(node.parent):undefined,capScale,trunkTop):undefined;
      // The whole leaf or nodule selects its company; the small label button stays as the keyboard and screen-reader target.
      const pick=props.vertical&&node.company&&visible?{
        onClick:(event:ThreeEvent<MouseEvent>)=>{event.stopPropagation();props.onSelect(node.company!.id);},
        onPointerOver:(event:ThreeEvent<PointerEvent>)=>{event.stopPropagation();gl.domElement.style.cursor='pointer';},
        onPointerOut:()=>{gl.domElement.style.cursor='';},
      }:{};
      return <group key={node.id} ref={g=>{if(g){if(!g.userData.treeInitialized){g.userData.treeInitialized=true;g.position.set(...position);g.scale.setScalar(visible?1:0);}groups.current.set(node.id,g);}else groups.current.delete(node.id);}}>
        {leaf?<group rotation={[0,node.azimuth??0,0]}><group rotation={[0,0,leaf.angle]}>
          <mesh geometry={VERTICAL_LEAF_BLADE} scale={[leaf.length*1.3,leaf.width*1.5,1]} position={[-leaf.length*.12,0,-.5]}><meshBasicMaterial color={leaf.tint} transparent opacity={dim?.01:.07} depthWrite={false} blending={AdditiveBlending}/></mesh>
          <mesh geometry={VERTICAL_LEAF_BLADE} scale={[leaf.length,leaf.width,1]} {...pick}><meshBasicMaterial vertexColors color={leaf.tint} side={DoubleSide} transparent opacity={dim?.12:.96}/></mesh>
          <mesh geometry={VERTICAL_LEAF_VEIN} scale={[leaf.length,leaf.length,1]} position={[0,0,.2]}><meshBasicMaterial color="#f4fbff" transparent opacity={dim?.05:.45}/></mesh>
        </group></group>:<>
        <mesh {...pick}><sphereGeometry args={[radius,16,12]}/><meshBasicMaterial color={node.color} transparent opacity={look.core}/></mesh>
        <mesh {...pick}><sphereGeometry args={[look.glowRadius||radius*2.6,16,12]}/><meshBasicMaterial color={node.color} transparent opacity={look.glow} depthWrite={false} blending={AdditiveBlending}/></mesh>
        </>}
        {!props.vertical&&node.kind==='layer'&&<mesh position={[0,-15,0]}><cylinderGeometry args={[115,115,3,64]}/><meshBasicMaterial color={node.color} transparent opacity={dim ? .015 : .09} depthWrite={false}/></mesh>}
        {visible&&<Html center={centered} position={centered?[0,node.kind==='root'?-25:0,0]:[(left?-1:1)*(node.kind==='company'?16:22),0,0]} distanceFactor={!props.vertical&&(node.kind==='company'||node.kind==='branch')?1100:undefined} zIndexRange={props.vertical?node.kind==='company'?[35,30]:node.kind==='branch'?[25,20]:node.kind==='layer'?[15,10]:[5,0]:[15,0]} style={{pointerEvents:'none'}}><div className={left&&!centered?styles.labelLeft:undefined}><button
          ref={el=>{if(el){labels.current.set(node.id,el);window.clearTimeout(labelsSettled.current);labelsSettled.current=window.setTimeout(invalidate,120);}else labels.current.delete(node.id);}}
          className={`${styles.node} ${styles[node.kind]}`} style={{color:node.color,opacity:dim ? .2 : 1,pointerEvents:'auto',...(node.company?{'--cap':capScale}:{})} as CSSProperties}
          data-tree-node={node.id} data-tree-layer={node.layer} data-tree-kind={node.kind} data-tree-dimmed={dim}
          data-compact={props.vertical&&(node.kind==='company'||node.kind==='branch')?true:undefined}
          aria-label={props.vertical&&(node.company||node.kind==='branch')?[node.label,node.company?.symbol].filter(Boolean).join(' '):undefined}
          data-tree-company={node.company?.id} data-cap-scale={node.company?marketCapScale(node.company.marketCap):undefined}
          aria-expanded={node.kind==='company'?undefined:props.open.includes(node.id)} aria-pressed={node.company?props.selected===node.company.id:undefined}
          title={node.company?[node.label,marketCapDescription(node.company.marketCap,locale)].filter(Boolean).join(' · '):props.vertical&&node.kind==='branch'?node.label:undefined}
          onClick={()=>node.company?props.onSelect(node.company.id):props.onToggle(node.id)}>
          <strong>{node.company?.country&&flags.has(node.company.country)&&<Image src={`/flags/${node.company.country.toLowerCase()}.svg`} alt="" width={14} height={10} unoptimized/>}{node.label}{node.company&&props.followedIds.includes(node.company.id)&&<span aria-label={text('Following','已关注')}> ★</span>}</strong>
          {node.company?<small>{[node.company.symbol,marketCapLabel(node.company.marketCap)].filter(Boolean).join(' · ')||text('Private / unlisted','非上市')}</small>:<span className={styles.count}>{node.count??''} {props.open.includes(node.id)?'−':'+'}</span>}
        </button></div></Html>}
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
  return <Boundary onUnavailable={props.onUnavailable}><Canvas onPointerMissed={event=>{if(event.type==='click'&&event.target instanceof HTMLCanvasElement&&props.selected)props.onSelect('');}} frameloop={props.paused?'never':'demand'} dpr={[1,1.5]} camera={{position:[0,0,1600],fov:45,near:1,far:100000}} gl={{antialias:true}} fallback={null}><Scene {...props}/></Canvas></Boundary>;
}
