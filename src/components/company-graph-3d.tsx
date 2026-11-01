"use client";

import { LoadingSpinner } from './loading-spinner';
import { TOUR_IDLE_RESUME_MS, tourDelta } from '@/lib/ui/knowledge-graph/tour-motion';
import { IntelligencePropagation } from './intelligence-propagation';
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {UniverseMusicToggle} from "./universe-music";
import {useNavigationSettings} from "./navigation-settings";
import { CameraControls, Html } from "@react-three/drei";
import { AdditiveBlending, NormalBlending, BufferGeometry, Float32BufferAttribute, Color, Vector2, Vector3, Quaternion, LineSegments, Raycaster, type Points, type Intersection, type Mesh, type MeshBasicMaterial, type ShaderMaterial } from "three";
import { relationshipSummary, companyName, type KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { edgeOpacity, fadeEdge } from "@/lib/knowledge-graph/edge-visibility";
import { fitSelectionCamera } from "@/lib/knowledge-graph/selection-camera";
import { layout3D } from "@/lib/knowledge-graph/layout-3d";
import { layoutGalaxy } from "@/lib/knowledge-graph/layout-galaxy";
import { densitySelection } from "@/lib/knowledge-graph/density";
import { createIntroCamera, createIntroOrbit } from "@/lib/ui/knowledge-graph/intro-orbit";
import { relationLabels } from "@/lib/knowledge-graph/relationship-labels";
import { companySector } from "@/lib/knowledge-graph/sectors";
import { useLocale } from "./providers/locale-provider";
import { useWheelZoomGate, WheelZoomHint } from "./wheel-zoom-gate";
import { safeGraphOrbitStep } from "./graph-orbit-step";
import { TreeStarField } from './tree-star-field';
import { DeepSpaceClouds } from './deep-space-clouds';
import { DeepSpaceSky } from './deep-space-sky';
import { GalaxyDisc, galaxyOpeningDistance } from './galaxy-disc';
import { CompanyNebula } from './company-nebula';
import { CompanyPlanets } from './company-planets';
import {WebGLContextRecovery} from './webgl-context-recovery';
import styles from "./ai-knowledge-graph.module.css";

import { marketCapScale, graphNodeMarketCapLabel, marketCapDescription } from "@/lib/knowledge-graph/market-cap";
import {CompanyPriceChange} from './company-price-change';

const lineTint = new Color("#829ead");
const highlightedLineTint = new Color("#8fb9af");
const focusedLineTint = new Color("#bdd7e2");
const lightLineTint = new Color("#536e89");
const lightHighlightedLineTint = new Color("#176d85");
const lightFocusedLineTint = new Color("#075f7e");

const overlayPosition = (): [number, number] => [0, 0];
const flagCountries = new Set(["CA", "CN", "FR", "GB", "IE", "NL", "SG", "TW", "US"]);
const countryNames = new Map<string, Intl.DisplayNames>();
function countryName(country: string | undefined, locale: string) {
  if (!country || !flagCountries.has(country)) return undefined;
  let names = countryNames.get(locale);
  if (!names) { names = new Intl.DisplayNames([locale], { type: "region" }); countryNames.set(locale, names); }
  return names.of(country);
}
function editingGraphForm() {
  const element = document.activeElement;
  return Boolean(element?.matches('input,textarea,[contenteditable="true"]') && !element.closest('[data-company-search]'));
}

type Props = { universe?: "ball" | "galaxy"; companyFocus?: string[]; intelligence?: {origin:string;edges:string[]}; musicControls?: boolean; showAllEdges?: boolean; hideReset?: boolean; cameraRequest: number; sectorFocus?: string; highlightedEdges?: string[]; activeEdge?: string; onSelectEdge?: (id: string) => void; graph: KnowledgeGraph; selected: string; onSelect: (id: string) => void; reset: number; onReset: () => void };
class RenderBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
const vertex = `attribute vec3 tint; attribute float emphasis; attribute float capScale; uniform float graphRadius; uniform float lightMode; uniform float minPointSize; uniform vec2 planetRange; varying float vDepth; varying vec3 vColor; varying float vEmphasis; varying float vPlanet;
void main(){vColor=tint;vEmphasis=emphasis;vec4 p=modelViewMatrix*vec4(position,1.);vPlanet=planetRange.y>0.?1.-smoothstep(planetRange.x,planetRange.y,-p.z):0.;float centerDepth=-(modelViewMatrix*vec4(0.,0.,0.,1.)).z;float emphasisBlend=smoothstep(1.,2.,emphasis);vDepth=mix(clamp(.72+(p.z+centerDepth)/(2.*graphRadius),.38,1.),1.,emphasisBlend);gl_Position=projectionMatrix*p;gl_PointSize=clamp(32000./max(40.,-p.z),minPointSize,72.)*capScale*mix(1.,1.5,emphasisBlend)*mix(1.,.65,lightMode);}`;
const fragment = `varying float vDepth; varying vec3 vColor; varying float vEmphasis; varying float vPlanet; uniform float lightMode;
void main(){vec2 p=gl_PointCoord-.5;float r=length(p);float glow=exp(-r*9.)*.65;float core=1.-smoothstep(.04,.12,r);float rays=exp(-abs(p.x)*100.)*exp(-abs(p.y)*12.)+exp(-abs(p.y)*100.)*exp(-abs(p.x)*12.);float disk=1.-smoothstep(.09,.12,r);float ring=smoothstep(.15,.17,r)*(1.-smoothstep(.19,.21,r));float a=mix(glow+core+rays*.15,disk+ring*.75,lightMode)*min(1.,vEmphasis)*vDepth*mix(1.,.3,vPlanet);if(a<.015)discard;gl_FragColor=vec4(mix(mix(vColor,vec3(1.),core*.8),vColor*.45,lightMode),a);}`;

function Scene({ universe = "ball", light, companyFocus, intelligence, showAllEdges = false, cameraRequest, graph, selected, onSelect, reset, activeEdge, highlightedEdges, onSelectEdge, sectorFocus = "", introOrbitRef, onHoverChange }: Props & { light: boolean; introOrbitRef: { current: boolean }; onHoverChange: (hovered: boolean) => void }) {
  const { text, locale } = useLocale();
  // Graph uses the original baseline; the tree keeps its faster reveal cadence.
  const {selectedSpeed:speed}=useNavigationSettings();
  const edgeElements = useRef(new Map<string, HTMLButtonElement>());
  const edgeFades = useRef(new Map<string, number>());
  const linePoint = useMemo(() => new Vector3(), []);
  const arrowElements = useRef(new Map<string, Mesh>());
  const galaxyLayout = useMemo(() => universe === "galaxy" ? layoutGalaxy(graph) : null, [graph, universe]);
  const layout = useMemo(() => galaxyLayout ?? layout3D(graph), [graph, galaxyLayout]);
  // In the galaxy universe the companies form the nebula: the camera may travel
  // inside it, and distant companies shrink to points of light within the arms.
  const galaxyRadius = galaxyLayout?.galaxyRadius ?? 0;
  const clearance = galaxyRadius ? galaxyRadius * .25 : layout.radius;
  const minPointSize = galaxyRadius ? 3 : 18;
  // Up close in the galaxy universe, companies become small planets; their star glow fades to a halo.
  const planetRange = useMemo(() => new Vector2(galaxyRadius*1.5, galaxyRadius*2.3), [galaxyRadius]);
  const pointUniforms = useMemo(() => ({graphRadius:{value:layout.radius},lightMode:{value:0},minPointSize:{value:minPointSize},planetRange:{value:galaxyRadius ? planetRange : new Vector2()}}), [layout.radius, minPointSize, galaxyRadius, planetRange]);
  const pointMaterial = useRef<ShaderMaterial>(null);
  const controls = useRef<CameraControls>(null);
  const introPath = useRef<ReturnType<typeof createIntroCamera> | null>(null);
  const resumedOrbit = useRef<ReturnType<typeof createIntroOrbit> | null>(null);
  const resumedDirection = useRef(1);
  const resumeElapsed = useRef(0);
  const resumeAt = useRef<number | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleResume=useRef<()=>void>(()=>{});
  // The galaxy opening starts far beyond normal zoom; touching it skips straight to the graph.
  const openingFrame=useRef({far:Infinity,close:0});
  const skippedOpeningPress=useRef(false);
  const returningView=useRef(false);
  const returnRequest=useRef(0);
  const preserveLabelPlacements = useRef(false);
  const labelPlacements = useRef(new WeakMap<HTMLElement, number>());
  const labelVisibility = useRef(new WeakMap<HTMLElement, boolean>());
  const labelFadeUntil = useRef(new WeakMap<HTMLElement, number>());
  const labelClearSince = useRef(new WeakMap<HTMLElement, number>());
  const lastLabelView = useRef<number[]>([]);
  const edgeScales = useRef(new WeakMap<HTMLElement, number>());
  const companyScales = useRef(new WeakMap<HTMLElement, number>());
  const reducedMotion = useRef(false);
  const { size, camera, invalidate, gl } = useThree();
  useEffect(() => { if(pointMaterial.current)pointMaterial.current.uniforms.lightMode.value = light ? 1 : 0; invalidate(); }, [light, layout.radius, invalidate]);
  useEffect(()=>{
    const surface=gl.domElement.closest('[data-graph-interaction]');
    if(!surface)return;
    const pointers=new Set<number>(),keys=new Set<string>();
    const clearTimer=()=>{if(idleTimer.current!==null)clearTimeout(idleTimer.current);idleTimer.current=null;};
    const pause=(press=false)=>{
      returningView.current=false;returnRequest.current++;
      const c=controls.current;
      // Each new press decides afresh; focus or wheel events within a press keep its decision.
      if(press)skippedOpeningPress.current=false;
      if(introOrbitRef.current&&c&&c.distance>openingFrame.current.far){
        // Companies are an unclickable speck this far out: fly in instead of selecting.
        skippedOpeningPress.current=press;
        c.smoothTime=.45;void c.dollyTo(openingFrame.current.close,true);
      }
      introOrbitRef.current=false;
      resumedOrbit.current=null;resumeElapsed.current=0;resumeAt.current=null;
      preserveLabelPlacements.current=true;
      clearTimer();invalidate();
    };
    const schedule=()=>{
      clearTimer();
      if(pointers.size || keys.size)return;
      resumeAt.current=performance.now()+TOUR_IDLE_RESUME_MS;
      idleTimer.current=setTimeout(()=>{
        idleTimer.current=null;
        // The demand renderer needs a frame that can actually start the orbit.
        resumeAt.current=performance.now();
        invalidate();
      },TOUR_IDLE_RESUME_MS);
      invalidate();
    };
    const down=(event:Event)=>{pointers.add((event as PointerEvent).pointerId);pause(true);};
    scheduleResume.current=schedule;
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
      scheduleResume.current=()=>{};
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
    let wasEditing=false;
    // Pause automatic motion while editing a form; wake the demand renderer
    // on blur so it resumes from the same camera position.
    const formFocus=()=>{
      const c=controls.current;
      const editing=editingGraphForm();
      gl.domElement.closest('[data-graph-interaction]')?.toggleAttribute('data-editing-form',editing);
      if (editing) gl.domElement.dataset.rotation = 'input';
      if(c&&editing){
        void c.setLookAt(...c.getPosition(new Vector3(),false).toArray(),...c.getTarget(new Vector3(),false).toArray(),false);
      }
      if(wasEditing&&!editing&&!introOrbitRef.current)scheduleResume.current();
      wasEditing=editing;
      invalidate();
    };
    update();media.addEventListener("change",update);
    document.addEventListener("visibilitychange", update);
    document.addEventListener('focusin',formFocus);
    document.addEventListener('focusout',formFocus);
    return ()=>{media.removeEventListener("change",update);document.removeEventListener("visibilitychange",update);document.removeEventListener('focusin',formFocus);document.removeEventListener('focusout',formFocus);};
  },[invalidate,gl,introOrbitRef]);
  const labelElements = useRef(new Map<string, HTMLButtonElement>());
  // ResizeObserver delivers dimensions after browser layout, without a synchronous
  // read-after-write layout flush in the animation loop. It also tracks fonts,
  // translated text, price updates and responsive CSS.
  const labelSizes = useRef(new WeakMap<HTMLElement, {width:number;height:number}>());
  const labelObserver = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const box = entry.borderBoxSize[0];
        if (!box) continue;
        const element = entry.target as HTMLElement;
        const previous = labelSizes.current.get(element);
        if (previous?.width === box.inlineSize && previous?.height === box.blockSize) continue;
        labelSizes.current.set(element, {width:box.inlineSize,height:box.blockSize});
        changed = true;
      }
      if (changed) invalidate();
    });
    labelObserver.current = observer;
    for (const element of [...labelElements.current.values(), ...edgeElements.current.values()]) observer.observe(element,{box:"border-box"});
    return () => { observer.disconnect(); labelObserver.current = null; };
  }, [invalidate]);
  const registerLabel = (map: Map<string, HTMLButtonElement>, id: string, element: HTMLButtonElement | null) => {
    const previous = map.get(id);
    if (previous === element) return;
    if (previous) labelObserver.current?.unobserve(previous);
    if (element) { map.set(id, element); labelObserver.current?.observe(element,{box:"border-box"}); invalidate(); }
    else map.delete(id);
  };
  const positionLabel = (element: HTMLElement, x: number, y: number, z: number, pinned = false) => {
    const wrapper = element.parentElement!.parentElement!;
    projected.set(x,y,z).project(camera);
    const position = pinned ? activeLabelPosition({x,y,z}) : [(projected.x+1)*size.width/2,(1-projected.y)*size.height/2];
    wrapper.style.transform = `translate3d(${position[0]}px,${position[1]}px,0)`;
    wrapper.style.zIndex = pinned ? '25' : element.hasAttribute('data-company-id') ? '20' : '19';
    // Pinned summaries are clamped to the viewport even when their midpoint is
    // behind the camera; endpoint visibility still controls whether they show.
    wrapper.style.display = pinned || (projected.z > -1 && projected.z < 1) ? '' : 'none';
  };
  const projected = useMemo(() => new Vector3(), []);
  const [pointHovered, setPointHovered] = useState("");
  const [labelHovered, setLabelHovered] = useState("");
  const hovered = labelHovered || pointHovered;
  const focusCompany=selected||hovered;
  const [hoveredEdge, setHoveredEdge] = useState("");
  const crowded=layout.nodes.length>300;
  const [renderedIds,setRenderedIds]=useState<string[]>([]);
  const densityLast=useRef(-Infinity);
  const renderedSet=useMemo(()=>new Set(renderedIds),[renderedIds]);
  useEffect(()=>{setPointHovered("");setLabelHovered("");setHoveredEdge("");},[selected]);
  // Hover reveals labels inside the demand frameloop; always request the frame that applies it,
  // while keeping the star geometry mounted throughout the interaction.
  useEffect(()=>{invalidate();},[hovered,hoveredEdge,invalidate]);
  useEffect(()=>{labelVisibility.current=new WeakMap();labelClearSince.current=new WeakMap();invalidate();},[focusCompany,invalidate]);
  const edgeTargets = useMemo(() => new Map(layout.edges.map(edge => [edge.id, edgeOpacity(edge, selected, activeEdge ?? "", showAllEdges, selected?"":hovered, intelligence)])), [layout, selected, activeEdge, showAllEdges, hovered, intelligence]);
  const renderedEdges=useMemo(()=>crowded?layout.edges.filter(edge=>(edgeTargets.get(edge.id)??0)>0 && (edge.id===activeEdge || edge.source===selected || edge.target===selected || edge.source===hovered || edge.target===hovered || intelligence?.edges.includes(edge.id) || renderedSet.has(edge.source) || renderedSet.has(edge.target))):layout.edges,[crowded,layout,edgeTargets,activeEdge,selected,hovered,intelligence,renderedSet]);
  const displayedEdge=((edgeTargets.get(hoveredEdge) ?? 0) > 0 ? hoveredEdge : "")||activeEdge;
  const hoveringEntity=Boolean(hovered || (hoveredEdge && (edgeTargets.get(hoveredEdge) ?? 0) > 0));
  useEffect(()=>{onHoverChange(hoveringEntity);},[hoveringEntity,onHoverChange]);
  useEffect(()=>{invalidate();},[edgeTargets,invalidate]);
  const edgeEndpoints=useMemo(()=>new Set(layout.edges.filter(e=>e.id===displayedEdge).flatMap(e=>[e.source,e.target])),[layout,displayedEdge]);
  const sectorMembers = useMemo(() => new Set(layout.nodes.filter(n => companySector(n).id === sectorFocus).map(n => n.id)), [layout, sectorFocus]);
  const sectorConnected = useMemo(() => new Set(layout.edges.filter(e => sectorMembers.has(e.source) || sectorMembers.has(e.target)).flatMap(e => [e.source, e.target])), [layout, sectorMembers]);
  const connected = useMemo(() => new Set(layout.edges.filter(e => e.source === selected || e.target === selected).flatMap(e => [e.source, e.target])), [layout, selected]);
  const focusNeighbors=useMemo(()=>new Set(layout.edges.filter(edge=>edge.source===focusCompany||edge.target===focusCompany).flatMap(edge=>[edge.source,edge.target])),[layout,focusCompany]);
  const isBackgroundEdge = (edge: { id: string; source: string; target: string }) =>
    edge.id !== displayedEdge && (selected
      ? edge.source !== selected && edge.target !== selected
      : Boolean(sectorFocus) && !sectorMembers.has(edge.source) && !sectorMembers.has(edge.target));
  const focusedCompanies = useMemo(()=>companyFocus ? new Set(companyFocus) : undefined,[companyFocus]);
  useEffect(()=>{densityLast.current=-Infinity;invalidate();},[layout,selected,hovered,sectorFocus,focusedCompanies,edgeEndpoints,invalidate]);
  const pointTargets = useMemo(() => layout.nodes.map(n => crowded && !renderedSet.has(n.id) && n.id!==selected && n.id!==hovered ? 0 : focusedCompanies && !focusedCompanies.has(n.id) ? .12 : selected ? n.id === selected || n.id === hovered || edgeEndpoints.has(n.id) ? 2 : connected.has(n.id) ? 1 : .12 : focusCompany ? n.id===focusCompany || edgeEndpoints.has(n.id) ? 2 : focusNeighbors.has(n.id) ? 1 : .12 : sectorFocus ? sectorMembers.has(n.id) ? 2 : sectorConnected.has(n.id) ? .7 : .15 : 1), [layout, selected, hovered, connected, focusCompany, focusNeighbors, sectorFocus, sectorMembers, sectorConnected, edgeEndpoints, focusedCompanies,crowded,renderedSet]);
  useEffect(()=>{invalidate();},[pointTargets,invalidate]);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(layout.nodes.flatMap(n => [n.x, n.y, n.z]), 3));
    g.setAttribute("capScale", new Float32BufferAttribute(layout.nodes.map(n => marketCapScale(n.marketCap)), 1));
    g.setAttribute("tint", new Float32BufferAttribute(layout.nodes.flatMap(n => new Color(companySector(n).color).toArray()), 3));
    g.setAttribute("emphasis", new Float32BufferAttribute(layout.nodes.map(() => 1), 1));
    return g;
  }, [layout]);
  const lines = useMemo(() => {
    const positions = new Map(layout.nodes.map(n => [n.id, n]));
    const g = new BufferGeometry(), p: number[] = [], c: number[] = [], edgeIds: string[] = [];
    renderedEdges.forEach(e => {
      const a = positions.get(e.source)!, b = positions.get(e.target)!;
      const color = lineTint;
      const length = Math.hypot(b.x-a.x, b.y-a.y, b.z-a.z);
      // Similar short dashes on every relationship, rather than eight long fragments.
      const parts = e.commercialStatus === "ANNOUNCED" ? Math.max(2, Math.ceil(length / 8) * 2) : 1;
      for (let i = 0; i < parts; i++) {
        if (parts > 1 && i % 2) continue;
        edgeIds.push(e.id);
        for (const t of [i / parts, (i + 1) / parts]) { p.push(a.x + (b.x-a.x)*t, a.y+(b.y-a.y)*t, a.z+(b.z-a.z)*t); c.push(...color.toArray(), 0); }
      }
    });
    g.setAttribute("position", new Float32BufferAttribute(p, 3)); g.setAttribute("color", new Float32BufferAttribute(c, 4)); g.userData.edgeIds = edgeIds; return g;
  }, [layout,renderedEdges]);
  useEffect(()=>()=>lines.dispose(),[lines]);
  // Match the visible star in screen space: a world-space threshold shrinks
  // at overview zoom and lets relationship lines intercept company clicks.
  function companyHit(raycaster: Raycaster,clickTarget=false) {
    const pointer=raycaster.ray.at(1,new Vector3()).project(camera);
    let nearest:{index:number;distance:number;point:Vector3;screenDistance:number}|undefined;
    layout.nodes.forEach((node,index)=>{
      if(crowded && !renderedSet.has(node.id) && node.id!==selected && node.id!==hovered)return;
      const point=new Vector3(node.x,node.y,node.z),screen=point.clone().project(camera);
      if(screen.z < -1 || screen.z > 1)return;
      const depth=-point.clone().applyMatrix4(camera.matrixWorldInverse).z;
      const emphasis=geometry.getAttribute('emphasis').getX(index);
      const blend=Math.max(0,Math.min(1,emphasis-1));
      const starSize=Math.max(minPointSize,Math.min(72,32000/Math.max(40,depth)))*marketCapScale(node.marketCap)*(1+.5*blend*blend*(3-2*blend));
      const distance=Math.hypot((screen.x-pointer.x)*size.width/2,(screen.y-pointer.y)*size.height/2);
      // Clicks get a generous halo; hover leaves nearby relationships reachable.
      const radius=clickTarget?Math.max(18,starSize*.5/gl.getPixelRatio()+6):Math.max(3,starSize*.12/gl.getPixelRatio());
      if(distance<=radius && (!nearest || distance<nearest.screenDistance))nearest={index,distance:raycaster.ray.origin.distanceTo(point),point,screenDistance:distance};
    });
    return nearest;
  }
  function relationshipHit(raycaster:Raycaster){
    const pointer=raycaster.ray.at(1,new Vector3()).project(camera);
    const px=(pointer.x+1)*size.width/2,py=(1-pointer.y)*size.height/2;
    let nearest:{id:string;index:number;point:Vector3;distance:number;screenDistance:number}|undefined;
    const positions=new Map(layout.nodes.map(node=>[node.id,node]));
    for(const edge of renderedEdges){
      if((edgeTargets.get(edge.id)??0)<=0||(edgeFades.current.get(edge.id)??0)<=.01)continue;
      const a=positions.get(edge.source)!,b=positions.get(edge.target)!;
      const worldA=new Vector3(a.x,a.y,a.z),worldB=new Vector3(b.x,b.y,b.z),sa=worldA.clone().project(camera),sb=worldB.clone().project(camera);
      if(sa.z < -1||sa.z>1||sb.z < -1||sb.z>1)continue;
      const ax=(sa.x+1)*size.width/2,ay=(1-sa.y)*size.height/2,dx=(sb.x-sa.x)*size.width/2,dy=(sa.y-sb.y)*size.height/2;
      const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1)));
      const distance=Math.hypot(px-ax-t*dx,py-ay-t*dy);
      if(distance>5||nearest&&distance>=nearest.screenDistance)continue;
      const index=lines.userData.edgeIds.indexOf(edge.id)*2,point=worldA.lerp(worldB,t);
      if(index>=0)nearest={id:edge.id,index,point,distance:raycaster.ray.origin.distanceTo(point),screenDistance:distance};
    }
    return nearest;
  }
  const relationshipPress=useRef<{id:string;x:number;y:number;pointer:number;dragged:boolean}|null>(null);
  const starPress=useRef<{id:string;x:number;y:number;pointer:number;dragged:boolean}|null>(null);
  // Resolve a company at press time: orbit damping can move the star before
  // the browser emits click. Keep that target while tolerating a small drift.
  useEffect(()=>{
    const canvas=gl.domElement,ray=new Raycaster();
    const down=(event:PointerEvent)=>{
      starPress.current=null;relationshipPress.current=null;
      if(skippedOpeningPress.current)return;
      if(event.button!==0 || !event.isPrimary)return;
      const rect=canvas.getBoundingClientRect();
      ray.setFromCamera(new Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);
      // A visible relationship wins over a neighboring star halo, but not its core.
      const edge=companyHit(ray)?undefined:relationshipHit(ray);
      if(edge){relationshipPress.current={id:edge.id,x:event.clientX,y:event.clientY,pointer:event.pointerId,dragged:false};return;}
      const hit=companyHit(ray,true);
      if(hit)starPress.current={id:layout.nodes[hit.index].id,x:event.clientX,y:event.clientY,pointer:event.pointerId,dragged:false};
    };
    const move=(event:PointerEvent)=>{const press=relationshipPress.current??starPress.current;if(press && event.pointerId===press.pointer && Math.hypot(event.clientX-press.x,event.clientY-press.y)>5)press.dragged=true;};
    const cancel=()=>{starPress.current=null;relationshipPress.current=null;skippedOpeningPress.current=false;};
    const click=(event:MouseEvent)=>{
      // The press that skipped the opening neither selects nor clears a selection.
      if(skippedOpeningPress.current){skippedOpeningPress.current=false;event.stopImmediatePropagation();return;}
      const edge=relationshipPress.current,press=edge??starPress.current;starPress.current=null;relationshipPress.current=null;
      if(!press || event.button!==0)return;
      if(press.dragged || Math.hypot(event.clientX-press.x,event.clientY-press.y)>5){event.stopImmediatePropagation();return;}
      // Consume once before R3F can resolve a different target or a missed click.
      event.stopImmediatePropagation();if(edge){setHoveredEdge("");onSelectEdge?.(edge.id);}else onSelect(press.id);
    };
    canvas.addEventListener('pointerdown',down,true);canvas.addEventListener('click',click,true);
    window.addEventListener('pointermove',move,true);window.addEventListener('pointercancel',cancel,true);
    window.addEventListener('blur',cancel);
    return()=>{canvas.removeEventListener('pointerdown',down,true);canvas.removeEventListener('click',click,true);window.removeEventListener('pointermove',move,true);window.removeEventListener('pointercancel',cancel,true);window.removeEventListener('blur',cancel);};
  });
  function raycastCompanies(this: Points,raycaster: Raycaster,intersections: Intersection[]) {
    const hit=companyHit(raycaster);
    if(hit)intersections.push({distance:hit.distance,point:hit.point,index:hit.index,object:this});
  }
  // Invisible or retiring edges must not intercept blank-space clicks.
  function raycastEdges(this: LineSegments, raycaster: Raycaster, intersections: Intersection[]) {
    if(companyHit(raycaster))return;
    const hit=relationshipHit(raycaster);
    if(hit)intersections.push({distance:hit.distance,point:hit.point,index:hit.index,object:this});
  }
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => lines.dispose(), [lines]);
  const sectors = useMemo(() => [...new Set(layout.nodes.map(n=>companySector(n).id))].map(id=>{
    const members=layout.nodes.filter(n=>companySector(n).id===id);
    return { ...companySector(members[0]), x:members.reduce((v,n)=>v+n.x,0)/members.length, y:members.reduce((v,n)=>v+n.y,0)/members.length, z:members.reduce((v,n)=>v+n.z,0)/members.length };
  }),[layout]);
  const fitDistance = layout.radius / Math.sin(Math.atan(Math.tan(Math.PI / 8) * Math.min(1, size.width / size.height))) * 1.15;
  const introClose=galaxyRadius ? galaxyRadius*1.05 : Math.max(layout.radius*1.3,fitDistance*.9);
  const openingDistance=galaxyRadius ? galaxyRadius*3.4/Math.min(1,size.width/Math.max(1,size.height)) : galaxyOpeningDistance(size.width/Math.max(1,size.height));
  // Only views beyond the normal fitted view count as the far opening: on narrow
  // screens (and for reduced motion) the fitted view itself must stay clickable.
  useEffect(()=>{openingFrame.current={far:galaxyRadius ? Math.max(galaxyRadius*2.5,fitDistance*1.2) : fitDistance*3,close:introClose};},[fitDistance,galaxyRadius,introClose]);
  const savedView=useRef<{position:Vector3;target:Vector3}|null>(null);
  const lastSelected=useRef("");
  const restoredView=useRef(false);
  const lastCameraRequest=useRef<{layout:typeof layout;request:number;reset:number;width:number;height:number}|null>(null);
  // Apply selection framing before the next paint; a shared overlay can commit
  // its selection while a passive effect is still waiting behind animation work.
  useLayoutEffect(() => {
    const c = controls.current; if (!c) return;
    // Evidence selection and panel resizing must not reset the user's orbit or zoom.
    const previous=lastCameraRequest.current;
    if(selected&&!lastSelected.current&&!savedView.current)savedView.current={position:c.getPosition(new Vector3(),false),target:c.getTarget(new Vector3(),false)};
    if(!selected&&lastSelected.current&&savedView.current&&previous?.reset===reset){
      const saved=savedView.current;savedView.current=null;lastSelected.current='';restoredView.current=true;
      const request=++returnRequest.current;returningView.current=true;
      c.smoothTime=(reducedMotion.current?.15:.8)/speed;
      void c.setLookAt(...saved.position.toArray(),...saved.target.toArray(),true).then(()=>{
        if(returnRequest.current!==request)return;
        returningView.current=false;scheduleResume.current();invalidate();
      });
      invalidate();return;
    }
    if(selected||previous?.layout!==layout||previous.request!==cameraRequest||previous.reset!==reset){returningView.current=false;returnRequest.current++;}
    lastSelected.current=selected;
    if(selected||previous?.layout!==layout||previous.request!==cameraRequest||previous.reset!==reset)restoredView.current=false;
    if(previous?.reset!==reset)savedView.current=null;
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
    if(previous?.layout===layout && previous.request===cameraRequest && previous.reset===reset&&(restoredView.current||(previous.width===size.width&&previous.height===size.height)))return;
    lastCameraRequest.current={layout,request:cameraRequest,reset,width:size.width,height:size.height};
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
    const neighbors=n?layout.nodes.filter(v=>v.id===selected||connected.has(v.id)):[];
    const center=neighbors.length?new Vector3(...(["x","y","z"] as const).map(axis=>neighbors.reduce((sum,v)=>sum+v[axis],0)/neighbors.length) as [number,number,number]):null;
    const d = sector ? radius / Math.sin(Math.atan(Math.tan(Math.PI/8)*Math.min(1,size.width/size.height))) * 1.1 : fitDistance;
    const x = center?.x ?? sector?.x ?? 0, y = center?.y ?? sector?.y ?? 0, z = center?.z ?? sector?.z ?? 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Establish the opening shot immediately; the introduction owns its slow dolly.
    const opening = (!previous || restarting) && introOrbitRef.current && !n && !sector;
    // Open on the whole galaxy; the introduction then flies in to the graph.
    const distance = opening && !reduced ? Math.max(d * 1.4, light ? 0 : openingDistance) : d;
    const direction=restarting?new Vector3(0,0,1):c.getPosition(new Vector3()).sub(c.getTarget(new Vector3())).normalize();
    // The detail card changes the viewport in this commit. Fiber's resize
    // observer reports that size later; framing against its previous size would
    // produce a second camera jump. Measure once on selection, never per frame.
    const selectionSize=n?gl.domElement.parentElement?.getBoundingClientRect():null;
    const fitted=n?fitSelectionCamera(neighbors,direction,selectionSize?.width||size.width,selectionSize?.height||size.height,clearance):null;
    const position=fitted?.position??new Vector3(x,y,z).addScaledVector(direction,distance);
    const target=fitted?.target??new Vector3(x,y,z);
    if(!fitted&&position.length()<clearance*1.15)position.setLength(clearance*1.15);
    c.smoothTime=.8/speed;
    // Company clicks frame their connections immediately; reserve camera flights
    // for sector navigation and the automatic tour.
    void c.setLookAt(...position.toArray(),...target.toArray(),!n&&!reduced&&!opening);
    invalidate();
  }, [layout, selected, fitDistance, reset, invalidate, sectorFocus, sectors, size.width, size.height, cameraRequest, introOrbitRef, connected, speed, gl, light, clearance, openingDistance]);
  const lastFocus=useRef({focused:Boolean(selected||activeEdge||sectorFocus),reset});
  useEffect(()=>{
    const focused=Boolean(selected||activeEdge||sectorFocus),previous=lastFocus.current;
    lastFocus.current={focused,reset};
    if(previous.focused&&!focused&&previous.reset===reset){
      introOrbitRef.current=false;resumedOrbit.current=null;resumeElapsed.current=0;
      scheduleResume.current();
    }
  },[selected,activeEdge,sectorFocus,reset,introOrbitRef]);
  useEffect(()=>{invalidate();},[speed,invalidate]);
  const degree = useMemo(() => {
    const counts = new Map<string,number>();
    layout.edges.forEach(e=>{counts.set(e.source,(counts.get(e.source)??0)+1);counts.set(e.target,(counts.get(e.target)??0)+1);});
    return counts;
  },[layout]);
  const edgeLabels = useMemo(() => {
    const positions=new Map(layout.nodes.map(n=>[n.id,n]));
    return renderedEdges.map(edge=>{
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
  },[layout,selected,activeEdge,locale,renderedEdges]);
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
    if(crowded && performance.now()-densityLast.current>200){
      densityLast.current=performance.now();
      const points=layout.nodes.map(n=>{const p=new Vector3(n.x,n.y,n.z).project(camera);return {id:n.id,x:(p.x+1)*size.width/2,y:(1-p.y)*size.height/2,depth:p.z,priority:n.id===selected||n.id===hovered||edgeEndpoints.has(n.id)?3:focusedCompanies?.has(n.id)||sectorMembers.has(n.id)?2:1};}).filter(p=>p.depth>-1&&p.depth<1);
      const next=densitySelection(points,size.width,size.height);
      setRenderedIds(previous=>previous.length===next.length&&previous.every((id,i)=>id===next[i])?previous:next);
    }
    const editingForm=editingGraphForm();
    const immediate=reducedMotion.current||editingForm;
    const surface=gl.domElement.closest('[data-graph-interaction]');
    if(surface&&surface.hasAttribute('data-editing-form')!==editingForm)surface.toggleAttribute('data-editing-form',editingForm);
    const colors = lines.getAttribute("color"), positions = lines.getAttribute("position");
    let fading = false, colorsChanged = false;
    // Change only the highlight buffer. Replacing/disposal of the points geometry
    // during hover can blank the stars and reset the raycast hover records.
    const pointEmphasis = geometry.getAttribute("emphasis");
    let pointsChanged = false;
    for (let index = 0; index < pointTargets.length; index++) {
      const current = pointEmphasis.getX(index);
      const target = pointTargets[index];
      const next = fadeEdge(current, target, delta, immediate);
      if (Math.abs(next - current) > .000001) { pointEmphasis.setX(index, next); pointsChanged = true; }
      if (Math.abs(next - target) > .0001) fading = true;
    }
    if (pointsChanged) pointEmphasis.needsUpdate = true;
    for (const edge of renderedEdges) {
      const target = edgeTargets.get(edge.id) ?? 0;
      const next = fadeEdge(edgeFades.current.get(edge.id) ?? 0, target, delta, immediate);
      edgeFades.current.set(edge.id, next);
      if (Math.abs(next - target) > .0001) fading = true;
    }
    const centerDepth = -linePoint.set(0,0,0).applyMatrix4(camera.matrixWorldInverse).z;
    const depthOpacity = (depth: number) => Math.max(.35, Math.min(1, .75 + (centerDepth-depth) / (2*layout.radius)));
    for (let segment = 0; segment < lines.userData.edgeIds.length; segment++) {
      const id = lines.userData.edgeIds[segment];
      const opacity = edgeFades.current.get(id) ?? 0;
      const tint = light
        ? id === displayedEdge ? lightFocusedLineTint : highlightedEdges?.includes(id) ? lightHighlightedLineTint : lightLineTint
        : id === displayedEdge ? focusedLineTint : highlightedEdges?.includes(id) ? highlightedLineTint : lineTint;
      for (const vertex of [segment * 2, segment * 2 + 1]) {
        const depth = -linePoint.fromBufferAttribute(positions,vertex).applyMatrix4(camera.matrixWorldInverse).z;
        const alpha = opacity * (id === displayedEdge ? 1 : depthOpacity(depth));
        if (Math.abs(colors.getW(vertex)-alpha) > .000001 || Math.abs(colors.getX(vertex)-tint.r) > .000001 || Math.abs(colors.getY(vertex)-tint.g) > .000001) {
          colors.setXYZW(vertex,tint.r,tint.g,tint.b,alpha);
          colorsChanged = true;
        }
      }
    }
    if (colorsChanged) colors.needsUpdate = true;
    if (fading) invalidate();
    for (const edge of edgeLabels) {
      const arrow = arrowElements.current.get(edge.id);
      if (!arrow) continue;
      const material = arrow.material as MeshBasicMaterial;
      material.color.copy(light ? lightLineTint : lineTint);
      const depth = -linePoint.copy(edge.arrow).applyMatrix4(camera.matrixWorldInverse).z;
      material.opacity = (edgeFades.current.get(edge.id) ?? 0) * (edge.id === displayedEdge ? .8 : .6 * depthOpacity(depth));
    }
    const focused=Boolean(selected || activeEdge || sectorFocus);
    if(editingForm&&controls.current){
      const c=controls.current,position=c.getPosition(new Vector3(),false),target=c.getTarget(new Vector3(),false);
      // A resize during result loading can start a new camera transition.
      // Cancel its destination at the current view, without scheduling frames
      // continuously once the camera is stationary.
      if(position.distanceTo(c.getPosition(new Vector3()))>1e-6||target.distanceTo(c.getTarget(new Vector3()))>1e-6){
        void c.setLookAt(...position.toArray(),...target.toArray(),false);
      }
    }
    // Correct unsafe destinations smoothly; never teleport the rendered camera mid-return.
    if(controls.current){const p=controls.current.getPosition(new Vector3());if(p.length()<clearance*1.12){if(!p.length())p.z=1;p.setLength(clearance*1.15);const t=controls.current.getTarget(new Vector3());void controls.current.setLookAt(...p.toArray(),...t.toArray(),true);}}
    gl.domElement.dataset.visibleRelationships=renderedEdges.filter(edge=>(edgeTargets.get(edge.id)??0)>0).map(edge=>edge.id).join(',');
    gl.domElement.dataset.hoveredRelationship=displayedEdge;
    gl.domElement.dataset.ballRadius=String(layout.radius);
    // The closest the camera may come to the graph's centre (the whole ball, or the galaxy core).
    gl.domElement.dataset.cameraClearance=String(clearance);
    gl.domElement.dataset.cameraPosition=camera.position.toArray().join(',');
    if (focused) introOrbitRef.current = false;
    let rotation='paused';
    if(focused)rotation='focused';
    else if(reducedMotion.current)rotation='reduced';
    else if(document.hidden)rotation='hidden';
    else if(editingForm)rotation='input';
    else if(hovered)rotation='hovered';
    else if(returningView.current)rotation='returning';
    else if (introOrbitRef.current && controls.current) {
      rotation='intro';
      // Move into a detail view before orbiting; keep the camera outside the node cloud.
      introPath.current ??= createIntroCamera(controls.current.distance, introClose);
      const step = introPath.current(delta, controls.current.polarAngle, speed);
      void controls.current.dollyTo(step.distance, false);
      void controls.current.rotate(step.azimuth, step.polar, false);
      invalidate();
    } else if(resumeAt.current!==null && controls.current){
      rotation='waiting';
      if(performance.now()>=resumeAt.current){
        rotation='resumed';
        resumedOrbit.current??=createIntroOrbit();
        resumeElapsed.current+=tourDelta(delta,speed);
        const t=Math.min(1,resumeElapsed.current/2),gain=t*t*(3-2*t);
        const step=resumedOrbit.current(tourDelta(delta)*gain,controls.current.polarAngle,speed);
        // Resume around the user's chosen target at their chosen distance.
        // Only selection framing or an explicit Reset may replace that view.
        const safeStep=safeGraphOrbitStep(controls.current.getPosition(new Vector3()),controls.current.getTarget(new Vector3()),
          {azimuth:step.azimuth*resumedDirection.current,polar:step.polar},clearance*1.2);
        if(safeStep.reversed){resumedDirection.current*=-1;resumeElapsed.current=0;}
        void controls.current.rotate(safeStep.azimuth,safeStep.polar,true);
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
    const fadeMs=immediate?0:1200;
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
      if(!eligible)visible=false;
      if(companyGap!==undefined)labelVisibility.current.set(element,visible);
      // An intentional hover may reveal this name without altering the saved layout.
      // Keep the pointer target present throughout hover, including the initial
      // orbit. Collision culling must not hide it and trigger pointer-leave.
      if(reveal && offset)visible=true;
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
    // Composite distance scaling without changing the labels' text layout.
    let scalesSettling=false;
    // Collision boxes follow the same eased scale as the painted label.
    const blend=1-Math.exp(-Math.min(delta,.05)/.12);
    for(const n of layout.nodes){
      const element=labelElements.current.get(n.id);if(!element)continue;
      // Hover emphasizes color/glow without resizing the pointer target.
      const targetScale=n.id===selected?1.5:labelScale(n.x,n.y,n.z);
      const previous=companyScales.current.get(element)??targetScale;
      const next=immediate?targetScale:previous+(targetScale-previous)*blend;
      const scale=Math.abs(next-targetScale)<.001?targetScale:next;
      if(scale!==targetScale)scalesSettling=true;
      companyScales.current.set(element,scale);
      element.style.setProperty("--label-scale",String(scale));
      if(focusedCompanies && !focusedCompanies.has(n.id))element.style.setProperty("--label-emphasis",".15");
      else element.style.removeProperty("--label-emphasis");
    }
    if(scalesSettling)invalidate();
    for(const edge of edgeLabels){
      const element=edgeElements.current.get(edge.id);if(!element)continue;
      const scale=edge.id===displayedEdge?1:labelScale(edge.x,edge.y,edge.z);
      edgeScales.current.set(element,scale);
      element.style.setProperty("--label-scale",String(scale));
    }
    const measurementFor=(element:HTMLElement)=>{
      const base=labelSizes.current.get(element);if(!base)return;
      const scale=companyScales.current.get(element)??edgeScales.current.get(element)??1;
      return {width:base.width*scale,height:base.height*scale};
    };
    // Reserve exits before admitting any new labels, regardless of depth order.
    if(fadeMs)for(const n of layout.nodes){
      const element=labelElements.current.get(n.id);
      if(!element || labelVisibility.current.get(element)!==false || (labelFadeUntil.current.get(element)??0)<=now)continue;
      invalidate();
      projected.set(n.x,n.y,n.z).project(camera);
      if(projected.z<=-1 || projected.z>=1)continue;
      const measurement=measurementFor(element);if(!measurement)continue;
      const {width,height}=measurement;
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
      positionLabel(element,edge.x,edge.y,edge.z,edge.id===displayedEdge);
      const endpointVisible=(edgeTargets.get(edge.id) ?? 0) > 0 && edge.id===displayedEdge && (visibleCompanies.has(edge.source)||visibleCompanies.has(edge.target));
      const measurement=measurementFor(element);if(!measurement)continue;
      const {width,height}=measurement;
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
        arrow.visible=depth>0 && (arrow.material as MeshBasicMaterial).opacity > .001;
      }
    }
    };

    let edgesPlaced=false;
    let shown=0;
    for(const n of candidates){
      const element=labelElements.current.get(n.id);if(!element)continue;
      const measurement=measurementFor(element);if(!measurement)continue;
      const {width,height}=measurement;
      positionLabel(element,n.x,n.y,n.z);
      const depth=-projected.set(n.x,n.y,n.z).applyMatrix4(camera.matrixWorldInverse).z;
      // Match the point shader's physical pixel diameter, then convert to CSS pixels.
      // Hover glow must not move the label out from under a stationary pointer.
      const enlarged=n.id===selected || edgeEndpoints.has(n.id) || (!selected && sectorMembers.has(n.id));
      const pointDiameter=Math.max(18,Math.min(72,32000/Math.max(40,depth)))*(enlarged?1.5:1);
      const gap=pointDiameter/(2*gl.getPixelRatio())+3;
      if(place(element,n.x,n.y,n.z,Boolean(focusCompany)&&(n.id===focusCompany||focusNeighbors.has(n.id))||edgeEndpoints.has(n.id),width,height,gap,n.id===focusCompany)){shown++;visibleCompanies.add(n.id);}
      if(shown===1&&!edgesPlaced){placeEdges(true);placeEdges();edgesPlaced=true;}
    }
    placeEdges(true);
    placeEdges();

  });
  // Damping keeps nudging the view after "rest"; only "sleep" means label placement has settled.
  return <>
    {intelligence?.origin && <IntelligencePropagation layout={layout} origin={intelligence.origin} edges={intelligence.edges}/>}
    {!light && <><DeepSpaceSky height={0} focused={Boolean(selected || displayedEdge)} galaxy/>{galaxyLayout && <CompanyPlanets geometry={geometry} range={planetRange} galaxyRadius={galaxyRadius}/>}{galaxyLayout ? <CompanyNebula nodes={galaxyLayout.nodes} arms={galaxyLayout.arms} galaxyRadius={galaxyRadius} introRef={introOrbitRef} focused={Boolean(selected || displayedEdge || sectorFocus)}/> : <GalaxyDisc graphRadius={layout.radius} introRef={introOrbitRef} focused={Boolean(selected || displayedEdge || sectorFocus)}/>}<TreeStarField height={0} count={1100} paused/><DeepSpaceClouds height={0}/></>}
    <CameraControls ref={controls} makeDefault minDistance={clearance*1.15} maxDistance={light ? fitDistance*3 : Math.max(fitDistance*3, openingDistance*1.05)} smoothTime={.8/speed} onWake={()=>{gl.domElement.setAttribute("data-camera","moving");}} onRest={()=>{invalidate();}} onSleep={()=>{gl.domElement.setAttribute("data-camera","idle");invalidate();}} onControlStart={()=>{preserveLabelPlacements.current=true;}} onControl={()=>{preserveLabelPlacements.current=true;}} onControlEnd={()=>{invalidate();}}/>
    <points geometry={geometry} raycast={raycastCompanies} onClick={e => { if (e.delta > 5) return; e.stopPropagation(); if (e.index !== undefined) onSelect(layout.nodes[e.index].id); }} onPointerMove={e => { e.stopPropagation(); if(e.index !== undefined) setPointHovered(layout.nodes[e.index].id); }} onPointerOut={e => {
      // A different point in this shared geometry may exit while the current
      // point remains under the pointer. Only clear the exiting company.
      const id = e.index === undefined ? undefined : layout.nodes[e.index]?.id;
      setPointHovered(current => current === id ? "" : current);
    }}>
      <shaderMaterial ref={pointMaterial} uniforms={pointUniforms} vertexShader={vertex} fragmentShader={fragment} transparent depthWrite={false} blending={light ? NormalBlending : AdditiveBlending}/>
    </points>
    <lineSegments geometry={lines} raycast={raycastEdges} onPointerMove={e=>{if(e.index===undefined||e.buttons)return;e.stopPropagation();setHoveredEdge(lines.userData.edgeIds[Math.floor(e.index/2)]??"");}} onPointerOut={()=>setHoveredEdge("")} onClick={e => { if (e.delta > 5 || e.index === undefined) return; const id = lines.userData.edgeIds[Math.floor(e.index / 2)]; if (id) { e.stopPropagation();setHoveredEdge("");onSelectEdge?.(id); } }}><lineBasicMaterial vertexColors transparent depthWrite={false}/></lineSegments>
    {edgeLabels.map(edge=><group key={edge.id}>
      {edge.directional && <mesh ref={el=>{if(el)arrowElements.current.set(edge.id,el);else arrowElements.current.delete(edge.id);}} position={edge.arrow} quaternion={edge.rotation} visible={false}><coneGeometry args={[.8,3.5,8]}/><meshBasicMaterial color="#829ead" transparent depthWrite={false} opacity={0}/></mesh>}
    </group>)}
    <Html onOcclude={()=>{}} calculatePosition={overlayPosition} zIndexRange={[20,20]} style={{pointerEvents:"none"}}>
      {edgeLabels.map(edge=><div key={edge.id} style={{position:"absolute",pointerEvents:"none"}}><div style={{transform:"translate(-50%,-50%)"}}><button ref={el=>registerLabel(edgeElements.current,edge.id,el)} className={styles.edgeLabel3d} data-source={edge.source} data-target={edge.target} data-active={edge.id===activeEdge} data-displayed={edge.id===displayedEdge} data-relationship-id={edge.id} style={{visibility:"hidden",pointerEvents:edge.id===activeEdge?"auto":"none",opacity:isBackgroundEdge(edge) ? .18 : 1}} title={`${edge.from} ${edge.directional?"→":"↔"} ${edge.to}: ${relationshipSummary(edge,locale)}`} aria-label={`${edge.from} ${text(...(relationLabels[edge.type]??[edge.type,edge.type]))} ${edge.to}`} onClick={()=>onSelectEdge?.(edge.id)}>{edge.id===displayedEdge?<><strong>{edge.from} {edge.directional?'→':'↔'} {edge.to} · {text(...(relationLabels[edge.type]??[edge.type,edge.type]))}</strong><small>{relationshipSummary(edge,locale)}</small></>:text(...(relationLabels[edge.type]??[edge.type,edge.type]))}</button></div></div>)}
      {layout.nodes.filter(n=>!crowded || renderedSet.has(n.id) || n.id===selected || n.id===hovered).map(n=><div key={n.id} style={{position:"absolute",pointerEvents:"none"}}><div style={{transform:"translate(-50%,-50%)"}}><button ref={element=>registerLabel(labelElements.current,n.id,element)} className={styles.label3d} data-visible="false" aria-hidden="true" tabIndex={-1} data-company-id={n.id} aria-pressed={n.id===selected} data-company-focus={selected ? n.id===selected ? "selected" : connected.has(n.id) ? "connected" : "background" : undefined} data-sector-emphasis={sectorFocus ? sectorMembers.has(n.id) ? "member" : sectorConnected.has(n.id) ? "connected" : "dimmed" : undefined} data-highlighted={n.id===selected || n.id===hovered || edgeEndpoints.has(n.id)} style={{color:companySector(n).color}} title={[companyName(n,locale), countryName(n.country,locale), marketCapDescription(n.marketCap,locale)].filter(Boolean).join(" · ")} onPointerEnter={e => { if (e.pointerType === "mouse") setLabelHovered(n.id); }} onPointerLeave={() => setLabelHovered("")} onClick={() => onSelect(n.id)} aria-label={[companyName(n,locale), n.symbol, countryName(n.country,locale)].filter(Boolean).join(" · ")}><strong>{companyName(n,locale)}</strong>{n.id===selected&&<><span>{[n.symbol, graphNodeMarketCapLabel(n.marketCap, locale)].filter(Boolean).join(" · ")}</span><CompanyPriceChange price={n.dailyPrice} locale={locale}/></>}</button></div></div>)}
    </Html>
  </>;
}

