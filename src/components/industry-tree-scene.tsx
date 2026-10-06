"use client";

import {CompanyPriceChange} from './company-price-change';
import { Component, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Image from 'next/image';
import {useNavigationSettings} from "./navigation-settings";
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { CameraControls, CameraControlsImpl, Html } from '@react-three/drei';
import { AdditiveBlending, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Vector3, type Group, type Mesh } from 'three';
import { layoutIndustryTree, type TreeLayer, type TreePoint } from '@/lib/knowledge-graph/industry-tree';
import { marketCapDescription, marketCapLabel, marketCapScale } from '@/lib/knowledge-graph/market-cap';
import { useLocale } from './providers/locale-provider';
import { layoutVerticalTree } from '@/lib/knowledge-graph/vertical-tree';
import { VerticalTreeBranches } from './vertical-tree-branches';
import { TreeStarField } from './tree-star-field';
import { TreeGalaxies } from './tree-galaxies';
import { verticalLeafPose, verticalTreeNodeStyle, VERTICAL_LEAF_BLADE, VERTICAL_LEAF_VEIN } from '@/lib/knowledge-graph/vertical-tree-geometry';
import styles from './industry-tree.module.css';
import {WebGLContextRecovery} from './webgl-context-recovery';
import {useNodePresence} from './use-node-presence';
import { tourDelta } from '@/lib/knowledge-graph/tour-motion';
import { createTreeTour, createTreePresentation, createTreeOverviewTour, treeOverviewShot, treeOverviewPlan, treeTourFromView } from '@/lib/knowledge-graph/tree-tour';
import { advanceLabelFade, createLabelFade, type LabelFade } from '@/lib/knowledge-graph/label-fade';

export type TreeSceneProps={tour:{current:boolean};paused?:boolean;vertical?:boolean;layers:TreeLayer[];open:string[];focus:string;selected:string;followedIds:string[];request:number;onRevealLayer:(id:string)=>void;onToggle:(id:string)=>void;onSelect:(id:string)=>void;onUnavailable:()=>void;onRetry:()=>void};
const flags=new Set(['CA','CN','FR','GB','IE','NL','SG','TW','US']);
class Boundary extends Component<{children:ReactNode;onUnavailable:()=>void},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onUnavailable();}
  render(){return this.state.failed?null:this.props.children;}
}
function Scene(props:TreeSceneProps){
  const navigation=useNavigationSettings();
  const {locale,text}=useLocale();
  const {size,invalidate,gl}=useThree();
  const {tour:tourRef}=props;
  // Leaves set a pointer cursor on hover; never leave it behind when the scene goes away.
  useEffect(()=>()=>{gl.domElement.style.cursor='';},[gl]);
  // Redraw on resume so changes made while scrolled away (e.g. a selection in the other tree) appear.
  useEffect(()=>{if(!props.paused)invalidate();},[props.paused,invalidate]);
  const [growth,setGrowth]=useState({request:props.request,active:Boolean(props.vertical)});
  if(growth.request!==props.request)setGrowth({request:props.request,active:Boolean(props.vertical)});
  const growing=growth.request!==props.request?Boolean(props.vertical):growth.active;
  const woodGrowth=useRef({roots:0,trunk:0,top:1});
  const presentation=useRef<ReturnType<typeof createTreePresentation>|null>(null);
  const controls=useRef<CameraControls>(null);
  const userPositioned=useRef(false);
  const flight=useRef<ReturnType<typeof createTreeTour>|null>(null);
  const resumePending=useRef(false);
  const resumeReady=useRef(false);
  const skipLayer=useRef<string|undefined>(undefined);
  const idleTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const scheduleResume=useRef<()=>void>(()=>{});
  useEffect(()=>{
    if(!props.vertical)return;
    const surface=gl.domElement.closest('[data-industry-section]');
    if(!surface)return;
    const pointers=new Set<number>(),keys=new Set<string>(),starts=new Map<number,{x:number;y:number}>();
    const clear=()=>{if(idleTimer.current!==null)clearTimeout(idleTimer.current);idleTimer.current=null;resumeReady.current=false;};
    const pause=()=>{tourRef.current=false;resumePending.current=true;skipLayer.current=undefined;clear();invalidate();};
    const schedule=()=>{
      clear();
      if(pointers.size||keys.size||document.hidden)return;
      idleTimer.current=setTimeout(()=>{idleTimer.current=null;resumeReady.current=true;invalidate();},2000);
      invalidate();
    };
    scheduleResume.current=schedule;
    const down=(event:Event)=>{const e=event as PointerEvent;pointers.add(e.pointerId);if(e.target===gl.domElement)starts.set(e.pointerId,{x:e.clientX,y:e.clientY});pause();};
    const move=(event:PointerEvent)=>{const start=starts.get(event.pointerId);if(start&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>4)userPositioned.current=true;};
    const up=(event:PointerEvent)=>{starts.delete(event.pointerId);if(pointers.delete(event.pointerId))schedule();};
    const wheel=(event:Event)=>{if(!(event.target instanceof Element&&event.target.closest('[data-node-card]')))userPositioned.current=true;pause();schedule();};
    const keydown=(event:Event)=>{keys.add((event as KeyboardEvent).code);pause();};
    const keyup=(event:KeyboardEvent)=>{if(keys.delete(event.code))schedule();};
    const focus=()=>{pause();schedule();};
    const blur=()=>{if(pointers.size||keys.size){pointers.clear();starts.clear();keys.clear();pause();schedule();}};
    const visibility=()=>{if(document.hidden){clear();blur();}else if(resumePending.current)schedule();};
    surface.addEventListener('pointerdown',down,true);
    surface.addEventListener('wheel',wheel,{capture:true,passive:true});
    surface.addEventListener('keydown',keydown,true);
    surface.addEventListener('focusin',focus,true);
    window.addEventListener('pointermove',move,true);
    window.addEventListener('pointerup',up,true);
    window.addEventListener('pointercancel',up,true);
    window.addEventListener('keyup',keyup,true);
    window.addEventListener('blur',blur);
    document.addEventListener('visibilitychange',visibility);
    return ()=>{
      clear();scheduleResume.current=()=>{};
      surface.removeEventListener('pointerdown',down,true);
      surface.removeEventListener('wheel',wheel,true);
      surface.removeEventListener('keydown',keydown,true);
      surface.removeEventListener('focusin',focus,true);
      window.removeEventListener('pointermove',move,true);
      window.removeEventListener('pointerup',up,true);
      window.removeEventListener('pointercancel',up,true);
      window.removeEventListener('keyup',keyup,true);
      window.removeEventListener('blur',blur);
      document.removeEventListener('visibilitychange',visibility);
    };
  },[gl,invalidate,props.vertical,tourRef]);
  useEffect(()=>{
    if(props.paused){
      if(idleTimer.current!==null)clearTimeout(idleTimer.current);
      idleTimer.current=null;resumeReady.current=false;
    }else if(resumePending.current)scheduleResume.current();
  },[props.paused]);
  const lastSelection=useRef(props.selected);
  const savedSelectionView=useRef<{position:Vector3;target:Vector3}|null>(null);
  useEffect(()=>{
    if(props.selected){
      if(!lastSelection.current&&controls.current)savedSelectionView.current={position:controls.current.getPosition(new Vector3(),false),target:controls.current.getTarget(new Vector3(),false)};
      tourRef.current=false;
    }
    else if(lastSelection.current&&props.vertical){
      const saved=savedSelectionView.current;savedSelectionView.current=null;
      if(saved&&controls.current){controls.current.smoothTime=.8/navigation.speed;void controls.current.setLookAt(...saved.position.toArray(),...saved.target.toArray(),!reduced.current);}
      resumePending.current=true;scheduleResume.current();
    }
    lastSelection.current=props.selected;
  },[props.selected,props.vertical,tourRef,navigation.speed]);
  useEffect(()=>{
    const resume=()=>{if(!document.hidden&&!props.paused)invalidate();};
    document.addEventListener('visibilitychange',resume);
    return ()=>document.removeEventListener('visibilitychange',resume);
  },[props.paused,invalidate]);
  const groups=useRef(new Map<string,Group>());
  const labels=useRef(new Map<string,HTMLButtonElement>());
  const collisionLabels=useRef(new Set<string>());
  const lastCollision=useRef(-Infinity);
  const labelFades=useRef(new WeakMap<HTMLButtonElement,LabelFade>());
  const labelSizes=useRef(new WeakMap<HTMLButtonElement,{width:number;height:number}>());
  // Labels mount after the frame that placed them; redraw once they settle so their scale is applied.
  const labelsSettled=useRef<number|undefined>(undefined);
  useEffect(()=>()=>window.clearTimeout(labelsSettled.current),[]);
  const particles=useRef(new Map<string,Mesh>());
  const reduced=useRef(false);
  const layout=props.vertical?layoutVerticalTree:layoutIndustryTree;
  const nodes=useMemo(()=>layout(props.layers,new Set(props.open),locale),[props.layers,props.open,locale,layout]);
  // Mount the trunk and layer anchors before company leaves, even as lower layers grow.
  const presenceNodes=useMemo(()=>props.vertical?[...nodes.filter(n=>n.kind==='root'||n.kind==='layer'),...nodes.filter(n=>n.kind!=='root'&&n.kind!=='layer')]:nodes,[nodes,props.vertical]);
  const presence=useNodePresence(presenceNodes,navigation.speed,props.vertical?.04:.24);
  const renderedNodes=useMemo(()=>presence.map(entry=>entry.node),[presence]);
  const present=useMemo(()=>new Map(presence.map(entry=>[entry.node.id,entry])),[presence]);
  useEffect(()=>{invalidate();},[presence,invalidate]);
  useEffect(()=>{collisionLabels.current.clear();lastCollision.current=-Infinity;invalidate();},[nodes,props.selected,props.focus,invalidate]);
  const all=useMemo(()=>layout(props.layers,new Set(['root',...props.layers.flatMap(l=>[l.id,...l.branches.map(b=>b.id)])]),locale),[props.layers,locale,layout]);
  const fullPlan=useMemo(()=>treeOverviewPlan(all),[all]);
  const visiblePlan=useMemo(()=>treeOverviewPlan(nodes,new Set(props.open)),[nodes,props.open]);
  const plan=growing?fullPlan:visiblePlan;
  const targets=useMemo(()=>{
    const visible=new Map(presence.filter(entry=>!entry.exiting).map(entry=>[entry.node.id,entry.node]));
    const catalog=new Map(all.map(n=>[n.id,n]));
    return all.map(n=>{
      let ancestor:TreePoint|undefined=n;
      while(ancestor&&!visible.has(ancestor.id))ancestor=ancestor.parent?catalog.get(ancestor.parent):undefined;
      return {node:n,visible:visible.get(n.id),position:visible.get(n.id)?.position??visible.get(ancestor?.id??'root')?.position??all[0].position};
    });
  },[presence,all]);
  const edges=useMemo(()=>all.filter(n=>n.parent),[all]);
  const allById=useMemo(()=>new Map(all.map(n=>[n.id,n])),[all]);
  const trunkTop=useMemo(()=>Math.max(1,...all.filter(n=>n.kind==='layer').map(n=>n.position[1])),[all]);
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
  const lastFit=useRef<{request:number;vertical?:boolean;width:number;height:number}|null>(null);
  useEffect(()=>{
    const c=controls.current;if(!c)return;
    const previous=lastFit.current;
    lastFit.current={request:props.request,vertical:props.vertical,width:size.width,height:size.height};
    // Expanding/collapsing a vertical layer changes the itinerary, never the user's camera.
    if(props.vertical&&previous?.vertical&&previous.request===props.request&&(userPositioned.current||(previous.width===size.width&&previous.height===size.height)))return;
    if(props.vertical){
      const restarting=!previous||previous.request!==props.request;
      if(restarting){
        userPositioned.current=false;resumePending.current=false;resumeReady.current=false;tourRef.current=true;
        if(idleTimer.current!==null){clearTimeout(idleTimer.current);idleTimer.current=null;}
      }
      const shot=treeOverviewShot(all,size.width,size.height);
      if(restarting||!presentation.current)presentation.current=createTreePresentation(shot,fullPlan,all,size.width/size.height);
      else presentation.current.reframe(shot,size.width/size.height);
      const current=presentation.current.sample().shot;
      void c.setLookAt(...current.position,...current.target,Boolean(previous)&&!reduced.current);
      flight.current=createTreeOverviewTour(shot,plan);
      invalidate();return;
    }
    let fitting=props.focus?nodes.filter(n=>n.id===props.focus||n.layer===props.focus||n.branch===props.focus):nodes;
    if(!fitting.length)fitting=nodes;
    const xs=fitting.map(n=>n.position[0]),ys=fitting.map(n=>n.position[1]);
    // Labels extend to the right of their anchors. Reserve their projected width,
    // including on narrow screens, instead of centering only the node spheres.
    const reach=Math.max(240,340*1100/size.height);
    const center=new Vector3(0,(Math.min(...ys)+Math.max(...ys))/2,0);
    const halfH=Math.max(160,(Math.max(...ys)-Math.min(...ys))/2+80);
    let distance:number;
    {
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
    const position:[number,number,number]=[center.x+distance*.1,center.y,z+distance];
    const target:[number,number,number]=[center.x,center.y,z];
    void c.setLookAt(...position,...target,!reduced.current&&!props.tour.current);
    flight.current=createTreeTour({position,target},plan);
    invalidate();
  },[all,nodes,plan,props.focus,props.request,props.vertical,props.tour,size.width,size.height,invalidate,growing,fullPlan,tourRef]);
  const previousPlan=useRef(plan);
  useEffect(()=>{
    const previous=previousPlan.current;previousPlan.current=plan;
    if(!props.vertical||previous===plan||growing)return;
    if(controls.current)presentation.current?.updateStops(plan,{
      position:controls.current.getPosition(new Vector3(),false).toArray(),
      target:controls.current.getTarget(new Vector3(),false).toArray(),
    });
    const destination=flight.current?.destination()?.layer;
    skipLayer.current=destination&&!plan.some(stop=>stop.layer===destination)?destination:undefined;
    tourRef.current=false;resumePending.current=plan.length>0;resumeReady.current=false;
    if(idleTimer.current!==null){clearTimeout(idleTimer.current);idleTimer.current=null;}
    if(plan.length)scheduleResume.current();else flight.current=null;
    invalidate();
  },[plan,props.vertical,invalidate,tourRef,growing]);
  useEffect(()=>{invalidate();},[navigation.speed,invalidate]);
  const vector=useMemo(()=>new Vector3(),[]);
  useFrame((state,delta)=>{
    // Html labels have independent React roots. Keep their accessible selection
    // in sync even when an older label commit lands after the scene update.
    for(const label of labels.current.values()){
      const company=label.getAttribute('data-tree-company');
      if(company){const pressed=String(company===props.selected);if(label.getAttribute('aria-pressed')!==pressed)label.setAttribute('aria-pressed',pressed);}
      else{const expanded=String(props.open.includes(label.getAttribute('data-tree-node')??''));if(label.getAttribute('aria-expanded')!==expanded)label.setAttribute('aria-expanded',expanded);}
    }
    let moving=false;
    const now=performance.now();
    const checkCollisions=props.vertical&&now-lastCollision.current>=200;
    const touring=props.tour.current&&plan.length>0&&(!props.vertical||props.open.includes('root'))&&!props.selected&&!props.focus&&!props.paused&&!reduced.current&&!document.hidden;
    let resumed=false;
    if(props.vertical&&props.open.includes('root')&&plan.length&&resumePending.current&&resumeReady.current&&!props.selected&&!props.focus&&!props.paused&&!reduced.current&&!document.hidden&&controls.current){
      const start={position:controls.current.getPosition(new Vector3(),false).toArray(),target:controls.current.getTarget(new Vector3(),false).toArray()};
      const previousLayer=flight.current?.destination()?.layer;
      const continuation=skipLayer.current?-1:plan.findIndex(stop=>stop.layer===previousLayer);
      const itinerary=continuation<0?treeTourFromView(plan,start,nodes,skipLayer.current):[...plan.slice(continuation),...plan.slice(0,continuation)];
      flight.current=createTreeOverviewTour(start,itinerary);
      if(userPositioned.current)presentation.current?.resume(start);
      userPositioned.current=false;
      skipLayer.current=undefined;
      resumePending.current=false;resumeReady.current=false;tourRef.current=true;resumed=true;
      moving=true;
    }
    gl.domElement.setAttribute('data-tour',touring||resumed?'playing':props.tour.current?'paused':'stopped');
    let presentationFrame=props.vertical?presentation.current?.sample():undefined;
    if(touring&&controls.current){
      if(presentationFrame&&presentation.current){
        presentationFrame=presentation.current(delta,navigation.speed);
        if(growing)for(const layer of presentationFrame.revealLayers)if(!props.open.includes(layer))props.onRevealLayer(layer);
        void controls.current.setLookAt(...presentationFrame.shot.position,...presentationFrame.shot.target,presentationFrame.phase==='overview');
      }else if(flight.current){
        const shot=flight.current(delta,navigation.speed);
        if(!props.vertical)void controls.current.setLookAt(...shot.position,...shot.target,false);
      }
      moving=true;
    }
    const growthFrame=props.vertical&&growing&&!reduced.current?presentationFrame:undefined;
    woodGrowth.current={roots:growthFrame?.rootGrowth??1,trunk:growthFrame?.trunkGrowth??1,top:trunkTop};
    gl.domElement.setAttribute('data-trunk-growth',String(woodGrowth.current.trunk));
    gl.domElement.setAttribute('data-root-growth',String(woodGrowth.current.roots));
    const visitingLayer=presentationFrame&&['ascent','descent'].includes(presentationFrame.phase)?presentationFrame.layer:'';
    gl.domElement.setAttribute('data-tour-phase',presentationFrame?.phase??'manual');
    gl.domElement.setAttribute('data-user-positioned',String(userPositioned.current));
    gl.domElement.setAttribute('data-tour-layer',presentationFrame?.layer??flight.current?.destination()?.layer??'');
    gl.domElement.setAttribute('data-tour-open-layers',[...new Set(plan.map(stop=>stop.layer))].join(','));
    if(controls.current){
      gl.domElement.setAttribute('data-camera-position',controls.current.getPosition(vector,false).toArray().join(','));
      gl.domElement.setAttribute('data-camera-target',controls.current.getTarget(vector,false).toArray().join(','));
    }
    for(const target of targets){
      const group=groups.current.get(target.node.id);if(!group)continue;
      vector.set(...target.position);
      const grown=target.node.kind!=='layer'||!growthFrame||target.node.position[1]<=trunkTop*growthFrame.trunkGrowth&&growthFrame.rootGrowth>0;
      const scale=target.visible&&grown?1:0;
      const amount=reduced.current?1:1-Math.exp(-tourDelta(delta,navigation.speed)*1.8);
      group.position.lerp(vector,amount);
      group.scale.lerp(vector.setScalar(scale),amount);
      group.visible=group.scale.x>.002;
      const alpha=Number(group.userData.presenceAlpha??0),step=tourDelta(delta,navigation.speed)/.8;
      group.userData.presenceAlpha=reduced.current?scale:Math.max(0,Math.min(1,alpha+(scale?step:-step)));
      group.traverse(child=>{
        if(!('material' in child))return;
        const materials=Array.isArray((child as Mesh).material)?(child as Mesh).material:[(child as Mesh).material];
        for(const material of materials as import('three').Material[]){
          const state=material.userData.treeFade as {base:number;last:number}|undefined;
          const base=!state||material.opacity!==state.last?material.opacity:state.base;
          material.opacity=base*group.userData.presenceAlpha;
          material.userData.treeFade={base,last:material.opacity};
        }
      });
      // Keep distant root nodules easy to select on phones even when their
      // visible spheres shrink to a few pixels in the whole-tree view.
      if(props.vertical&&target.node.company&&target.node.layer==='energy'){
        const hit=group.children.find(child=>child.userData.rootHitTarget);
        if(hit)hit.scale.setScalar(Math.max(Number(hit.userData.minimumRadius),state.camera.position.distanceTo(group.position)*2*Math.tan(Math.PI/8)/size.height*10));
      }
      const label=labels.current.get(target.node.id);
      if(label&&props.vertical&&target.node.kind==='layer'){
        label.style.opacity=String(group.userData.presenceAlpha);
        label.style.visibility=group.userData.presenceAlpha>.01?'visible':'hidden';
      }
      if(label&&(target.node.kind==='branch'||target.node.kind==='company')){
        // Html scales with distance; cap the final label size during close focus.
        const htmlScale=1100/(2*Math.tan(Math.PI/8)*group.position.distanceTo(state.camera.position));
        let compact=false;
        if(props.vertical){
          // Cache the full label's dimensions before it becomes a compact hit target.
          // Collision checks keep using these dimensions while the text is transparent.
          if(label.dataset.compact!=='true'&&!labelSizes.current.has(label))labelSizes.current.set(label,{width:label.offsetWidth,height:label.offsetHeight});
          let fade=labelFades.current.get(label);
          if(!fade){fade=createLabelFade(now);labelFades.current.set(label,fade);}
          const threshold=target.node.kind==='company'?.65:.72;
          // Pin the selected label's shape: a card following its bounds must not
          // move back and forth as the card covers/uncover its hover target.
          const intentional=Boolean(props.selected&&target.node.company?.id===props.selected)||label.matches(':focus')||(!props.selected&&label.matches(':hover'));
          const wanted=intentional||((target.node.layer===visitingLayer||htmlScale>=threshold+(fade.visible?0:.04))&&!collisionLabels.current.has(target.node.id));
          const previous=fade.level;
          const result=advanceLabelFade(fade,wanted,now,reduced.current);
          compact=fade.level===0&&!fade.visible;
          label.style.opacity=String(result.opacity*(label.dataset.treeDimmed==='true'?.2:1));
          label.style.pointerEvents=fade.visible||compact?'auto':'none';
          label.dataset.labelVisible=String(fade.visible);
          label.dataset.labelOpacity=String(result.opacity);
          if(result.moving)moving=true;
          if(previous>0&&compact){lastCollision.current=-Infinity;moving=true;}
        }
        if(compact){
          // A compact dot replaces the label: centre it on the node instead of beside it.
          const px=htmlScale*size.height/1100,offset=(target.node.kind==='company'?16:22)*px;
          const dot=target.node.kind==='company'?3+2.4*marketCapScale(target.node.company?.marketCap):12;
          label.style.transform=`translate(${target.position[0]<0?offset+dot/2:-offset-dot/2}px,${-dot/2}px)`;
        }else if(!props.vertical&&target.node.kind==='branch'){
          // Collapsed sibling branches sit 72 units apart: grow their labels up to that gap, never past natural size.
          const gap=72*htmlScale*size.height/1100;
          label.style.transform=`scale(${Math.min(1,Math.max(htmlScale,gap/34))/htmlScale})`;
        }else label.style.transform=`scale(${props.vertical?(target.node.kind==='company'?(target.node.layer===visitingLayer?1.15:Math.min(1,Math.max(.7,htmlScale))):1):Math.min(1,1/htmlScale)})`;
        if(props.vertical)label.dataset.compact=String(compact);
      }
      if(group.position.distanceToSquared(vector.set(...target.position))>.01||Math.abs(group.scale.x-scale)>.002)moving=true;
    }
    if(checkCollisions){
      // Around a real canopy, foreground and rear leaves can project onto one
      // another. Keep nearby names readable and use dots for competing labels.
      const target=controls.current?.getTarget(new Vector3())??new Vector3();
      const distances=new Map(nodes.map(n=>[n.id,new Vector3(...n.position).distanceToSquared(visitingLayer?state.camera.position:target)]));
      const ordered=[...nodes].sort((a,b)=>Number(b.company?.id===props.selected)-Number(a.company?.id===props.selected)
        ||Number(b.kind==='layer'||b.kind==='root')-Number(a.kind==='layer'||a.kind==='root')
        ||Number(b.layer===visitingLayer)-Number(a.layer===visitingLayer)
        ||distances.get(a.id)!-distances.get(b.id)!);
      // Read all bounds together before changing any collision state. Cache the
      // result between passes so the cinematic frame loop avoids forced layouts.
      const canvasBounds=gl.domElement.getBoundingClientRect();
      const bounds=new Map(ordered.flatMap(node=>{
        const el=labels.current.get(node.id);
        if(!el)return [];
        if(node.kind!=='company'&&node.kind!=='branch')return [[node.id,el.getBoundingClientRect()] as const];
        const group=groups.current.get(node.id),dimensions=labelSizes.current.get(el);
        if(!group||!dimensions)return [];
        const htmlScale=1100/(2*Math.tan(Math.PI/8)*group.position.distanceTo(state.camera.position));
        const fade=labelFades.current.get(el),threshold=(node.kind==='company'?.65:.72)+(fade?.visible?0:.04);
        if(node.layer!==visitingLayer&&htmlScale<threshold&&!fade?.level)return [];
        const left=node.position[0]<0,scale=node.kind==='company'?(node.layer===visitingLayer?1.15:Math.min(1,Math.max(.7,htmlScale))):1;
        vector.copy(group.position);vector.x+=(left?-1:1)*(node.kind==='company'?16:22)*group.scale.x;
        vector.project(state.camera);
        const width=dimensions.width*scale,height=dimensions.height*scale;
        const x=canvasBounds.left+(vector.x+1)*size.width/2,y=canvasBounds.top+(1-vector.y)*size.height/2;
        return [[node.id,new DOMRect(x-(left?width:0),y,width,height)] as const];
      }));
      const occupied:{id:string;box:DOMRect;retiring?:boolean}[]=ordered.flatMap(node=>{
        const el=labels.current.get(node.id),box=bounds.get(node.id),fade=el&&labelFades.current.get(el);
        return box&&fade&&!fade.visible&&fade.level>0?[{id:node.id,box,retiring:true}]:[];
      });
      const previousCollisions=new Set(collisionLabels.current);
      collisionLabels.current.clear();
      for(const node of ordered){
        const box=bounds.get(node.id);if(!box)continue;
        if(node.kind==='company'||node.kind==='branch'){
          const el=labels.current.get(node.id),fade=el&&labelFades.current.get(el);
          if(occupied.some(({id,box:r,retiring})=>id!==node.id&&!(retiring&&fade?.visible)&&box.left<r.right+5&&box.right>r.left-5&&box.top<r.bottom+5&&box.bottom>r.top-5)){
            collisionLabels.current.add(node.id);continue;
          }
        }
        if(!occupied.some(entry=>entry.id===node.id))occupied.push({id:node.id,box});
      }
      if(previousCollisions.size!==collisionLabels.current.size||[...previousCollisions].some(id=>!collisionLabels.current.has(id)))moving=true;
      lastCollision.current=now;
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
    <CameraControls ref={controls} makeDefault onWake={()=>{gl.domElement.setAttribute('data-camera','moving');}} onSleep={()=>{gl.domElement.setAttribute('data-camera','idle');invalidate();}}
      mouseButtons={{left:CameraControlsImpl.ACTION.TRUCK,middle:CameraControlsImpl.ACTION.DOLLY,right:props.vertical?CameraControlsImpl.ACTION.ROTATE:CameraControlsImpl.ACTION.TRUCK,wheel:CameraControlsImpl.ACTION.DOLLY}}
      touches={{one:CameraControlsImpl.ACTION.TOUCH_TRUCK,two:CameraControlsImpl.ACTION.TOUCH_DOLLY_TRUCK,three:CameraControlsImpl.ACTION.TOUCH_TRUCK}} minDistance={180} maxDistance={60000} smoothTime={.8/navigation.speed}/>
    {props.vertical&&<>
      <TreeStarField height={trunkTop} paused={props.paused}/>
      <TreeGalaxies height={trunkTop}/>
      <hemisphereLight args={['#d8edff','#14202e',1.4]}/>
      <directionalLight position={[1800,2800,1600]} color="#fff0d9" intensity={2.2}/>
      <directionalLight position={[-1600,1700,-1400]} color={props.vertical?'#b8c9b0':'#6cbaff'} intensity={props.vertical?1.3:2.8}/>
      <directionalLight position={[600,400,-1800]} color="#76e4c5" intensity={.8}/>
    </>}
    {props.vertical?<VerticalTreeBranches nodes={renderedNodes} groups={groups} focus={props.focus} growth={woodGrowth}/>:<lineSegments geometry={geometry}><lineBasicMaterial vertexColors transparent opacity={.7}/></lineSegments>}
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
      return <group key={node.id} ref={g=>{if(g){if(!g.userData.treeInitialized){g.userData.treeInitialized=true;g.position.set(...position);g.scale.setScalar(0);}groups.current.set(node.id,g);}else groups.current.delete(node.id);}}>
        {leaf?<group rotation={[0,node.azimuth??0,0]}><group rotation={[0,0,leaf.angle]}>
          <mesh geometry={VERTICAL_LEAF_BLADE} scale={[leaf.length*1.12,leaf.width*1.18,leaf.length*.5]} position={[-leaf.length*.12,0,-.5]}><meshBasicMaterial color={leaf.tint} transparent opacity={dim?.01:.035} depthWrite={false} blending={AdditiveBlending}/></mesh>
          <mesh geometry={VERTICAL_LEAF_BLADE} scale={[leaf.length,leaf.width,leaf.length*.5]} {...pick}><meshStandardMaterial vertexColors color={leaf.tint} roughness={.82} metalness={0} side={DoubleSide} transparent opacity={dim?.12:.98}/></mesh>
          <mesh geometry={VERTICAL_LEAF_VEIN} scale={[leaf.length,leaf.width,leaf.length*.5]} position={[0,0,.4]}><meshBasicMaterial color="#d8db8e" side={DoubleSide} transparent opacity={dim?.05:.36}/></mesh>
        </group></group>:<>
        <mesh {...pick}><sphereGeometry args={[radius,16,12]}/><meshBasicMaterial color={node.color} transparent opacity={look.core}/></mesh>
        <mesh {...pick}><sphereGeometry args={[look.glowRadius||radius*2.6,16,12]}/><meshBasicMaterial color={node.color} transparent opacity={look.glow} depthWrite={false} blending={AdditiveBlending}/></mesh>
        {props.vertical&&node.company&&node.layer==='energy'&&<mesh {...pick} userData={{rootHitTarget:true,minimumRadius:look.glowRadius||radius*2}}><sphereGeometry args={[1,12,8]}/><meshBasicMaterial transparent opacity={0} depthWrite={false}/></mesh>}
        </>}
        {!props.vertical&&node.kind==='layer'&&<mesh position={[0,-15,0]}><cylinderGeometry args={[115,115,3,64]}/><meshBasicMaterial color={node.color} transparent opacity={dim ? .015 : .09} depthWrite={false}/></mesh>}
        {present.has(node.id)&&<Html center={centered} position={centered?[0,node.kind==='root'?-25:0,0]:[(left?-1:1)*(node.kind==='company'?16:22),0,0]} distanceFactor={!props.vertical&&(node.kind==='company'||node.kind==='branch')?1100:undefined} zIndexRange={props.vertical?node.kind==='company'?[35,30]:node.kind==='branch'?[25,20]:node.kind==='layer'?[15,10]:[5,0]:[15,0]} style={{pointerEvents:'none'}}><div className={`${left&&!centered?styles.labelLeft:''} ${present.get(node.id)?.exiting?styles.exiting:styles.entering}`} style={{animationDuration:`${.8/navigation.speed}s`}}><button
          ref={el=>{if(el){labels.current.set(node.id,el);window.clearTimeout(labelsSettled.current);labelsSettled.current=window.setTimeout(invalidate,120);}else labels.current.delete(node.id);}}
          className={`${styles.node} ${styles[node.kind]}`} style={{color:node.color,...(props.vertical&&(node.kind==='company'||node.kind==='branch')?{}:{opacity:dim ? .2 : 1}),pointerEvents:'auto',...(node.company?{'--cap':capScale}:{})} as CSSProperties}
          disabled={!visible} data-exiting={present.get(node.id)?.exiting} data-tree-node={node.id} data-tree-layer={node.layer} data-tree-kind={node.kind} data-tree-dimmed={dim}
          data-compact={props.vertical&&(node.kind==='company'||node.kind==='branch')?false:undefined}
          data-label-visible={props.vertical&&(node.kind==='company'||node.kind==='branch')?false:undefined}
          aria-label={props.vertical&&(node.company||node.kind==='branch')?[node.label,node.company?.symbol].filter(Boolean).join(' '):undefined}
          data-tree-company={node.company?.id} data-cap-scale={node.company?marketCapScale(node.company.marketCap):undefined}
          aria-expanded={node.kind==='company'?undefined:props.open.includes(node.id)} aria-pressed={node.company?props.selected===node.company.id:undefined}
          title={node.company?[node.label,marketCapDescription(node.company.marketCap,locale)].filter(Boolean).join(' · '):props.vertical&&node.kind==='branch'?node.label:undefined}
          onFocus={()=>invalidate()} onBlur={()=>invalidate()} onPointerEnter={()=>invalidate()} onPointerLeave={()=>invalidate()}
          onClick={event=>{event.stopPropagation();if(node.company)props.onSelect(node.company.id);else {setGrowth({request:props.request,active:false});props.onToggle(node.id);}}}>
          <strong>{node.company?.country&&flags.has(node.company.country)&&<Image src={`/flags/${node.company.country.toLowerCase()}.svg`} alt="" width={14} height={10} unoptimized/>}{node.label}{node.company&&props.followedIds.includes(node.company.id)&&<span aria-label={text('Following','已关注')}> ★</span>}</strong>
          {node.company?<small>{[node.company.symbol,marketCapLabel(node.company.marketCap)].filter(Boolean).join(' · ')||text('Private / unlisted','非上市')} <CompanyPriceChange price={node.company.dailyPrice} locale={locale}/></small>:<span className={styles.count}>{node.count??''} {props.open.includes(node.id)?'−':'+'}</span>}
        </button></div></Html>}
      </group>;
    })}
  </>;
}
export default function IndustryTreeScene(props:TreeSceneProps){
  const [supported,setSupported]=useState(false);
  const [contextLost,setContextLost]=useState(false);
  const {text}=useLocale();
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
  return <><Boundary onUnavailable={props.onUnavailable}><Canvas onPointerMissed={event=>{if(event.type==='click'&&event.target instanceof HTMLCanvasElement&&props.selected)props.onSelect('');}} frameloop={props.paused||contextLost?'never':'demand'} dpr={[1,1.5]} camera={{position:[0,0,1600],fov:45,near:1,far:100000}} gl={{antialias:true}} fallback={null}><WebGLContextRecovery onLost={setContextLost}/><Scene {...props} paused={props.paused||contextLost}/></Canvas></Boundary>{contextLost&&<div className={styles.recovery} role="status">{text('3D rendering was interrupted. Waiting for the browser to restore it.','3D 渲染暂时中断，正在等待浏览器恢复。')} <button onClick={props.onRetry}>{text('Reload 3D','重新加载 3D')}</button></div>}</>;
}
