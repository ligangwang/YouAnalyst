"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, Html } from "@react-three/drei";
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Color, Vector3, Quaternion, type Mesh } from "three";
import { companyName, type KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { layout3D } from "@/lib/knowledge-graph/layout-3d";
import { createIntroCamera, createIntroOrbit } from "@/lib/knowledge-graph/intro-orbit";
import { relationLabels } from "@/lib/knowledge-graph/relationship-labels";
import { companySector } from "@/lib/knowledge-graph/sectors";
import { useLocale } from "./providers/locale-provider";
import { useWheelZoomGate, WheelZoomHint } from "./wheel-zoom-gate";
import styles from "./ai-knowledge-graph.module.css";

import { marketCapScale, marketCapLabel, marketCapDescription } from "@/lib/knowledge-graph/market-cap";

const flagCountries = new Set(["CA", "CN", "FR", "GB", "IE", "NL", "SG", "TW", "US"]);
function countryName(country: string | undefined, locale: string) {
  return country && flagCountries.has(country) ? new Intl.DisplayNames([locale], { type: "region" }).of(country) : undefined;
}

type Props = { hideReset?: boolean; cameraRequest: number; sectorFocus?: string; onSelectSector?: (id: string) => void; highlightedEdges?: string[]; activeEdge?: string; onSelectEdge?: (id: string) => void; graph: KnowledgeGraph; selected: string; onSelect: (id: string) => void; reset: number; onReset: () => void };
class RenderBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
const vertex = `attribute vec3 tint; attribute float emphasis; attribute float capScale; uniform float graphRadius; varying float vDepth; varying vec3 vColor; varying float vEmphasis;
void main(){vColor=tint;vEmphasis=emphasis;vec4 p=modelViewMatrix*vec4(position,1.);float centerDepth=-(modelViewMatrix*vec4(0.,0.,0.,1.)).z;vDepth=emphasis>1.?1.:clamp(.72+(p.z+centerDepth)/(2.*graphRadius),.38,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(32000./max(40.,-p.z),18.,72.)*capScale*(emphasis>1.?1.5:1.);}`;
const fragment = `varying float vDepth; varying vec3 vColor; varying float vEmphasis;
void main(){vec2 p=gl_PointCoord-.5;float r=length(p);float glow=exp(-r*9.)*.85;float core=1.-smoothstep(.04,.12,r);float rays=exp(-abs(p.x)*100.)*exp(-abs(p.y)*12.)+exp(-abs(p.y)*100.)*exp(-abs(p.x)*12.);float a=(glow+core+rays*.25)*min(1.,vEmphasis)*vDepth;if(a<.015)discard;gl_FragColor=vec4(mix(vColor,vec3(1.),core*.8),a);}`;

function Scene({ cameraRequest, graph, selected, onSelect, reset, activeEdge, highlightedEdges, onSelectEdge, sectorFocus = "", onSelectSector, introOrbitRef }: Props & { introOrbitRef: { current: boolean } }) {
  const { text, locale } = useLocale();
  const edgeElements = useRef(new Map<string, HTMLButtonElement>());
  const arrowElements = useRef(new Map<string, Mesh>());
  const sectorElements = useRef(new Map<string, HTMLButtonElement>());
  const layout = useMemo(() => layout3D(graph), [graph]);
  const pointUniforms = useMemo(() => ({graphRadius:{value:layout.radius}}), [layout.radius]);
  const controls = useRef<CameraControls>(null);
  const introPath = useRef<ReturnType<typeof createIntroCamera> | null>(null);
  const resumedOrbit = useRef<ReturnType<typeof createIntroOrbit> | null>(null);
  const resumeElapsed = useRef(0);
  const resumeAt = useRef<number | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preserveLabelPlacements = useRef(false);
  const labelPlacements = useRef(new WeakMap<HTMLElement, number>());
  const labelVisibility = useRef(new WeakMap<HTMLElement, boolean>());
  const labelFadeUntil = useRef(new WeakMap<HTMLElement, number>());
  const labelClearSince = useRef(new WeakMap<HTMLElement, number>());
  const lastLabelView = useRef<number[]>([]);
  const companyScales = useRef(new WeakMap<HTMLElement, number>());
  const reducedMotion = useRef(false);
  const { size, camera, invalidate, gl } = useThree();
  useEffect(()=>{
    const surface=gl.domElement.closest('[data-graph-interaction]');
    if(!surface)return;
    const pointers=new Set<number>(),keys=new Set<string>();
    const clearTimer=()=>{if(idleTimer.current!==null)clearTimeout(idleTimer.current);idleTimer.current=null;};
    const pause=()=>{
      introOrbitRef.current=false;
      resumedOrbit.current=null;resumeElapsed.current=0;resumeAt.current=null;
      preserveLabelPlacements.current=true;
      clearTimer();invalidate();
    };
    const schedule=()=>{
      clearTimer();
      if(pointers.size || keys.size)return;
      resumeAt.current=performance.now()+2000;
      idleTimer.current=setTimeout(()=>{
        idleTimer.current=null;
        // The demand renderer needs a frame that can actually start the orbit.
        resumeAt.current=performance.now();
        invalidate();
      },2000);
      invalidate();
    };
    const down=(event:Event)=>{pointers.add((event as PointerEvent).pointerId);pause();};
    const up=(event:PointerEvent)=>{if(pointers.delete(event.pointerId))schedule();};
    const wheel=()=>{pause();schedule();};
    const keydown=(event:Event)=>{keys.add((event as KeyboardEvent).code);pause();};
    const keyup=(event:KeyboardEvent)=>{if(keys.delete(event.code))schedule();};
    const focus=()=>{pause();schedule();};
    const blur=()=>{if(pointers.size || keys.size){pointers.clear();keys.clear();pause();schedule();}};
    const visibility=()=>{
      if(document.hidden){if(resumeAt.current!==null)clearTimer();blur();}
      else if(resumeAt.current!==null){resumeElapsed.current=0;schedule();}
    };
    surface.addEventListener('pointerdown',down,true);
    surface.addEventListener('wheel',wheel,{capture:true,passive:true});
    surface.addEventListener('keydown',keydown,true);
    surface.addEventListener('focusin',focus,true);
    // Releases outside the canvas and cancelled multi-touch gestures must also resume.
    window.addEventListener('pointerup',up,true);
    window.addEventListener('pointercancel',up,true);
    window.addEventListener('keyup',keyup,true);
    window.addEventListener('blur',blur);
    document.addEventListener('visibilitychange',visibility);
    return ()=>{
      clearTimer();
      surface.removeEventListener('pointerdown',down,true);
      surface.removeEventListener('wheel',wheel,true);
      surface.removeEventListener('keydown',keydown,true);
      surface.removeEventListener('focusin',focus,true);
      window.removeEventListener('pointerup',up,true);
      window.removeEventListener('pointercancel',up,true);
      window.removeEventListener('keyup',keyup,true);
      window.removeEventListener('blur',blur);
      document.removeEventListener('visibilitychange',visibility);
    };
  },[gl,invalidate,introOrbitRef]);
  useEffect(()=>{
    const media=window.matchMedia("(prefers-reduced-motion: reduce)");
    const update=()=>{reducedMotion.current=media.matches;resumeElapsed.current=0;invalidate();};
    update();media.addEventListener("change",update);
    document.addEventListener("visibilitychange", update);
    return ()=>{media.removeEventListener("change",update);document.removeEventListener("visibilitychange",update);};
  },[invalidate]);
  const labelElements = useRef(new Map<string, HTMLButtonElement>());
  const projected = useMemo(() => new Vector3(), []);
  const [hovered, setHovered] = useState("");
  const [hoveredEdge, setHoveredEdge] = useState("");
  // Hover reveals labels inside the demand frameloop; always request the frame that applies it,
  // rather than relying on the geometry swap to invalidate.
  useEffect(()=>{invalidate();},[hovered,hoveredEdge,invalidate]);
  const displayedEdge=activeEdge||hoveredEdge;
  const edgeEndpoints=useMemo(()=>new Set(layout.edges.filter(e=>e.id===displayedEdge).flatMap(e=>[e.source,e.target])),[layout,displayedEdge]);
  const sectorMembers = useMemo(() => new Set(layout.nodes.filter(n => companySector(n).id === sectorFocus).map(n => n.id)), [layout, sectorFocus]);
  const sectorConnected = useMemo(() => new Set(layout.edges.filter(e => sectorMembers.has(e.source) || sectorMembers.has(e.target)).flatMap(e => [e.source, e.target])), [layout, sectorMembers]);
  const connected = useMemo(() => new Set(layout.edges.filter(e => e.source === selected || e.target === selected).flatMap(e => [e.source, e.target])), [layout, selected]);
  const isBackgroundEdge = (edge: { id: string; source: string; target: string }) =>
    edge.id !== displayedEdge && (selected
      ? edge.source !== selected && edge.target !== selected
      : Boolean(sectorFocus) && !sectorMembers.has(edge.source) && !sectorMembers.has(edge.target));
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(layout.nodes.flatMap(n => [n.x, n.y, n.z]), 3));
    g.setAttribute("capScale", new Float32BufferAttribute(layout.nodes.map(n => marketCapScale(n.marketCap)), 1));
    g.setAttribute("tint", new Float32BufferAttribute(layout.nodes.flatMap(n => new Color(companySector(n).color).toArray()), 3));
    g.setAttribute("emphasis", new Float32BufferAttribute(layout.nodes.map(n => selected ? n.id === selected || n.id === hovered || edgeEndpoints.has(n.id) ? 2 : connected.has(n.id) ? 1 : .12 : n.id === hovered || edgeEndpoints.has(n.id) ? 2 : sectorFocus ? sectorMembers.has(n.id) ? 2 : sectorConnected.has(n.id) ? .7 : .15 : 1), 1));
    return g;
  }, [layout, selected, hovered, connected, sectorFocus, sectorMembers, sectorConnected, edgeEndpoints]);
  const lines = useMemo(() => {
    const positions = new Map(layout.nodes.map(n => [n.id, n]));
    const g = new BufferGeometry(), p: number[] = [], c: number[] = [], edgeIds: string[] = [];
    layout.edges.forEach(e => {
      const a = positions.get(e.source)!, b = positions.get(e.target)!;
      const color = new Color(e.id === displayedEdge ? "#ffffff" : selected && e.source !== selected && e.target !== selected ? "#14232e" : highlightedEdges?.includes(e.id) ? "#7ef4cb" : e.source === selected || e.target === selected ? "#9ee9ff" : selected ? "#14232e" : sectorFocus ? sectorMembers.has(e.source) || sectorMembers.has(e.target) ? "#9ee9ff" : "#101b25" : "#294557");
      const parts = e.commercialStatus === "ANNOUNCED" ? 16 : 1;
      for (let i = 0; i < parts; i++) {
        if (parts > 1 && i % 2) continue;
        edgeIds.push(e.id);
        for (const t of [i / parts, (i + 1) / parts]) { p.push(a.x + (b.x-a.x)*t, a.y+(b.y-a.y)*t, a.z+(b.z-a.z)*t); c.push(...color.toArray()); }
      }
    });
    g.setAttribute("position", new Float32BufferAttribute(p, 3)); g.setAttribute("color", new Float32BufferAttribute(c, 3)); g.userData.edgeIds = edgeIds; return g;
  }, [layout, selected, displayedEdge, highlightedEdges, sectorFocus, sectorMembers]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => lines.dispose(), [lines]);
  const sectors = useMemo(() => [...new Set(layout.nodes.map(n=>companySector(n).id))].map(id=>{
    const members=layout.nodes.filter(n=>companySector(n).id===id);
    return { ...companySector(members[0]), x:members.reduce((v,n)=>v+n.x,0)/members.length, y:members.reduce((v,n)=>v+n.y,0)/members.length, z:members.reduce((v,n)=>v+n.z,0)/members.length };
  }),[layout]);
  const fitDistance = layout.radius / Math.sin(Math.atan(Math.tan(Math.PI / 8) * Math.min(1, size.width / size.height))) * 1.15;
  const lastCameraRequest=useRef<{layout:typeof layout;request:number;reset:number}|null>(null);
  useEffect(() => {
    const c = controls.current; if (!c) return;
    // Evidence selection and panel resizing must not reset the user's orbit or zoom.
    const previous=lastCameraRequest.current;
    const restarting = previous !== null && previous.reset !== reset;
    if (restarting) {
      // Replay from the opening shot, including a fresh approach timer and label layout.
      introOrbitRef.current = true;
      introPath.current = null;
      labelPlacements.current = new WeakMap();
      labelVisibility.current = new WeakMap();
      companyScales.current = new WeakMap();
    } else if (previous && (previous.layout !== layout || previous.request !== cameraRequest)) {
      // Searching or focusing a company still cancels the automatic flight.
      introOrbitRef.current = false;
    }
    if(previous?.layout===layout && previous.request===cameraRequest && previous.reset===reset)return;
    lastCameraRequest.current={layout,request:cameraRequest,reset};
    // Search, focus, and Reset own their camera request; discard any old idle restart.
    resumeAt.current=null;resumedOrbit.current=null;resumeElapsed.current=0;
    if(idleTimer.current!==null){clearTimeout(idleTimer.current);idleTimer.current=null;}
    // Only an explicit new camera request may choose new label sides.
    labelPlacements.current=new WeakMap();
    labelVisibility.current=new WeakMap();
    labelFadeUntil.current=new WeakMap();
    labelClearSince.current=new WeakMap();
    // Only an explicit new view may rearrange labels after the user has explored it.
    preserveLabelPlacements.current=false;
    lastLabelView.current=[];
    const n = layout.nodes.find(n => n.id === selected);
    const sector=sectors.find(s=>s.id===sectorFocus);
    const members=sector?layout.nodes.filter(n=>companySector(n).id===sector.id):[];
    const radius=sector?Math.max(80,...members.map(n=>Math.hypot(n.x-sector.x,n.y-sector.y,n.z-sector.z))):0;
    const d = n ? Math.max(150, layout.radius * .8) : sector ? radius / Math.sin(Math.atan(Math.tan(Math.PI/8)*Math.min(1,size.width/size.height))) * 1.1 : fitDistance;
    const x = n?.x ?? sector?.x ?? 0, y = n?.y ?? sector?.y ?? 0, z = n?.z ?? sector?.z ?? 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Establish the opening shot immediately; the introduction owns its slow dolly.
    const opening = (!previous || restarting) && introOrbitRef.current && !n && !sector;
    const distance = opening && !reduced ? d * 1.4 : d;
    void c.setLookAt(x + distance*.2, y + distance*.12, z + distance, x, y, z, !reduced && !opening);
    invalidate();
  }, [layout, selected, fitDistance, reset, invalidate, sectorFocus, sectors, size.width, size.height, cameraRequest, introOrbitRef]);
  const degree = useMemo(() => {
    const counts = new Map<string,number>();
    layout.edges.forEach(e=>{counts.set(e.source,(counts.get(e.source)??0)+1);counts.set(e.target,(counts.get(e.target)??0)+1);});
    return counts;
  },[layout]);
  const edgeLabels = useMemo(() => {
    const positions=new Map(layout.nodes.map(n=>[n.id,n]));
    return layout.edges.map(edge=>{
      const a=positions.get(edge.source)!, b=positions.get(edge.target)!;
      const direction=new Vector3(b.x-a.x,b.y-a.y,b.z-a.z).normalize();
      const t=edge.id===activeEdge ? .5 : selected===edge.source? .38 : selected===edge.target? .62 : .5;
      const anchor=new Vector3(a.x,a.y,a.z).lerp(new Vector3(b.x,b.y,b.z),t);
      return {...edge, x:anchor.x,y:anchor.y,z:anchor.z,
        from:a.symbol||companyName(a,locale), to:b.symbol||companyName(b,locale),
        arrow:new Vector3(a.x,a.y,a.z).lerp(new Vector3(b.x,b.y,b.z),.72),
        rotation:new Quaternion().setFromUnitVectors(new Vector3(0,1,0),direction),
        directional:!["COMPETES_WITH","PARTNER_OF","ECOSYSTEM_PARTNER_OF","ENERGY_AGREEMENT_WITH"].includes(edge.type)
      };
    });
  },[layout,selected,activeEdge,locale]);
  const activeLabelPosition=(edge:{x:number;y:number;z:number}):[number,number]=>{
    const p=new Vector3(edge.x,edge.y,edge.z).project(camera);
    const x=Math.max(118,Math.min(size.width-118,(p.x+1)*size.width/2));
    let y=Math.max(30,Math.min(size.height-70,(1-p.y)*size.height/2));
    const company=layout.nodes.find(n=>n.id===selected);
    if(company){const point=new Vector3(company.x,company.y,company.z).project(camera);const cx=(point.x+1)*size.width/2,cy=(1-point.y)*size.height/2;
      if(Math.abs(x-cx)<210 && Math.abs(y-cy)<60)y=cy>100?cy-75:cy+75;
    }
    return [x,Math.max(30,Math.min(size.height-70,y))];
  };
  useFrame((_, delta) => {
    const focused=Boolean(selected || activeEdge || sectorFocus);
    if (focused) introOrbitRef.current = false;
    let rotation='paused';
    if(focused)rotation='focused';
    else if(reducedMotion.current)rotation='reduced';
    else if(document.hidden)rotation='hidden';
    else if (introOrbitRef.current && controls.current) {
      rotation='intro';
      // Move into a detail view before orbiting; keep the camera outside the node cloud.
      introPath.current ??= createIntroCamera(controls.current.distance, Math.max(layout.radius * 1.2, fitDistance * .42));
      const step = introPath.current(delta, controls.current.polarAngle);
      void controls.current.dollyTo(step.distance, false);
      void controls.current.rotate(step.azimuth, step.polar, false);
      invalidate();
    } else if(resumeAt.current!==null && controls.current){
      rotation='waiting';
      if(performance.now()>=resumeAt.current){
        rotation='resumed';
        resumedOrbit.current??=createIntroOrbit();
        resumeElapsed.current+=Math.max(0,Math.min(delta,.05));
        const t=Math.min(1,resumeElapsed.current/2),gain=t*t*(3-2*t);
        const step=resumedOrbit.current(Math.min(delta,.05)*gain,controls.current.polarAngle);
        // Relative rotation preserves the user's angle, distance, and panned target.
        void controls.current.rotate(step.azimuth,step.polar,false);
        invalidate();
      }
    }
    gl.domElement.dataset.rotation=rotation;
    if(controls.current){
      gl.domElement.dataset.cameraDistance=String(controls.current.distance);
      gl.domElement.dataset.cameraTarget=controls.current.getTarget(projected).toArray().join(',');
    }
    // Preserve the user's spatial context during AND after orbit, pan, or zoom.
    // Camera rest must not move or hide a company they were tracking to avoid overlap.
    const now=performance.now();
    // Matches the 1.2s CSS fade. Keep retiring labels' space until it completes.
    const fadeMs=reducedMotion.current?0:1200;
    const view=[...camera.matrixWorld.elements,...camera.projectionMatrix.elements,size.width,size.height];
    const viewChanged=view.some((value,index)=>value!==lastLabelView.current[index]);
    lastLabelView.current=view;
    const occupied: {x:number;y:number;w:number;h:number;owner?:HTMLElement;retiring?:boolean}[]=[];
    const place=(element:HTMLElement, x:number,y:number,z:number, eligible:boolean, width:number,height:number, companyGap?:number, reveal=false) => {
      projected.set(x,y,z).project(camera);
      const px=(projected.x+1)*size.width/2,py=(1-projected.y)*size.height/2;
      const gap=companyGap??0;
      const offsets=companyGap!==undefined?[[0,height/2+gap],[0,-height/2-gap],[width/2+gap,0],[-width/2-gap,0],[width/2+gap,height/2+gap],[-width/2-gap,height/2+gap],[width/2+gap,-height/2-gap],[-width/2-gap,-height/2-gap]]:[[0,0]];
      const previous=companyGap!==undefined?labelPlacements.current.get(element):undefined;
      const saved=companyGap!==undefined?labelVisibility.current.get(element):undefined;
      const ordered=previous!==undefined && previous>=0?[previous,...offsets.map((_,i)=>i).filter(i=>i!==previous)]:offsets.map((_,i)=>i);
      const inView=eligible && projected.z>-1 && projected.z<1;
      const fits=(i:number)=>{
        const [dx,dy]=offsets[i];
        const cx=px+dx,cy=py+dy;
        return cx-width/2>2 && cx+width/2<size.width-2 && cy-height/2>2 && cy+height/2<size.height-32 && !occupied.some(p=>p.owner!==element && !(p.retiring && saved===true) && Math.abs(cx-p.x)<(width+p.w)/2+3 && Math.abs(cy-p.y)<(height+p.h)/2+2);
      };
      const exploring=preserveLabelPlacements.current && companyGap!==undefined;
      // Exploration changes visibility, never the label's side. Hidden labels get a
      // stable default anchor too, so reappearing labels cannot switch sides.
      const choice=companyGap!==undefined && previous!==undefined && previous>=0?previous:exploring?0:ordered.find(fits)??(companyGap!==undefined?0:undefined);
      // Previously hidden companies can appear as space enters view; once placed, keep their side.
      if(companyGap!==undefined && previous===undefined)labelPlacements.current.set(element,choice??0);
      const offset=inView && choice!==undefined && choice>=0?offsets[choice]:undefined;
      let visible=Boolean(offset) && px>-width && px<size.width+width && py>-height && py<size.height+height && fits(choice!);
      if(exploring){
        // Rest, damping notifications, hover, and font easing cannot reshuffle visibility.
        visible=!viewChanged && saved!==undefined && !labelClearSince.current.has(element)?saved:visible;
      }
      if(companyGap!==undefined && fadeMs){
        // Finish an exit before re-entering, then require a continuously clear
        // gap. Brief collision-boundary changes must not reverse a fade.
        if(saved===false && visible){
          if((labelFadeUntil.current.get(element)??0)>now)visible=false;
          else {
            const clearSince=labelClearSince.current.get(element)??now;
            labelClearSince.current.set(element,clearSince);
            visible=now-clearSince>=220;
            if(!visible)invalidate();
          }
        } else labelClearSince.current.delete(element);
      }
      if(companyGap!==undefined)labelVisibility.current.set(element,visible);
      // An intentional hover may reveal this name without altering the saved layout.
      if(exploring && reveal && offset)visible=true;
      if(companyGap!==undefined){
        // Track the rendered state too: a hover reveal deliberately does not
        // alter saved collision visibility, but its exit still needs a reservation.
        if(fadeMs && element.dataset.visible==="true" && !visible)labelFadeUntil.current.set(element,now+fadeMs);
        // Keep the label mounted while CSS fades it out; hidden names must not
        // intercept clicks or keyboard focus during that transition.
        if(!visible && document.activeElement===element)element.blur();
        element.dataset.visible=String(visible);
        element.tabIndex=visible?0:-1;
        element.setAttribute("aria-hidden",String(!visible));
      } else element.style.visibility=visible?"visible":"hidden";
      const retiring=companyGap!==undefined && !visible && fadeMs>0 && (labelFadeUntil.current.get(element)??0)>now;
      if(retiring)invalidate();
      if(offset && (visible || retiring)){
        if(companyGap!==undefined){element.style.setProperty("--label-offset-x",`${offset[0]}px`);element.style.setProperty("--label-offset-y",`${offset[1]}px`);}
        occupied.push({x:px+offset[0],y:py+offset[1],w:width,h:height,owner:element,retiring});
      }
      return visible;
    };
    const target=controls.current?.getTarget(new Vector3()) ?? new Vector3();
    const close=camera.position.distanceTo(target)<fitDistance*.68;
    const labelScale=(x:number,y:number,z:number)=>Math.max(.45,Math.min(1.5,fitDistance*.65/Math.max(1,Math.hypot(camera.position.x-x,camera.position.y-y,camera.position.z-z))));
    // Write all font sizes first, then measure the actual rendered labels in one batch.
    let scalesSettling=false;
    // Ease the actual font dimensions, so collision measurement follows what is rendered.
    const blend=1-Math.exp(-Math.min(delta,.05)/.12);
    for(const n of layout.nodes){
      const element=labelElements.current.get(n.id);if(!element)continue;
      const targetScale=n.id===selected||n.id===hovered?1.5:labelScale(n.x,n.y,n.z);
      const previous=companyScales.current.get(element)??targetScale;
      const next=reducedMotion.current?targetScale:previous+(targetScale-previous)*blend;
      const scale=Math.abs(next-targetScale)<.001?targetScale:next;
      if(scale!==targetScale)scalesSettling=true;
      companyScales.current.set(element,scale);
      element.style.setProperty("--label-scale",String(scale));
    }
    if(scalesSettling)invalidate();
    for(const edge of edgeLabels)edgeElements.current.get(edge.id)?.style.setProperty("--label-scale",String(edge.id===displayedEdge?1:labelScale(edge.x,edge.y,edge.z)));
    for(const sector of sectors){
      const distance=Math.hypot(camera.position.x-sector.x,camera.position.y-sector.y,camera.position.z-sector.z);
      sectorElements.current.get(sector.id)?.style.setProperty("--label-scale",String(Math.max(.7,Math.min(1,fitDistance*.7/Math.max(1,distance)))));
    }
    const measurements=new Map([...labelElements.current.values(),...edgeElements.current.values(),...sectorElements.current.values()].map(element=>[element,{width:element.offsetWidth,height:element.offsetHeight}]));
    // Reserve exits before admitting any new labels, regardless of depth order.
    if(fadeMs)for(const n of layout.nodes){
      const element=labelElements.current.get(n.id);
      if(!element || labelVisibility.current.get(element)!==false || (labelFadeUntil.current.get(element)??0)<=now)continue;
      invalidate();
      projected.set(n.x,n.y,n.z).project(camera);
      if(projected.z<=-1 || projected.z>=1)continue;
      const {width,height}=measurements.get(element)!;
      const dx=parseFloat(element.style.getPropertyValue("--label-offset-x"))||0,dy=parseFloat(element.style.getPropertyValue("--label-offset-y"))||0;
      occupied.push({x:(projected.x+1)*size.width/2+dx,y:(1-projected.y)*size.height/2+dy,w:width,h:height,owner:element,retiring:true});
    }
    const wasVisible=(id:string)=>{const element=labelElements.current.get(id);return Boolean(element && labelVisibility.current.get(element));};
    const candidates=[...layout.nodes].sort((a,b)=>Number(b.id===selected||b.id===hovered)-Number(a.id===selected||a.id===hovered)||Number(edgeEndpoints.has(b.id))-Number(edgeEndpoints.has(a.id))||Number(sectorMembers.has(b.id))-Number(sectorMembers.has(a.id))||Number(connected.has(b.id))-Number(connected.has(a.id))||Number(wasVisible(b.id))-Number(wasVisible(a.id))||((close?((camera.position.x-a.x)**2+(camera.position.y-a.y)**2+(camera.position.z-a.z)**2)-((camera.position.x-b.x)**2+(camera.position.y-b.y)**2+(camera.position.z-b.z)**2):0))||(degree.get(b.id)??0)-(degree.get(a.id)??0));

    const visibleCompanies=new Set<string>();
    const placedEdges=new Set<string>();
    const placeEdges=(onlyActive=false)=>{
    for(const edge of [...edgeLabels].sort((a,b)=>Number(b.id===activeEdge)-Number(a.id===activeEdge))){
      if((edge.id===activeEdge)!==onlyActive || placedEdges.has(edge.id))continue;
      const element=edgeElements.current.get(edge.id);if(!element)continue;
      const endpointVisible=edge.id===displayedEdge && (visibleCompanies.has(edge.source)||visibleCompanies.has(edge.target));
      const {width,height}=measurements.get(element)!;
      let visible=false;
      if(edge.id===displayedEdge && endpointVisible){const [x,y]=activeLabelPosition(edge);element.style.visibility="visible";occupied.push({x,y,w:width,h:height});visible=true;}
      else visible=place(element,edge.x,edge.y,edge.z,endpointVisible,width,height);
      if(visible)placedEdges.add(edge.id);
      const arrow=arrowElements.current.get(edge.id);
      if(arrow){
        const depth=-projected.copy(edge.arrow).applyMatrix4(camera.matrixWorldInverse).z;
        // Keep the direction marker at most seven screen pixels tall when zooming in.
        const worldUnitsPerPixel=2*Math.max(0,depth)/(size.height*camera.projectionMatrix.elements[5]);
        arrow.scale.setScalar(Math.min(1,7*worldUnitsPerPixel/3.5));
        arrow.visible=depth>0;
      }
    }
    };

    const placeSectors=()=>{
    for(const sector of sectors){
      const element=sectorElements.current.get(sector.id);if(!element)continue;
      const {width,height}=measurements.get(element)!;
      place(element,sector.x,sector.y,sector.z,true,width,height);
    }
    };
    let sectorsPlaced=false;
    let shown=0;
    for(const n of candidates){
      const element=labelElements.current.get(n.id);if(!element)continue;
      const {width,height}=measurements.get(element)!;
      const depth=-projected.set(n.x,n.y,n.z).applyMatrix4(camera.matrixWorldInverse).z;
      const emphasis=geometry.getAttribute("emphasis").getX(layout.nodes.indexOf(n));
      // Match the point shader's physical pixel diameter, then convert to CSS pixels.
      const pointDiameter=Math.max(18,Math.min(72,32000/Math.max(40,depth)))*(emphasis>1?1.5:1);
      const gap=pointDiameter/(2*gl.getPixelRatio())+3;
      if(place(element,n.x,n.y,n.z,true,width,height,gap,n.id===hovered)){shown++;visibleCompanies.add(n.id);}
      if(shown===1&&!sectorsPlaced){placeEdges(true);placeEdges();placeSectors();sectorsPlaced=true;}
    }
    if(!sectorsPlaced)placeSectors();
    placeEdges(true);
    placeEdges();

  });
  // Damping keeps nudging the view after "rest"; only "sleep" means label placement has settled.
  return <>
    <CameraControls ref={controls} makeDefault minDistance={45} maxDistance={fitDistance*3} smoothTime={.25} onWake={()=>{gl.domElement.setAttribute("data-camera","moving");}} onRest={()=>{invalidate();}} onSleep={()=>{gl.domElement.setAttribute("data-camera","idle");invalidate();}} onControlStart={()=>{preserveLabelPlacements.current=true;}} onControl={()=>{preserveLabelPlacements.current=true;}} onControlEnd={()=>{invalidate();}}/>
    <points geometry={geometry} onClick={e => { if (e.delta > 5) return; e.stopPropagation(); if (e.index !== undefined) onSelect(layout.nodes[e.index].id); }} onPointerMove={e => { e.stopPropagation(); if(e.index !== undefined) setHovered(layout.nodes[e.index].id); }} onPointerOut={() => setHovered("")}>
      <shaderMaterial uniforms={pointUniforms} vertexShader={vertex} fragmentShader={fragment} transparent depthWrite={false} blending={AdditiveBlending}/>
    </points>
    <lineSegments geometry={lines} onPointerMove={e=>{if(e.index===undefined||e.buttons)return;e.stopPropagation();setHoveredEdge(lines.userData.edgeIds[Math.floor(e.index/2)]??"");}} onPointerOut={()=>setHoveredEdge("")} onClick={e => { if (e.delta > 5 || e.index === undefined) return; const id = lines.userData.edgeIds[Math.floor(e.index / 2)]; if (id) { e.stopPropagation();setHoveredEdge("");onSelectEdge?.(id); } }}><lineBasicMaterial vertexColors transparent opacity={.8}/></lineSegments>
    {sectors.map(sector=><Html key={sector.id} position={[sector.x,sector.y,sector.z]} center style={{pointerEvents:"none"}}><button aria-label={`${text("Focus sector", "聚焦产业")}: ${text(sector.en,sector.zh)}`} aria-pressed={sectorFocus===sector.id} onClick={()=>onSelectSector?.(sector.id)} ref={el=>{if(el){sectorElements.current.set(sector.id,el);invalidate();}else sectorElements.current.delete(sector.id);}} className={styles.sector3d} style={{color:sector.color,visibility:"hidden",pointerEvents:"auto",opacity:selected || (sectorFocus && sector.id !== sectorFocus) ? .25 : 1}}><span className={styles.sectorName}>{text(sector.en,sector.zh)}</span></button></Html>)}
    {edgeLabels.map(edge=><group key={edge.id}>
      {edge.directional && <mesh ref={el=>{if(el)arrowElements.current.set(edge.id,el);else arrowElements.current.delete(edge.id);}} position={edge.arrow} quaternion={edge.rotation} visible={false}><coneGeometry args={[.8,3.5,8]}/><meshBasicMaterial color="#a8e8ef" transparent opacity={isBackgroundEdge(edge) ? .06 : .8}/></mesh>}
      <Html key={`${edge.id}:${edge.id===activeEdge}`} position={[edge.x,edge.y,edge.z]} calculatePosition={edge.id===displayedEdge?()=>activeLabelPosition(edge):undefined} onOcclude={edge.id===displayedEdge?()=>{}:undefined} center zIndexRange={edge.id===displayedEdge?[25,24]:[19,0]} style={{pointerEvents:"none"}}><button ref={el=>{if(el){edgeElements.current.set(edge.id,el);invalidate();}else edgeElements.current.delete(edge.id);}} className={styles.edgeLabel3d} data-source={edge.source} data-target={edge.target} data-active={edge.id===activeEdge} style={{visibility:"hidden",pointerEvents:edge.id===activeEdge?"auto":"none",opacity:isBackgroundEdge(edge) ? .18 : 1}} title={`${edge.from} ${edge.directional?"→":"↔"} ${edge.to}: ${edge.summary}`} aria-label={`${edge.from} ${text(...(relationLabels[edge.type]??[edge.type,edge.type]))} ${edge.to}`} onClick={()=>onSelectEdge?.(edge.id)}>{text(...(relationLabels[edge.type]??[edge.type,edge.type]))}</button></Html>
    </group>)}
    {layout.nodes.map(n => <Html key={n.id} position={[n.x,n.y,n.z]} center zIndexRange={[20,0]} style={{pointerEvents:"none"}}><button ref={element => { if(element) { labelElements.current.set(n.id,element); invalidate(); } else labelElements.current.delete(n.id); }} className={styles.label3d} data-company-id={n.id} data-company-focus={selected ? n.id===selected ? "selected" : connected.has(n.id) ? "connected" : "background" : undefined} data-sector-emphasis={sectorFocus ? sectorMembers.has(n.id) ? "member" : sectorConnected.has(n.id) ? "connected" : "dimmed" : undefined} data-highlighted={n.id===selected || n.id===hovered || edgeEndpoints.has(n.id)} style={{color:companySector(n).color}} title={[companyName(n,locale), countryName(n.country,locale), marketCapDescription(n.marketCap,locale)].filter(Boolean).join(" · ")} onClick={() => onSelect(n.id)} aria-label={[companyName(n,locale), n.symbol, countryName(n.country,locale)].filter(Boolean).join(" · ")}><strong>{n.country && flagCountries.has(n.country) && <Image className={styles.companyFlag} src={`/flags/${n.country.toLowerCase()}.svg`} width={14} height={10} unoptimized loading="eager" alt="" aria-hidden="true" />}{companyName(n,locale)}</strong><span>{[n.symbol, marketCapLabel(n.marketCap)].filter(Boolean).join(" · ")}</span></button></Html>)}
  </>;
}

