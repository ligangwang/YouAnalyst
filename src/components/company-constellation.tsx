"use client";

import { useId, useMemo, useRef, useState, useEffect, type CSSProperties } from "react";
import type { KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { layoutCompanies } from "@/lib/knowledge-graph/constellation";
import { useLocale } from "./providers/locale-provider";
import styles from "./ai-knowledge-graph.module.css";

const stars = Array.from({ length: 110 }, (_, i) => ({ x: (i * 73.137 + 9) % 100, y: (i * 37.731 + 3) % 100, opacity: .12 + i % 5 * .09 }));
export function CompanyConstellation({ graph, selected, onSelect, zoom, rotation, onRotate }: {
  graph: KnowledgeGraph; selected: string; onSelect: (id: string) => void; zoom: number; rotation: number; onRotate: (degrees: number) => void;
}) {
  const { text } = useLocale();
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const moved = useRef(false);
  const [size, setSize] = useState({ width: 900, height: 620 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const marker = useId().replace(/:/g, "");
  const layout = useMemo(() => layoutCompanies(graph), [graph]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const scaleX = (size.width - 110) / layout.width * zoom / 100;
  const scaleY = (size.height - 100) / layout.height * zoom / 100;
  const radians = rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const width = size.width - 110, height = size.height - 100;
  const fit = Math.min(width / (Math.abs(width * cos) + Math.abs(height * sin)), height / (Math.abs(width * sin) + Math.abs(height * cos)));
  // Rotate positions, not DOM elements: labels stay upright and edges stay attached.
  const nodes = layout.nodes.map(n => {
    const x = (n.x - layout.width / 2) * scaleX, y = (n.y - layout.height / 2) * scaleY;
    return { ...n, x: (x * cos - y * sin) * fit + size.width / 2 + pan.x, y: (x * sin + y * cos) * fit + size.height / 2 + pan.y, radius: Math.min(19, 3.5 + Math.sqrt(n.degree) * 3.5) };
  });
  const positions = new Map(nodes.map(n => [n.id, n]));
  const connected = new Set(layout.edges.filter(e => e.source === selected || e.target === selected).flatMap(e => [e.source, e.target]));
  // Keep labels at a readable screen size; suppress collisions instead of shrinking text.
  const labels = new Set<string>(), boxes: { x: number; y: number }[] = [];
  [...nodes].sort((a, b) => Number(b.id === selected) - Number(a.id === selected) || Number(connected.has(b.id)) - Number(connected.has(a.id)) || b.degree - a.degree).forEach(n => {
    if (n.x < 54 || n.x > size.width - 54 || n.y < 20 || n.y > size.height - 48) return;
    if (boxes.some(p => Math.abs(p.x - n.x) < 111 && Math.abs(p.y - n.y) < 55)) return;
    if (n.id !== selected && n.degree < 3 && nodes.some(p => p.id !== n.id && Math.abs(p.x - n.x) < 57 && p.y > n.y + n.radius + 2 && p.y < n.y + n.radius + 42)) return;
    boxes.push(n); labels.add(n.id);
  });
  return <div ref={host} className={styles.canvas} tabIndex={0} role="region" aria-label={text("Company graph; drag to pan, arrow keys to move, Home to center", "公司图谱；拖动或方向键移动，Home 键居中")}
    onKeyDown={e => { if (e.target !== e.currentTarget) return; const moves: Record<string, [number, number]> = { ArrowLeft: [45, 0], ArrowRight: [-45, 0], ArrowUp: [0, 45], ArrowDown: [0, -45] }; if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); onRotate(e.key === "ArrowLeft" ? -15 : 15); } else if (moves[e.key]) { e.preventDefault(); const [x, y] = moves[e.key]; setPan(p => ({ x: p.x + x, y: p.y + y })); } else if (e.key === "Home") { e.preventDefault(); setPan({ x: 0, y: 0 }); onRotate(-rotation); } }}
    onClickCapture={e => { if (!e.detail) return; if (moved.current) { e.stopPropagation(); return; } const bounds = e.currentTarget.getBoundingClientRect(); const nearest = nodes.map(n => ({ n, distance: Math.hypot(n.x - (e.clientX - bounds.left), n.y - (e.clientY - bounds.top)) })).sort((a, b) => a.distance - b.distance)[0]; if (nearest && nearest.distance < 28) { e.stopPropagation(); onSelect(nearest.n.id); } }}
    onPointerDown={e => { moved.current = false; if ((e.target as HTMLElement).closest("button") || e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={e => { if (drag.current) { if (Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y) > 5) moved.current = true; setPan({ x: drag.current.panX + e.clientX - drag.current.x, y: drag.current.panY + e.clientY - drag.current.y }); } }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
    <div className={styles.stars} aria-hidden="true">{stars.map((s, i) => <i key={i} style={{ left: `${s.x}%`, top: `${s.y}%`, opacity: s.opacity, width: i % 13 ? 1 : 2, height: i % 13 ? 1 : 2 }} />)}</div>
    <svg className={styles.edges} width={size.width} height={size.height} aria-label={text("Company relationships", "公司关系")}>
      <defs><marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#89c9da" /></marker></defs>
      {layout.edges.map(e => {
        const a = positions.get(e.source)!, b = positions.get(e.target)!;
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.max(1, Math.hypot(dx, dy)), ux = dx / length, uy = dy / length;
        const ax = a.x + ux * (a.radius + 3), ay = a.y + uy * (a.radius + 3), bx = b.x - ux * (b.radius + 7), by = b.y - uy * (b.radius + 7);
        const active = e.source === selected || e.target === selected;
        return <path key={e.id} data-company-edge={e.id} data-source={e.source} data-target={e.target} d={`M${ax},${ay} Q${(ax + bx) / 2 - uy * 18},${(ay + by) / 2 + ux * 18} ${bx},${by}`} fill="none" stroke="#89c9da" strokeWidth={active ? 1.6 : 1} opacity={active ? .9 : selected ? .09 : .32} strokeDasharray={e.commercialStatus === "ANNOUNCED" ? "4 5" : undefined} markerEnd={active ? `url(#${marker})` : undefined} />;
      })}
    </svg>
    {nodes.map(n => <button key={n.id} type="button" data-company-node={n.id} className={`${styles.node} ${n.market === "US" ? styles.usNode : styles.chinaNode} ${labels.has(n.id) ? styles.labeled : ""} ${selected && n.id !== selected && !connected.has(n.id) ? styles.dim : ""}`} style={{ left: n.x, top: n.y, "--radius": `${n.radius}px` } as CSSProperties} aria-label={`${n.name} · ${n.symbol} · ${n.market === "US" ? text("US", "美股") : text("A-share", "A 股")}`} aria-pressed={selected === n.id} onClick={() => onSelect(n.id)} onFocus={() => { if (n.x < 55 || n.x > size.width - 55 || n.y < 35 || n.y > size.height - 65) setPan(p => ({ x: p.x + size.width / 2 - n.x, y: p.y + size.height / 2 - n.y })); }}>
      <i className={styles.planet} aria-hidden="true" /><span className={styles.nodeLabel}><strong>{n.name}</strong><span>{n.symbol} · {n.market === "US" ? text("US", "美股") : text("A-share", "A 股")}</span></span>
    </button>)}
    <p className={styles.canvasHint}>{text("Select a company · Drag to explore", "点选公司 · 拖动探索")}</p>
  </div>;
}
