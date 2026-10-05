"use client";

import { useState, useSyncExternalStore } from "react";
import { formatAbsoluteDateTime, formatRelativeDateTime } from "@/lib/time";
import styles from "./relative-time.module.css";
import { useLocale } from "./providers/locale-provider";
import { translateUi } from "@/lib/i18n/translate";

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
export function RelativeTime({ value, prefix, interactive = true }: { value: string; prefix?: string; interactive?: boolean }) {
  const { locale, chinese } = useLocale();
  const currentTime = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [expanded, setExpanded] = useState(false);
  const valid = Number.isFinite(Date.parse(value));
  const exact = chinese ? valid ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }).format(new Date(value)) + " UTC" : "时间不可用" : formatAbsoluteDateTime(value);
  const translatedPrefix = prefix ? translateUi(prefix, locale) : "";
  const compact = currentTime ? formatRelativeDateTime(value, currentTime, locale) : "…";
  // Event cards already have a button: keep their timestamp semantic without nesting controls.
  if (!interactive) return <time dateTime={valid ? value : undefined} title={exact}>{compact}</time>;
  return <span className={styles.timestamp}>
    <button type="button" title={exact} aria-label={`${translatedPrefix ? `${translatedPrefix}: ` : ""}${exact}`} aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)} onBlur={() => setExpanded(false)} onKeyDown={event => { if (event.key === "Escape") setExpanded(false); }}>
      {translatedPrefix && <span>{translatedPrefix} </span>}<time dateTime={valid ? value : undefined}>{compact}</time>
    </button>
    {expanded && <span className={styles.exact}>{exact}</span>}
  </span>;
}
