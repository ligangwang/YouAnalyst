"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "./providers/locale-provider";
import styles from "./company-follow-star.module.css";

/** The caller owns saved state; feedback confirms a completed write only. */
export function CompanyFollowStar({ label, followed, disabled, onChange }: {
  label: string;
  followed: boolean;
  disabled?: boolean;
  onChange: (follow: boolean) => Promise<void>;
}) {
  const { text } = useLocale();
  const tooltipId = useId();
  const tooltip = useRef<HTMLSpanElement>(null);
  const [hintAnchor, setHintAnchor] = useState<{x:number;y:number} | null>(null);
  const [pending, setPending] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<"followed" | "unfollowed" | "error" | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = pending ?? followed;
  const action = active ? text(`Unfollow ${label}`, `取消关注 ${label}`) : text(`Follow ${label}`, `关注 ${label}`);

  useLayoutEffect(() => {
    const element = tooltip.current;
    if (!element || !hintAnchor) return;
    const {width, height} = element.getBoundingClientRect();
    const gap = 14, margin = 8;
    const x = hintAnchor.x + gap + width <= window.innerWidth - margin ? hintAnchor.x + gap : hintAnchor.x - gap - width;
    const y = hintAnchor.y + gap + height <= window.innerHeight - margin ? hintAnchor.y + gap : hintAnchor.y - gap - height;
    element.style.left = String(Math.max(margin, Math.min(x, window.innerWidth - width - margin))) + "px";
    element.style.top = String(Math.max(margin, Math.min(y, window.innerHeight - height - margin))) + "px";
  }, [hintAnchor, action, pending, notice]);

  useEffect(() => {
    const hideHint = () => setHintAnchor(null);
    window.addEventListener("resize", hideHint);
    window.addEventListener("scroll", hideHint, true);
    return () => { window.removeEventListener("resize", hideHint); window.removeEventListener("scroll", hideHint, true); };
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(timer.current); };
  }, []);

  async function toggle() {
    if (locked.current || disabled) return;
    locked.current = true;
    clearTimeout(timer.current);
    setNotice(null);
    const next = !followed;
    setPending(next);
    try {
      await onChange(next);
      if (!mounted.current) return;
      setNotice(next ? "followed" : "unfollowed");
      timer.current = setTimeout(() => setNotice(null), 2200);
    } catch {
      if (mounted.current) setNotice("error");
    } finally {
      locked.current = false;
      if (mounted.current) setPending(null);
    }
  }

  return <button type="button" className={styles.star} aria-label={action} aria-describedby={hintAnchor && pending === null && notice === null ? tooltipId : undefined}
    aria-pressed={active} aria-busy={pending !== null} disabled={disabled || pending !== null}
    onPointerEnter={event => { if (event.pointerType === "mouse") setHintAnchor({x:event.clientX,y:event.clientY}); }}
    onPointerMove={event => { if (event.pointerType === "mouse" && !event.buttons) setHintAnchor({x:event.clientX,y:event.clientY}); }}
    onPointerLeave={() => setHintAnchor(null)} onPointerDown={() => setHintAnchor(null)}
    onFocus={event => { const bounds = event.currentTarget.getBoundingClientRect(); setHintAnchor({x:bounds.right,y:bounds.bottom}); }}
    onBlur={() => setHintAnchor(null)} onKeyDown={event => { if (event.key === "Escape") setHintAnchor(null); }}
    data-feedback={notice !== null || pending !== null} onClick={() => void toggle()}>
    <span aria-hidden="true">{active ? "★" : "☆"}</span>
    {hintAnchor && pending === null && notice === null && createPortal(<span ref={tooltip} id={tooltipId} role="tooltip" className={styles.tooltip}>{action}</span>, document.body)}
    {notice && <span className={`${styles.notice} ${notice === "error" ? styles.error : styles.success}`}
      role={notice === "error" ? "alert" : "status"}>
      {notice === "error" ? text(`Could not save ${label}. Retry.`, `${label} 保存失败，请重试。`)
        : notice === "followed" ? text(`${label} followed`, `已关注 ${label}`) : text(`${label} unfollowed`, `已取消关注 ${label}`)}
    </span>}
  </button>;
}