function GraphUnavailable({onRetry}:{onRetry:()=>void}) {
  const { text } = useLocale();
  return <div role="alert" className={styles.empty}>{text("This browser cannot display the 3D graph. Open “Explore AI stocks, companies and the supply chain” below to continue researching.", "此浏览器暂时无法显示 3D 图谱。点击下方“探索 AI 公司与产业链”即可打开公司列表，继续研究。")} <button onClick={onRetry}>{text('Reload 3D','重新加载 3D')}</button></div>;
}
export default function CompanyGraph3D(props: Props) {
  const { text } = useLocale();
  const introOrbitRef = useRef(true);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [contextLost,setContextLost]=useState(false);
  const [pointerOverCanvas,setPointerOverCanvas]=useState(false);
  const [hoveringEntity,setHoveringEntity]=useState(false);
  const hoverHintTimer=useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideHoverHint=()=>{
    if(hoverHintTimer.current!==null)clearTimeout(hoverHintTimer.current);
    hoverHintTimer.current=null;
    setPointerOverCanvas(false);
  };
  const scheduleHoverHint=(event:ReactPointerEvent<HTMLDivElement>)=>{
    hideHoverHint();
    if(event.pointerType!=='mouse' || event.buttons!==0 || !(event.target instanceof HTMLCanvasElement))return;
    hoverHintTimer.current=setTimeout(()=>{hoverHintTimer.current=null;setPointerOverCanvas(true);},2000);
  };
  useEffect(()=>()=>{if(hoverHintTimer.current!==null)clearTimeout(hoverHintTimer.current);},[]);
  const [attempt,setAttempt]=useState(0);
  const retry=()=>{setContextLost(false);setSupported(null);setAttempt(value=>value+1);};
  const [wheelGateRef, wheelHint] = useWheelZoomGate();
  useEffect(() => {
    if (supported !== null) return;
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
  }, [attempt, supported]);
  const fallback = <GraphUnavailable onRetry={retry}/>;
  if (!supported) return <div className={styles.canvas3d}>
    {supported !== false ? <p role="status" className={styles.empty}><LoadingSpinner/>{text("Loading graph…", "正在加载图谱…")}</p> : fallback}
    {props.musicControls && <UniverseMusicToggle/>}
  </div>;
  return <div ref={wheelGateRef} className={styles.canvas3d} data-graph-interaction data-context-lost={contextLost}
    onPointerMoveCapture={scheduleHoverHint}
    onPointerLeave={hideHoverHint}
    onPointerDownCapture={hideHoverHint}
    onPointerUpCapture={scheduleHoverHint}
    onWheelCapture={hideHoverHint}>
    <WheelZoomHint hint={wheelHint}/>
    <RenderBoundary key={attempt} fallback={fallback}><Canvas onPointerMissed={event=>{if(event.type === "click" && event.target instanceof HTMLCanvasElement){props.onSelect("");props.onSelectEdge?.("");}}} frameloop={contextLost?'never':'demand'} dpr={[1,1.5]} camera={{ position:[0,0,1100], fov:45, near:1, far:100000 }} gl={{ antialias:true, powerPreference:"high-performance" }} raycaster={{params:{Points:{threshold:7},Mesh:{},Line:{threshold:4},LOD:{},Sprite:{}}}} fallback={fallback}><WebGLContextRecovery onLost={setContextLost}/><Scene {...props} light={false} introOrbitRef={introOrbitRef} onHoverChange={setHoveringEntity}/></Canvas></RenderBoundary>
    {contextLost&&<div className={styles.contextRecovery} role="status">{text('3D rendering was interrupted. Waiting for the browser to restore it.','3D 渲染暂时中断，正在等待浏览器恢复。')} <button onClick={retry}>{text('Reload 3D','重新加载 3D')}</button></div>}
    {props.musicControls && <UniverseMusicToggle/>}
    {!props.hideReset && <button className={styles.resetView} onClick={props.onReset}>{text("Reset view", "重置视图")}</button>}
    <p className={styles.canvasHint} data-hover-help data-visible={pointerOverCanvas&&!hoveringEntity&&!contextLost} aria-hidden={!pointerOverCanvas||hoveringEntity||contextLost}>{text("Drag: orbit · Right-drag: pan · Scroll / pinch: zoom", "拖动旋转 · 右键拖动平移 · 滚轮／双指缩放")}</p>
  </div>;
}
