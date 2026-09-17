"use client";
import { useState } from "react";
import { useLocale } from "./providers/locale-provider";
import { trackEvent } from "@/lib/analytics";
import styles from "./research-discovery.module.css";

export function ShareResearchView() {
  const { text } = useLocale();
  const [message, setMessage] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  async function share() {
    const url = new URL(window.location.href);
    for (const key of [...url.searchParams.keys()]) if (!["company", "relationship", "product", "relation", "event", "q"].includes(key)) url.searchParams.delete(key);
    try {
      await navigator.clipboard.writeText(url.toString());
      setMessage(text("Link copied", "链接已复制"));
      trackEvent("research_share", { method: "copy", entry_point: "research" });
    } catch { setManualUrl(url.toString()); setMessage(text("Copy this link", "请复制此链接")); }
  }
  return <div className={styles.share}><button type="button" onClick={share}>{text("Share this view", "分享当前视图")}</button> <output aria-live="polite">{message}</output>{manualUrl && <input aria-label={text("Share link", "分享链接")} readOnly value={manualUrl} onFocus={e=>e.target.select()} />}</div>;
}
