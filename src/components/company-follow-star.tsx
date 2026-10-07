"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "./providers/locale-provider";
import styles from "./company-follow-star.module.css";

export type FollowFeedbackAnchor = {x:number;y:number};

/** The caller owns saved state; feedback confirms a completed write only. */
export function CompanyFollowStar({ label, followed, disabled, onChange, confirmation = true }: {
  label: string;
  followed: boolean;
  disabled?: boolean;
  confirmation?: boolean;
  onChange: (follow: boolean, anchor?: FollowFeedbackAnchor) => Promise<void>;
}) {
  const { text } = useLocale();
  const [pending, setPending] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<"followed" | "unfollowed" | "error" | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = pending ?? followed;
  const action = active ? text(`Unfollow ${label}`, `取消关注 ${label}`) : text(`Follow ${label}`, `关注 ${label}`);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(timer.current); };
  }, []);

  async function toggle(anchor: FollowFeedbackAnchor) {
    if (locked.current || disabled) return;
    locked.current = true;
    clearTimeout(timer.current);
    setNotice(null);
    const next = !followed;
    setPending(next);
    try {
      await onChange(next, anchor);
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

  return <button type="button" className={styles.star} aria-label={action}
    aria-pressed={active} aria-busy={pending !== null} disabled={disabled || pending !== null}
    data-feedback={notice !== null || pending !== null} onClick={event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      void toggle(event.detail ? {x:event.clientX,y:event.clientY} : {x:bounds.right,y:bounds.bottom});
    }}>
    <span aria-hidden="true">{active ? "★" : "☆"}</span>
    {notice && (confirmation || notice === "error") && <span key={notice} className={`${styles.notice} ${notice === "error" ? styles.error : styles.success}`}
      role={notice === "error" ? "alert" : "status"}>
      {notice === "error" ? text(`Could not save ${label}. Retry.`, `${label} 保存失败，请重试。`)
        : notice === "followed" ? text(`${label} followed`, `已关注 ${label}`) : text(`${label} unfollowed`, `已取消关注 ${label}`)}
    </span>}
  </button>;
}

/** Remains visible when an unfollow removes its company row. */
export function CompanyFollowConfirmation({ label, followed, anchor }: { label: string; followed: boolean; anchor?: FollowFeedbackAnchor }) {
  const { text } = useLocale();
  const notice = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!notice.current || !anchor) return;
    const element = notice.current;
    const {width,height} = element.getBoundingClientRect();
    const gap=14,margin=8;
    const x=anchor.x+gap+width<=window.innerWidth-margin?anchor.x+gap:anchor.x-gap-width;
    const y=anchor.y+gap+height<=window.innerHeight-margin?anchor.y+gap:anchor.y-gap-height;
    element.style.left=String(Math.max(margin,Math.min(x,window.innerWidth-width-margin)))+"px";
    element.style.top=String(Math.max(margin,Math.min(y,window.innerHeight-height-margin)))+"px";
  },[anchor]);
  return createPortal(<span ref={notice} data-anchored={Boolean(anchor)} className={`${styles.notice} ${styles.toast} ${styles.success}`} role="status">
    {followed ? text(`${label} followed`, `已关注 ${label}`) : text(`${label} unfollowed`, `已取消关注 ${label}`)}
  </span>, document.body);
}