function GraphUnavailable() {
  const { text } = useLocale();
  return <div role="alert" className={styles.empty}>{text("This browser cannot display the 3D graph. Open “Explore AI stocks, companies and the supply chain” below to continue researching.", "此浏览器暂时无法显示 3D 图谱。点击下方“探索 AI 公司与产业链”即可打开公司列表，继续研究。")}</div>;
}
export default function CompanyGraph3D(props: Props) {
  const { text } = useLocale();
  const introOrbitRef = useRef(true);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [wheelGateRef, wheelHint] = useWheelZoomGate();
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      let available = false;
      try {
        const context = document.createElement("canvas").getContext("webgl2");
        available = Boolean(context);
        context?.getExtension("WEBGL_lose_context")?.loseContext();
      } catch { /* A device can reject context creation before the renderer mounts. */ }
      if (active) setSupported(available);
    });
    return () => { active = false; };
  }, []);
  const fallback = <GraphUnavailable />;
  if (supported === null) return <p role="status" className={styles.empty}>{text("Loading graph…", "正在加载图谱…")}</p>;
  if (!supported) return fallback;
  return <div ref={wheelGateRef} className={styles.canvas3d} data-graph-interaction>
    <WheelZoomHint hint={wheelHint}/>
    <RenderBoundary fallback={fallback}><Canvas onPointerMissed={event=>{if(event.target instanceof HTMLCanvasElement)props.onSelectEdge?.("");}} frameloop="demand" dpr={[1,1.5]} camera={{ position:[0,0,1100], fov:45, near:1, far:10000 }} gl={{ antialias:false, powerPreference:"high-performance" }} raycaster={{params:{Points:{threshold:7},Mesh:{},Line:{threshold:4},LOD:{},Sprite:{}}}} fallback={fallback} onCreated={({gl}) => { gl.domElement.addEventListener("webglcontextlost", () => setSupported(false), {once:true}); }}><Scene {...props} introOrbitRef={introOrbitRef}/></Canvas></RenderBoundary>
    {!props.hideReset && <button className={styles.resetView} onClick={props.onReset}>{text("Reset view", "重置视图")}</button>}
    <p className={styles.canvasHint}>{text("Drag: orbit · Right-drag: pan · Ctrl + scroll / pinch: zoom", "拖动旋转 · 右键拖动平移 · Ctrl + 滚轮／双指缩放")}</p>
  </div>;
}
