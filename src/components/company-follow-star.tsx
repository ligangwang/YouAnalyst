"use client";

import { useEffect, useId, useRef, useState } from "react";
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

  return <button type="button" className={styles.star} aria-label={action} aria-describedby={tooltipId}
    aria-pressed={active} aria-busy={pending !== null} disabled={disabled || pending !== null}
    data-feedback={notice !== null || pending !== null} onClick={() => void toggle()}>
    <span aria-hidden="true">{active ? "★" : "☆"}</span>
    <span id={tooltipId} role="tooltip" className={styles.tooltip}>{action}</span>
    {notice && <span className={`${styles.notice} ${notice === "error" ? styles.error : styles.success}`}
      role={notice === "error" ? "alert" : "status"}>
      {notice === "error" ? text(`Could not save ${label}. Retry.`, `${label} 保存失败，请重试。`)
        : notice === "followed" ? text(`${label} followed`, `已关注 ${label}`) : text(`${label} unfollowed`, `已取消关注 ${label}`)}
    </span>}
  </button>;
}
