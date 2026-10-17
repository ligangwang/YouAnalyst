"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { COMPARE_COLORS, returnLabel, type CompareData, type CompareStyle } from "@/lib/compare";
import { comparisonFrame } from "@/lib/compare-chart";
import { useLocale } from "./providers/locale-provider";
import styles from "./stock-compare.module.css";

type Props = { data: CompareData; progress: number; style: CompareStyle; highlighted: string | null };
export function StockComparisonChart({ data, progress, style, highlighted }: Props) {
  const { text } = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera; objects: (THREE.Line | THREE.Mesh)[] } | null>(null);
  const [width, setWidth] = useState(800), [failed, setFailed] = useState(false);
  const height = style === "bar" ? Math.max(360, data.series.length * 44 + 72) : 420;
  const frame = useMemo(() => comparisonFrame(data, progress, style, width, height), [data, progress, style, width, height]);

  useEffect(() => {
    const element = container.current!;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(300, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = container.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); }
    catch {
      let active = true;
      queueMicrotask(() => { if (active) setFailed(true); });
      return () => { active = false; };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute("aria-hidden", "true");
    element.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
    const objects = data.series.map((_, i) => {
      if (style === "bar") {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: COMPARE_COLORS[i], transparent: true }));
        scene.add(mesh); return mesh;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array((data.dates.length + 1) * 3), 3));
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: COMPARE_COLORS[i], transparent: true }));
      scene.add(line); return line;
    });
    sceneRef.current = { renderer, scene, camera, objects };
    const lost = (event: Event) => { event.preventDefault(); setFailed(true); };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      sceneRef.current = null;
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      objects.forEach(object => { object.geometry.dispose(); (object.material as THREE.Material).dispose(); });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [data, style]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    const { renderer, scene, camera, objects } = state;
    renderer.setSize(width, height);
    camera.right = width; camera.top = height; camera.updateProjectionMatrix();
    objects.forEach((object, i) => {
      (object.material as THREE.Material).opacity = highlighted && highlighted !== data.series[i].symbol ? .16 : 1;
      if (style === "bar") {
        const zero = frame.scale(0), end = frame.scale(frame.values[i]);
        object.position.set((zero + end) / 2, height - frame.labels[i].y, 0);
        object.scale.set(Math.max(1, Math.abs(end - zero)), Math.min(26, (frame.bottom - frame.top) / data.series.length * .6), 1);
      } else {
        const attribute = object.geometry.getAttribute("position") as THREE.BufferAttribute;
        for (let j = 0; j <= frame.index; j++) attribute.setXYZ(j, frame.left + j / (data.dates.length - 1) * (frame.right - frame.left), height - frame.scale(data.series[i].values[j]), 0);
        attribute.setXYZ(frame.index + 1, frame.left + progress * (frame.right - frame.left), height - frame.scale(frame.values[i]), 0);
        attribute.needsUpdate = true;
        object.geometry.setDrawRange(0, frame.index + 2);
        object.frustumCulled = false;
      }
    });
    renderer.render(scene, camera);
  }, [data, frame, height, highlighted, progress, style, width]);

  return <div className={styles.chart} ref={container} style={{ height }} role="img" aria-label={text("Animated stock price return comparison", "股票价格收益对比动画")}>
    <span aria-hidden="true" style={{ position: "absolute", top: 6, right: 12, zIndex: 3, pointerEvents: "none", userSelect: "none", color: "var(--text-secondary)", opacity: .55, fontSize: 12, fontWeight: 600, letterSpacing: ".04em" }}>YouAnalyst</span>
    {!failed && <div className={styles.grid} aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => {
        const value = frame.low + (frame.high - frame.low) * i / 4, position = frame.scale(value);
        return <div key={i} className={style === "bar" ? styles.verticalGrid : styles.horizontalGrid} style={style === "bar" ? { left: position, top: frame.top, height: frame.bottom - frame.top } : { top: position, left: frame.left, width: frame.right - frame.left }}><span>{value.toFixed(0)}%</span></div>;
      })}
      <div className={style === "bar" ? styles.zeroVertical : styles.zeroHorizontal} style={style === "bar" ? { left: frame.scale(0), top: frame.top, height: frame.bottom - frame.top } : { top: frame.scale(0), left: frame.left, width: frame.right - frame.left }} />
      {frame.labels.map(label => <div key={label.symbol} className={styles.endpoint} style={{ left: style === "bar" ? 8 : label.x, top: label.y, color: COMPARE_COLORS[label.i], opacity: highlighted && highlighted !== label.symbol ? .25 : 1 }}>
        <strong>{label.symbol.replace(/^(XSHG|XSHE):/, "")}</strong>
        <span style={style === "bar" ? { position: "absolute", left: frame.right + 2 - 8 } : undefined}>{returnLabel(label.value)}</span>
      </div>)}
      <span className={styles.startDate} style={{ left: frame.left }}>{data.dates[0]}</span>
      <span className={styles.endDate} style={{ right: width - frame.right }}>{data.dates.at(-1)}</span>
    </div>}
    {failed && <p className={styles.fallback} role="status">{text("Animation is unavailable in this browser. Returns are shown in the table below.", "此浏览器无法播放动画。收益数据见下表。")}</p>}
  </div>;
}
