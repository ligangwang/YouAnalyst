"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, Html } from "@react-three/drei";
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Color, Vector3 } from "three";
import type { KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { layout3D } from "@/lib/knowledge-graph/layout-3d";
import { companySector } from "@/lib/knowledge-graph/sectors";
import { useLocale } from "./providers/locale-provider";
import styles from "./ai-knowledge-graph.module.css";

type Props = { graph: KnowledgeGraph; selected: string; onSelect: (id: string) => void; zoom: number; rotation: number; reset: number; onFallback: () => void };
class RenderBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
const vertex = `attribute vec3 tint; attribute float emphasis; varying vec3 vColor; varying float vEmphasis;
void main(){vColor=tint;vEmphasis=emphasis;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(32000./max(40.,-p.z),18.,72.)*(emphasis>1.?1.5:1.);}`;
const fragment = `varying vec3 vColor; varying float vEmphasis;
void main(){vec2 p=gl_PointCoord-.5;float r=length(p);float glow=exp(-r*9.)*.85;float core=1.-smoothstep(.04,.12,r);float rays=exp(-abs(p.x)*100.)*exp(-abs(p.y)*12.)+exp(-abs(p.y)*100.)*exp(-abs(p.x)*12.);float a=(glow+core+rays*.25)*min(1.,vEmphasis);if(a<.015)discard;gl_FragColor=vec4(mix(vColor,vec3(1.),core*.8),a);}`;

function Scene({ graph, selected, onSelect, zoom, rotation, reset }: Props) {
  const { text } = useLocale();
  const layout = useMemo(() => layout3D(graph), [graph]);
  const controls = useRef<CameraControls>(null);
  const { size, camera, invalidate } = useThree();
  const labelElements = useRef(new Map<string, HTMLButtonElement>());
  const projected = useMemo(() => new Vector3(), []);
  const [hovered, setHovered] = useState("");
  const connected = useMemo(() => new Set(layout.edges.filter(e => e.source === selected || e.target === selected).flatMap(e => [e.source, e.target])), [layout, selected]);
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(layout.nodes.flatMap(n => [n.x, n.y, n.z]), 3));
    g.setAttribute("tint", new Float32BufferAttribute(layout.nodes.flatMap(n => new Color(companySector(n).color).toArray()), 3));
    g.setAttribute("emphasis", new Float32BufferAttribute(layout.nodes.map(n => n.id === selected || n.id === hovered ? 2 : selected && !connected.has(n.id) ? .22 : 1), 1));
    return g;
  }, [layout, selected, hovered, connected]);
  const lines = useMemo(() => {
    const positions = new Map(layout.nodes.map(n => [n.id, n]));
    const g = new BufferGeometry(), p: number[] = [], c: number[] = [];
    layout.edges.forEach(e => {
      const a = positions.get(e.source)!, b = positions.get(e.target)!;
      const color = new Color(e.source === selected || e.target === selected ? "#9ee9ff" : selected ? "#14232e" : "#294557");
      const parts = e.commercialStatus === "ANNOUNCED" ? 16 : 1;
      for (let i = 0; i < parts; i++) {
        if (parts > 1 && i % 2) continue;
        for (const t of [i / parts, (i + 1) / parts]) { p.push(a.x + (b.x-a.x)*t, a.y+(b.y-a.y)*t, a.z+(b.z-a.z)*t); c.push(...color.toArray()); }
      }
    });
    g.setAttribute("position", new Float32BufferAttribute(p, 3)); g.setAttribute("color", new Float32BufferAttribute(c, 3)); return g;
  }, [layout, selected]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => lines.dispose(), [lines]);
  const fitDistance = layout.radius / Math.sin(Math.atan(Math.tan(Math.PI / 8) * Math.min(1, size.width / size.height))) * 1.15;
  useEffect(() => {
    const c = controls.current; if (!c) return;
    const n = layout.nodes.find(n => n.id === selected);
    const d = n ? Math.max(150, layout.radius * .8) : fitDistance;
    const x = n?.x ?? 0, y = n?.y ?? 0, z = n?.z ?? 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void c.setLookAt(x + d*.2, y + d*.12, z + d, x, y, z, !reduced);
    invalidate();
  }, [layout, selected, fitDistance, reset, invalidate]);
  const previous = useRef({ zoom: 100, rotation: 0, reset });
  useEffect(() => {
    const c = controls.current; if (!c) return;
    if (reset !== previous.current.reset) { previous.current = { zoom, rotation, reset }; return; }
    if (zoom !== previous.current.zoom) void c.dollyTo(c.distance * previous.current.zoom / zoom, true);
    if (rotation !== previous.current.rotation) void c.rotate((rotation - previous.current.rotation) * Math.PI / 180, 0, true);
    previous.current = { zoom, rotation, reset }; invalidate();
  }, [zoom, rotation, reset, invalidate]);
  const labels = useMemo(() => {
    const degree = new Map<string, number>(); layout.edges.forEach(e => { degree.set(e.source, (degree.get(e.source) ?? 0)+1); degree.set(e.target,(degree.get(e.target) ?? 0)+1); });
    return [...layout.nodes].sort((a,b) => Number(b.id === selected || b.id === hovered)-Number(a.id === selected || a.id === hovered) || Number(connected.has(b.id))-Number(connected.has(a.id)) || (degree.get(b.id) ?? 0)-(degree.get(a.id) ?? 0)).slice(0, size.width < 600 ? 12 : 28);
  }, [layout, selected, hovered, connected, size.width]);
  useFrame(() => {
    const occupied: {x:number;y:number}[] = [];
    for (const n of labels) {
      const element = labelElements.current.get(n.id); if (!element) continue;
      projected.set(n.x,n.y,n.z).project(camera);
      const x = (projected.x+1)*size.width/2, y = (1-projected.y)*size.height/2;
      const important = n.id === selected || n.id === hovered;
      const visible = projected.z < 1 && projected.z > -1 && x > 40 && x < size.width-40 && y > 60 && y < size.height-50 && (important || !occupied.some(p => Math.abs(x-p.x)<120 && Math.abs(y-p.y)<55));
      element.style.visibility = visible ? "visible" : "hidden";
      if (visible) occupied.push({x,y});
    }
  });
  return <>
    <CameraControls ref={controls} makeDefault minDistance={45} maxDistance={fitDistance*3} smoothTime={.25}/>
    <points geometry={geometry} onClick={e => { if (e.delta > 5) return; e.stopPropagation(); if (e.index !== undefined) onSelect(layout.nodes[e.index].id); }} onPointerMove={e => { e.stopPropagation(); if(e.index !== undefined) setHovered(layout.nodes[e.index].id); }} onPointerOut={() => setHovered("")}>
      <shaderMaterial vertexShader={vertex} fragmentShader={fragment} transparent depthWrite={false} blending={AdditiveBlending}/>
    </points>
    <lineSegments geometry={lines}><lineBasicMaterial vertexColors transparent opacity={.8}/></lineSegments>
    {labels.map(n => <Html key={n.id} position={[n.x,n.y,n.z]} center zIndexRange={[20,0]} style={{pointerEvents:"none"}}><button ref={element => { if(element) labelElements.current.set(n.id,element); else labelElements.current.delete(n.id); }} className={styles.label3d} style={{pointerEvents:"auto"}} onClick={() => onSelect(n.id)} aria-label={`${n.name} · ${n.symbol}`}><strong>{n.symbol}</strong><span>{n.name}</span></button></Html>)}
    <Html fullscreen style={{pointerEvents:"none"}}><span className={styles.mode3d}>{text("3D · Drag to orbit", "3D · 拖动旋转视角")}</span></Html>
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
  const fallback = <div role="alert" className={styles.empty}>{text("3D is unavailable on this device.", "此设备暂时无法显示 3D。")} <button onClick={props.onFallback}>{text("Open 2D map", "打开 2D 图谱")}</button></div>;
  if (supported === null) return <p role="status" className={styles.empty}>{text("Loading 3D…", "正在加载 3D…")}</p>;
  if (!supported) return fallback;
  return <div className={styles.canvas3d}>
    <RenderBoundary fallback={fallback}><Canvas frameloop="demand" dpr={[1,1.5]} camera={{ position:[0,0,1100], fov:45, near:1, far:10000 }} gl={{ antialias:false, powerPreference:"high-performance" }} raycaster={{params:{Points:{threshold:7},Mesh:{},Line:{threshold:1},LOD:{},Sprite:{}}}} fallback={fallback} onCreated={({gl}) => { gl.domElement.addEventListener("webglcontextlost", props.onFallback, {once:true}); }}><Scene {...props}/></Canvas></RenderBoundary>
    <label className={styles.companyPicker}>{text("Focus company", "聚焦公司")}<select aria-label={text("Focus company", "聚焦公司")} value={props.selected} onChange={e=>props.onSelect(e.target.value)}><option value="">{text("All companies", "全部公司")}</option>{props.graph.nodes.filter(n=>n.kind==="COMPANY").map(n=><option key={n.id} value={n.id}>{n.name} · {n.symbol}</option>)}</select></label>
    <p className={styles.canvasHint}>{text("Drag: orbit · Right-drag: pan · Scroll / pinch: zoom", "拖动旋转 · 右键拖动平移 · 滚轮／双指缩放")}</p>
  </div>;
}
