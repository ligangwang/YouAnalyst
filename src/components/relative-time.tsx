"use client";

import { useState, useSyncExternalStore } from "react";
import { formatAbsoluteDateTime, formatRelativeDateTime } from "@/lib/time";
import styles from "./relative-time.module.css";

let now = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
function update() {
  if (document.hidden) return;
  now = Date.now();
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    now = Date.now();
    timer = setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    }
  };
}
const snapshot = () => now;
// Server and first hydration render agree; the browser clock takes over afterward.
const serverSnapshot = () => 0;

/** All mounted timestamps share one local timer; no requests are made. */
export function RelativeTime({ value, prefix }: { value: string; prefix?: string }) {
  const currentTime = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [expanded, setExpanded] = useState(false);
  const exact = formatAbsoluteDateTime(value);
  return <span className={styles.timestamp}>
    <button type="button" title={exact} aria-label={`${prefix ? `${prefix}: ` : ""}${exact}`} aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)} onBlur={() => setExpanded(false)} onKeyDown={event => { if (event.key === "Escape") setExpanded(false); }}>
      {prefix && <span>{prefix} </span>}<time dateTime={Number.isFinite(Date.parse(value)) ? value : undefined}>{currentTime ? formatRelativeDateTime(value, currentTime) : "…"}</time>
    </button>
    {expanded && <span className={styles.exact}>{exact}</span>}
  </span>;
}
