"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { COMPARE_COLORS, returnLabel, type CompareData, type CompareStyle } from "@/lib/compare";
import { comparisonFrame } from "@/lib/compare-chart";
import { useLocale } from "./providers/locale-provider";
import styles from "./stock-compare.module.css";

type Props = { data: CompareData; progress: number; style: CompareStyle; highlighted: string | null; colors?: string[]; onUnavailable?: () => void };
export function StockComparisonChart({ data, progress, style, highlighted, colors = COMPARE_COLORS, onUnavailable }: Props) {
  const { text } = useLocale();
  const descriptionId = useId();
  const container = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera; objects: (Line2 | THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>)[] } | null>(null);
  const [width, setWidth] = useState(800), [failed, setFailed] = useState(false);
  const height = style === "bar" ? Math.max(360, data.series.length * 44 + 72) : 420;
  const frame = useMemo(() => comparisonFrame(data, progress, style, width, height), [data, progress, style, width, height]);

  useEffect(() => {
    const element = container.current!;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { if (failed) onUnavailable?.(); }, [failed, onUnavailable]);

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
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.domElement.setAttribute("aria-hidden", "true");
    element.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
    const objects = data.series.map((_, i) => {
      if (style === "bar") {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: colors[i], transparent: true, toneMapped: false }));
        scene.add(mesh); return mesh;
      }
      const geometry = new LineGeometry();
      geometry.setPositions(new Float32Array((data.dates.length + 1) * 3));
      // Native WebGL lines stay one device pixel wide. Screen-space lines keep
      // an opaque color core matching the picker even on high-DPI displays.
      const line = new Line2(geometry, new LineMaterial({ color: colors[i], linewidth: 3, transparent: true, toneMapped: false }));
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
  }, [data, style, colors]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    const { renderer, scene, camera, objects } = state;
    renderer.setSize(width, height);
    camera.right = width; camera.top = height; camera.updateProjectionMatrix();
    objects.forEach((object, i) => {
      (object.material as THREE.Material).opacity = highlighted && highlighted !== data.series[i].symbol ? .16 : 1;
      if (!(object instanceof Line2)) {
        const zero = frame.scale(0), end = frame.scale(frame.values[i]);
        object.position.set((zero + end) / 2, height - frame.labels[i].y, 0);
        object.scale.set(Math.max(1, Math.abs(end - zero)), Math.min(26, (frame.bottom - frame.top) / data.series.length * .6), 1);
      } else {
        const start = object.geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute;
        const end = object.geometry.getAttribute("instanceEnd") as THREE.InterleavedBufferAttribute;
        for (let j = 0; j <= frame.index; j++) {
          start.setXYZ(j, frame.left + j / (data.dates.length - 1) * (frame.right - frame.left), height - frame.scale(data.series[i].values[j]), 0);
          if (j < frame.index) end.setXYZ(j, frame.left + (j + 1) / (data.dates.length - 1) * (frame.right - frame.left), height - frame.scale(data.series[i].values[j + 1]), 0);
          else end.setXYZ(j, frame.left + progress * (frame.right - frame.left), height - frame.scale(frame.values[i]), 0);
        }
        start.data.needsUpdate = true;
        object.geometry.instanceCount = frame.index + 1;
        object.material.resolution.set(width, height);
        object.frustumCulled = false;
      }
    });
    renderer.render(scene, camera);
  }, [data, frame, height, highlighted, progress, style, width, colors]);

  return <div className={styles.chart} ref={container} style={{ height }} role="img" aria-label={text("Animated stock price return comparison", "股票价格收益对比动画")} aria-describedby={descriptionId}>
    <span id={descriptionId} className="sr-only">{text("Price returns", "价格收益")} · {data.dates[frame.index]}{frame.fraction > 0 ? text(" (interpolated)", "（插值）") : ""} · {data.series.map((series, i) => `${series.symbol}: ${returnLabel(frame.values[i])}`).join(" · ")}</span>
    <span aria-hidden="true" className={styles.watermark} data-testid="chart-watermark">YouAnalyst</span>
    {!failed && <div className={styles.grid} aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => {
        const value = frame.low + (frame.high - frame.low) * i / 4, position = frame.scale(value);
        return <div key={i} className={style === "bar" ? styles.verticalGrid : styles.horizontalGrid} style={style === "bar" ? { left: position, top: frame.top, height: frame.bottom - frame.top } : { top: position, left: frame.left, width: frame.right - frame.left }}><span>{value.toFixed(0)}%</span></div>;
      })}
      <div className={style === "bar" ? styles.zeroVertical : styles.zeroHorizontal} style={style === "bar" ? { left: frame.scale(0), top: frame.top, height: frame.bottom - frame.top } : { top: frame.scale(0), left: frame.left, width: frame.right - frame.left }} />
      {frame.labels.map(label => <div key={label.symbol} className={styles.endpoint} style={{ left: style === "bar" ? 8 : label.x, top: label.y, color: colors[label.i], opacity: highlighted && highlighted !== label.symbol ? .25 : 1 }}>
        <strong>{label.symbol.replace(/^(XSHG|XSHE):/, "")}</strong>
        <span style={style === "bar" ? { position: "absolute", left: frame.right + 2 - 8 } : undefined}>{returnLabel(label.value)}</span>
      </div>)}
      <span className={styles.startDate} style={{ left: frame.left }}>{data.dates[0]}</span>
      <span className={styles.endDate} style={{ right: width - frame.right }}>{data.dates.at(-1)}</span>
    </div>}
    {failed && <p className={styles.fallback} role="status">{text("Animation is unavailable in this browser. Returns are shown in the table below.", "此浏览器无法播放动画。收益数据见下表。")}</p>}
  </div>;
}
