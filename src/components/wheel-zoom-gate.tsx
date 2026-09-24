"use client";

import { useEffect, useState } from "react";
import { useLocale } from "./providers/locale-provider";
import styles from "./wheel-zoom-gate.module.css";

type Hint = { key: "" | "ctrl" | "cmd"; top: number };
const HIDDEN: Hint = { key: "", top: 0 };
// A plain mouse wheel over a 3D canvas scrolls the page, so tall canvases never trap it.
// Ctrl/Cmd + wheel, and trackpad pinches (which browsers report as ctrl + wheel), zoom the
// camera instead. Touch gestures are not wheel events and are unaffected.
const forwarded = new WeakSet<Event>();
// Returns a callback ref for the canvas container and the hint to show.
export function useWheelZoomGate() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [hint, setHint] = useState<Hint>(HIDDEN);
  useEffect(() => {
    if (!element) return;
    let timer: number | undefined;
    const onWheel = (event: WheelEvent) => {
      if (forwarded.has(event)) return;
      // Scrollable panels inside the canvas (the company card) keep their own wheel scrolling.
      if (event.target instanceof Element && event.target.closest("[role='dialog']")) return;
      // Stop the event before the camera controls see it.
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) {
        // Camera controls treat ctrl + wheel as a lens zoom, which neither rescales the labels nor
        // is undone by Reset view. Forward it as a plain wheel, which moves the camera closer,
        // and keep the browser from zooming the page.
        event.preventDefault();
        const plain = new WheelEvent("wheel", { deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ, deltaMode: event.deltaMode, clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY, bubbles: true, cancelable: true, composed: true });
        forwarded.add(plain);
        event.target?.dispatchEvent(plain);
        return;
      }
      // The browser still scrolls the page.
      // Canvases can be taller than the screen: show the hint where the pointer is.
      const top = Math.max(64, event.clientY - element.getBoundingClientRect().top);
      setHint({ key: /Mac|iPhone|iPad/.test(navigator.platform) ? "cmd" : "ctrl", top });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setHint(current => ({ ...current, key: "" })), 1600);
    };
    element.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => { element.removeEventListener("wheel", onWheel, { capture: true }); window.clearTimeout(timer); };
  }, [element]);
  return [setElement, hint] as const;
}

export function WheelZoomHint({ hint }: { hint: Hint }) {
  const { text } = useLocale();
  return <p className={styles.hint} style={{ top: hint.top || undefined }} data-visible={Boolean(hint.key)} aria-hidden={!hint.key} data-wheel-zoom-hint>
    {hint.key === "cmd" ? text("⌘ + scroll to zoom", "按住 ⌘ 并滚动以缩放") : text("Ctrl + scroll to zoom", "按住 Ctrl 并滚动以缩放")}
  </p>;
}
