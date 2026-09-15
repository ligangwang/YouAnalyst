"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, Html } from "@react-three/drei";
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Color, Vector3, Quaternion, type Mesh } from "three";
import { companyName, type KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { layout3D } from "@/lib/knowledge-graph/layout-3d";
import { relationLabels } from "@/lib/knowledge-graph/relationship-labels";
import { companySector } from "@/lib/knowledge-graph/sectors";
import { useLocale } from "./providers/locale-provider";
import styles from "./ai-knowledge-graph.module.css";

type Props = { cameraRequest: number; sectorFocus?: string; onSelectSector?: (id: string) => void; highlightedEdges?: string[]; activeEdge?: string; onSelectEdge?: (id: string) => void; graph: KnowledgeGraph; selected: string; onSelect: (id: string) => void; reset: number; onReset: () => void };
class RenderBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
const vertex = `attribute vec3 tint; attribute float emphasis; varying vec3 vColor; varying float vEmphasis;
void main(){vColor=tint;vEmphasis=emphasis;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(32000./max(40.,-p.z),18.,72.)*(emphasis>1.?1.5:1.);}`;
const fragment = `varying vec3 vColor; varying float vEmphasis;
void main(){vec2 p=gl_PointCoord-.5;float r=length(p);float glow=exp(-r*9.)*.85;float core=1.-smoothstep(.04,.12,r);float rays=exp(-abs(p.x)*100.)*exp(-abs(p.y)*12.)+exp(-abs(p.y)*100.)*exp(-abs(p.x)*12.);float a=(glow+core+rays*.25)*min(1.,vEmphasis);if(a<.015)discard;gl_FragColor=vec4(mix(vColor,vec3(1.),core*.8),a);}`;

function Scene({ cameraRequest, graph, selected, onSelect, reset, activeEdge, highlightedEdges, onSelectEdge, sectorFocus = "", onSelectSector }: Props) {
  const { text, locale } = useLocale();
  const edgeElements = useRef(new Map<string, HTMLButtonElement>());
  const arrowElements = useRef(new Map<string, Mesh>());
  const sectorElements = useRef(new Map<string, HTMLButtonElement>());
  const layout = useMemo(() => layout3D(graph), [graph]);
  const controls = useRef<CameraControls>(null);
  const dragging = useRef(false);
  const cameraMoving = useRef(false);
  const lastInteraction = useRef(-Infinity);
  const labelPlacements = useRef(new WeakMap<HTMLElement, number>());
  const companyScales = useRef(new WeakMap<HTMLElement, number>());
  const reducedMotion = useRef(false);
  useEffect(()=>{
    const media=window.matchMedia("(prefers-reduced-motion: reduce)");
    const update=()=>{reducedMotion.current=media.matches;};
    update();media.addEventListener("change",update);
    return ()=>media.removeEventListener("change",update);
  },[]);
  const { size, camera, invalidate, gl } = useThree();
  const labelElements = useRef(new Map<string, HTMLButtonElement>());
  const projected = useMemo(() => new Vector3(), []);
  const [hovered, setHovered] = useState("");
  const [hoveredEdge, setHoveredEdge] = useState("");
  const displayedEdge=activeEdge||hoveredEdge;
  const edgeEndpoints=useMemo(()=>new Set(layout.edges.filter(e=>e.id===displayedEdge).flatMap(e=>[e.source,e.target])),[layout,displayedEdge]);
  const sectorMembers = useMemo(() => new Set(layout.nodes.filter(n => companySector(n).id === sectorFocus).map(n => n.id)), [layout, sectorFocus]);
  const sectorConnected = useMemo(() => new Set(layout.edges.filter(e => sectorMembers.has(e.source) || sectorMembers.has(e.target)).flatMap(e => [e.source, e.target])), [layout, sectorMembers]);
  const connected = useMemo(() => new Set(layout.edges.filter(e => e.source === selected || e.target === selected).flatMap(e => [e.source, e.target])), [layout, selected]);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(layout.nodes.flatMap(n => [n.x, n.y, n.z]), 3));
    g.setAttribute("tint", new Float32BufferAttribute(layout.nodes.flatMap(n => new Color(companySector(n).color).toArray()), 3));
    g.setAttribute("emphasis", new Float32BufferAttribute(layout.nodes.map(n => n.id === selected || n.id === hovered || edgeEndpoints.has(n.id) ? 2 : selected && !connected.has(n.id) ? .22 : sectorFocus ? sectorMembers.has(n.id) ? 2 : sectorConnected.has(n.id) ? .7 : .15 : 1), 1));
    return g;
  }, [layout, selected, hovered, connected, sectorFocus, sectorMembers, sectorConnected, edgeEndpoints]);
  const lines = useMemo(() => {
    const positions = new Map(layout.nodes.map(n => [n.id, n]));
    const g = new BufferGeometry(), p: number[] = [], c: number[] = [], edgeIds: string[] = [];
    layout.edges.forEach(e => {
      const a = positions.get(e.source)!, b = positions.get(e.target)!;
      const color = new Color(e.id === displayedEdge ? "#ffffff" : highlightedEdges?.includes(e.id) ? "#7ef4cb" : e.source === selected || e.target === selected ? "#9ee9ff" : selected ? "#14232e" : sectorFocus ? sectorMembers.has(e.source) || sectorMembers.has(e.target) ? "#9ee9ff" : "#101b25" : "#294557");
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
    if(previous?.layout===layout && previous.request===cameraRequest && previous.reset===reset)return;
    lastCameraRequest.current={layout,request:cameraRequest,reset};
    const n = layout.nodes.find(n => n.id === selected);
    const sector=sectors.find(s=>s.id===sectorFocus);
    const members=sector?layout.nodes.filter(n=>companySector(n).id===sector.id):[];
    const radius=sector?Math.max(80,...members.map(n=>Math.hypot(n.x-sector.x,n.y-sector.y,n.z-sector.z))):0;
    const d = n ? Math.max(150, layout.radius * .8) : sector ? radius / Math.sin(Math.atan(Math.tan(Math.PI/8)*Math.min(1,size.width/size.height))) * 1.1 : fitDistance;
    const x = n?.x ?? sector?.x ?? 0, y = n?.y ?? sector?.y ?? 0, z = n?.z ?? sector?.z ?? 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void c.setLookAt(x + d*.2, y + d*.12, z + d, x, y, z, !reduced);
    invalidate();
  }, [layout, selected, fitDistance, reset, invalidate, sectorFocus, sectors, size.width, size.height, cameraRequest]);
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
    // Keep each company label on the same side of its node throughout a gesture.
    // Continue briefly after release so collision placement resumes after damping settles.
    const settling = performance.now() - lastInteraction.current < 180;
    const holdLabels = dragging.current || cameraMoving.current || settling;
    if(settling && !dragging.current)invalidate();
    const occupied: {x:number;y:number;w:number;h:number}[]=[];
    const place=(element:HTMLElement, x:number,y:number,z:number, eligible:boolean, width:number,height:number, companyGap?:number) => {
      projected.set(x,y,z).project(camera);
      const px=(projected.x+1)*size.width/2,py=(1-projected.y)*size.height/2;
      const gap=companyGap??0;
      const offsets=companyGap!==undefined?[[0,height/2+gap],[0,-height/2-gap],[width/2+gap,0],[-width/2-gap,0],[width/2+gap,height/2+gap],[-width/2-gap,height/2+gap],[width/2+gap,-height/2-gap],[-width/2-gap,-height/2-gap]]:[[0,0]];
      const previous=companyGap!==undefined?labelPlacements.current.get(element):undefined;
      const ordered=previous!==undefined && previous>=0?[previous,...offsets.map((_,i)=>i).filter(i=>i!==previous)]:offsets.map((_,i)=>i);
      const inView=eligible && projected.z>-1 && projected.z<1;
      const choice=holdLabels && previous!==undefined?previous:ordered.find(i=>{
        const [dx,dy]=offsets[i];
        const cx=px+dx,cy=py+dy;
        return cx-width/2>2 && cx+width/2<size.width-2 && cy-height/2>2 && cy+height/2<size.height-32 && !occupied.some(p=>Math.abs(cx-p.x)<(width+p.w)/2+3 && Math.abs(cy-p.y)<(height+p.h)/2+2);
      });
      if(companyGap!==undefined && (!holdLabels || previous===undefined))labelPlacements.current.set(element,choice??-1);
      const offset=inView && choice!==undefined && choice>=0?offsets[choice]:undefined;
      const visible=Boolean(offset) && px>-width && px<size.width+width && py>-height && py<size.height+height;
      element.style.visibility=visible?"visible":"hidden";
      if(offset && visible){
        if(companyGap!==undefined){element.style.setProperty("--label-offset-x",`${offset[0]}px`);element.style.setProperty("--label-offset-y",`${offset[1]}px`);}
        occupied.push({x:px+offset[0],y:py+offset[1],w:width,h:height});
      }
      return visible;
    };
    const target=controls.current?.getTarget(new Vector3()) ?? new Vector3();
    const close=camera.position.distanceTo(target)<fitDistance*.68;
    const labelScale=(x:number,y:number,z:number)=>Math.max(.45,Math.min(1.15,fitDistance*.4/Math.max(1,Math.hypot(camera.position.x-x,camera.position.y-y,camera.position.z-z))));
    // Write all font sizes first, then measure the actual rendered labels in one batch.
    let scalesSettling=false;
    // Ease the actual font dimensions, so collision measurement follows what is rendered.
    const blend=1-Math.exp(-Math.min(delta,.05)/.12);
    for(const n of layout.nodes){
      const element=labelElements.current.get(n.id);if(!element)continue;
      const targetScale=n.id===selected||n.id===hovered?1.15:labelScale(n.x,n.y,n.z);
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
    const candidates=[...layout.nodes].sort((a,b)=>Number(b.id===selected||b.id===hovered)-Number(a.id===selected||a.id===hovered)||Number(edgeEndpoints.has(b.id))-Number(edgeEndpoints.has(a.id))||Number(sectorMembers.has(b.id))-Number(sectorMembers.has(a.id))||Number(connected.has(b.id))-Number(connected.has(a.id))||((close?((camera.position.x-a.x)**2+(camera.position.y-a.y)**2+(camera.position.z-a.z)**2)-((camera.position.x-b.x)**2+(camera.position.y-b.y)**2+(camera.position.z-b.z)**2):0))||(degree.get(b.id)??0)-(degree.get(a.id)??0));

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
      if(place(element,n.x,n.y,n.z,true,width,height,gap)){shown++;visibleCompanies.add(n.id);}
      if(shown===1&&!sectorsPlaced){placeEdges(true);placeEdges();placeSectors();sectorsPlaced=true;}
    }
    if(!sectorsPlaced)placeSectors();
    placeEdges(true);
    placeEdges();

  });
  return <>
    <CameraControls ref={controls} makeDefault minDistance={45} maxDistance={fitDistance*3} smoothTime={.25} onWake={()=>{cameraMoving.current=true;}} onRest={()=>{cameraMoving.current=false;invalidate();}} onSleep={()=>{cameraMoving.current=false;invalidate();}} onControlStart={()=>{dragging.current=true;lastInteraction.current=performance.now();}} onControl={()=>{lastInteraction.current=performance.now();}} onControlEnd={()=>{dragging.current=false;lastInteraction.current=performance.now();invalidate();}}/>
    <points geometry={geometry} onClick={e => { if (e.delta > 5) return; e.stopPropagation(); if (e.index !== undefined) onSelect(layout.nodes[e.index].id); }} onPointerMove={e => { e.stopPropagation(); if(e.index !== undefined) setHovered(layout.nodes[e.index].id); }} onPointerOut={() => setHovered("")}>
      <shaderMaterial vertexShader={vertex} fragmentShader={fragment} transparent depthWrite={false} blending={AdditiveBlending}/>
    </points>
    <lineSegments geometry={lines} onPointerMove={e=>{if(e.index===undefined||e.buttons)return;e.stopPropagation();setHoveredEdge(lines.userData.edgeIds[Math.floor(e.index/2)]??"");}} onPointerOut={()=>setHoveredEdge("")} onClick={e => { if (e.delta > 5 || e.index === undefined) return; const id = lines.userData.edgeIds[Math.floor(e.index / 2)]; if (id) { e.stopPropagation();setHoveredEdge("");onSelectEdge?.(id); } }}><lineBasicMaterial vertexColors transparent opacity={.8}/></lineSegments>
    {sectors.map(sector=><Html key={sector.id} position={[sector.x,sector.y,sector.z]} center style={{pointerEvents:"none"}}><button aria-label={`${text("Focus sector", "聚焦产业")}: ${text(sector.en,sector.zh)}`} aria-pressed={sectorFocus===sector.id} onClick={()=>onSelectSector?.(sector.id)} ref={el=>{if(el){sectorElements.current.set(sector.id,el);invalidate();}else sectorElements.current.delete(sector.id);}} className={styles.sector3d} style={{color:sector.color,visibility:"hidden",pointerEvents:"auto"}}><span className={styles.sectorName}>{text(sector.en,sector.zh)}</span></button></Html>)}
    {edgeLabels.map(edge=><group key={edge.id}>
      {edge.directional && <mesh ref={el=>{if(el)arrowElements.current.set(edge.id,el);else arrowElements.current.delete(edge.id);}} position={edge.arrow} quaternion={edge.rotation} visible={false}><coneGeometry args={[.8,3.5,8]}/><meshBasicMaterial color="#a8e8ef" transparent opacity={.8}/></mesh>}
      <Html key={`${edge.id}:${edge.id===activeEdge}`} position={[edge.x,edge.y,edge.z]} calculatePosition={edge.id===displayedEdge?()=>activeLabelPosition(edge):undefined} onOcclude={edge.id===displayedEdge?()=>{}:undefined} center zIndexRange={edge.id===displayedEdge?[25,24]:[19,0]} style={{pointerEvents:"none"}}><button ref={el=>{if(el){edgeElements.current.set(edge.id,el);invalidate();}else edgeElements.current.delete(edge.id);}} className={styles.edgeLabel3d} data-source={edge.source} data-target={edge.target} data-active={edge.id===activeEdge} style={{visibility:"hidden",pointerEvents:edge.id===activeEdge?"auto":"none"}} title={`${edge.from} ${edge.directional?"→":"↔"} ${edge.to}: ${edge.summary}`} aria-label={`${edge.from} ${text(...(relationLabels[edge.type]??[edge.type,edge.type]))} ${edge.to}`} onClick={()=>onSelectEdge?.(edge.id)}>{text(...(relationLabels[edge.type]??[edge.type,edge.type]))}</button></Html>
    </group>)}
    {layout.nodes.map(n => <Html key={n.id} position={[n.x,n.y,n.z]} center zIndexRange={[20,0]} style={{pointerEvents:"none"}}><button ref={element => { if(element) { labelElements.current.set(n.id,element); invalidate(); } else labelElements.current.delete(n.id); }} className={styles.label3d} data-company-id={n.id} data-sector-emphasis={sectorFocus ? sectorMembers.has(n.id) ? "member" : sectorConnected.has(n.id) ? "connected" : "dimmed" : undefined} data-highlighted={n.id===selected || n.id===hovered || edgeEndpoints.has(n.id)} style={{pointerEvents:"auto",visibility:"hidden",color:companySector(n).color}} title={companyName(n,locale)} onClick={() => onSelect(n.id)} aria-label={`${companyName(n,locale)} · ${n.symbol}`}><strong>{companyName(n,locale)}</strong><span>{n.symbol}</span></button></Html>)}
  </>;
}

export default function CompanyGraph3D(props: Props) {
  const { text } = useLocale();
  const [supported, setSupported] = useState<boolean | null>(null);
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
  const fallback = <div role="alert" className={styles.empty}>{text("This browser cannot display the graph. Try enabling graphics acceleration or using another browser.", "此浏览器暂时无法显示图谱。请尝试开启图形加速或使用其他浏览器。")}</div>;
  if (supported === null) return <p role="status" className={styles.empty}>{text("Loading graph…", "正在加载图谱…")}</p>;
  if (!supported) return fallback;
  return <div className={styles.canvas3d}>
    <RenderBoundary fallback={fallback}><Canvas onPointerMissed={event=>{if(event.target instanceof HTMLCanvasElement)props.onSelectEdge?.("");}} frameloop="demand" dpr={[1,1.5]} camera={{ position:[0,0,1100], fov:45, near:1, far:10000 }} gl={{ antialias:false, powerPreference:"high-performance" }} raycaster={{params:{Points:{threshold:7},Mesh:{},Line:{threshold:4},LOD:{},Sprite:{}}}} fallback={fallback} onCreated={({gl}) => { gl.domElement.addEventListener("webglcontextlost", () => setSupported(false), {once:true}); }}><Scene {...props}/></Canvas></RenderBoundary>
    <button className={styles.resetView} onClick={props.onReset}>{text("Reset view", "重置视图")}</button>
    <p className={styles.canvasHint}>{text("Drag: orbit · Right-drag: pan · Scroll / pinch: zoom", "拖动旋转 · 右键拖动平移 · 滚轮／双指缩放")}</p>
  </div>;
}
