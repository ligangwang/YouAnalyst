"use client";

import { useEffect, useRef, useState } from "react";
import { COMPARE_TEMPLATES, DEFAULT_COMPARE_APPEARANCE, companyCompareColor, parseCompareAppearance, type CompareAppearance } from "@/lib/compare-appearance";
import type { CompareStyle } from "@/lib/compare";
import { useOptionalAuth } from "@/components/providers/auth-provider";
import { useLocale } from "./providers/locale-provider";
import { LocalizedLink as Link } from "./localized-link";
import styles from "./stock-compare.module.css";

export function useCompareAppearance(embedded: boolean) {
  const auth = useOptionalAuth();
  const uid = embedded ? null : auth?.user?.uid ?? null;
  const getIdToken = auth?.getIdToken;
  const [state, setState] = useState<{ uid: string; appearance: CompareAppearance; ready: boolean } | null>(null);
  const [status, setStatus] = useState<"" | "saving" | "saved" | "error">("");
  const [attempt, setAttempt] = useState(0);
  const owner = useRef(uid);
  owner.current = uid;
  const locked = useRef(false);
  useEffect(() => {
    setStatus("");
    if (!uid || !getIdToken) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await getIdToken();
        if (!token) throw new Error();
        const response = await fetch("/api/preferences/compare", { headers: { authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw new Error();
        const appearance = parseCompareAppearance((await response.json()).appearance);
        if (!appearance) throw new Error();
        if (!controller.signal.aborted) setState({ uid, appearance, ready: true });
      } catch { if (!controller.signal.aborted) setStatus("error"); }
    })();
    return () => controller.abort();
  }, [uid, getIdToken, attempt]);
  const current = uid && state?.uid === uid ? state : null;
  return {
    signedIn: !!uid, loading: auth?.loading ?? false, ready: current?.ready ?? false,
    appearance: current?.appearance ?? DEFAULT_COMPARE_APPEARANCE, status,
    retry: () => setAttempt(value => value + 1),
    change: (appearance: CompareAppearance) => {
      if (uid && current?.ready && !locked.current) { setState({ uid, appearance, ready: true }); setStatus(""); }
    },
    save: async (style: CompareStyle, sharedColors: Record<string, string> = {}) => {
      if (!uid || !current?.ready || !getIdToken || locked.current) return;
      locked.current = true; setStatus("saving");
      const savedAppearance = { ...current.appearance, style, companyColors: { ...current.appearance.companyColors, ...sharedColors } };
      try {
        const token = await getIdToken();
        if (!token) throw new Error();
        const response = await fetch("/api/preferences/compare", { method: "PATCH", headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(savedAppearance), signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error();
        if (owner.current === uid) { setState({ uid, appearance: savedAppearance, ready: true }); setStatus("saved"); }
      } catch { if (owner.current === uid) setStatus("error"); }
      finally { locked.current = false; }
    },
  };
}

export function CompareCustomization({ preferences, symbols, style, light, colors, next, onChange }: {
  preferences: ReturnType<typeof useCompareAppearance>; symbols: string[]; style: CompareStyle; light: boolean;
  colors: Record<string, string>; next: string; onChange: (appearance: CompareAppearance) => void;
}) {
  const { text } = useLocale();
  const { appearance, signedIn, ready, status } = preferences;
  return <details className={styles.customization}>
    <summary>{text("Colors & style templates", "颜色与样式模板")}</summary>
    <p>{text("Keep a fixed color for each company across comparisons. Save a template and chart style as your account defaults.", "为每家公司固定对比颜色，并将模板和图表样式保存为账号默认设置。")}</p>
    {!signedIn ? <Link href={`/auth?${new URLSearchParams({ next })}`}>{text("Sign in or create an account to customize", "登录或注册以自定义")}</Link> : <>
      <fieldset disabled={!ready || status === "saving"}>
        <legend>{text("Style template", "样式模板")}</legend>
        <div className={styles.templateOptions}>{COMPARE_TEMPLATES.map(template => <button key={template} type="button" aria-pressed={appearance.template === template} onClick={() => onChange({ ...appearance, template })}>{template === "classic" ? text("Classic", "经典") : template === "pastel" ? text("Pastel", "柔和") : text("High contrast", "高对比")}</button>)}</div>
        <div className={styles.companyColors}>{symbols.map(symbol => <div key={symbol} role="group" aria-label={text(`${symbol} color settings`, `${symbol} 颜色设置`)}><label><input type="color" aria-label={text(`Color for ${symbol}`, `${symbol} 的颜色`)} value={colors[symbol] ?? companyCompareColor(symbol, appearance, light)} onChange={event => onChange({ ...appearance, companyColors: { ...appearance.companyColors, ...colors, [symbol]: event.target.value } })}/>{symbol}</label><button type="button" disabled={!appearance.companyColors[symbol] && !colors[symbol]} onClick={() => {
          const companyColors = { ...appearance.companyColors, ...colors }; delete companyColors[symbol]; onChange({ ...appearance, companyColors });
        }}>{text("Reset", "重置")}</button></div>)}</div>
        <button type="button" onClick={() => void preferences.save(style, colors)}>{status === "saving" ? text("Saving…", "保存中…") : text("Save my defaults", "保存默认设置")}</button>
      </fieldset>
      {status === "error" ? <p role="alert">{text("Could not load or save preferences. Your changes may not be saved.", "无法加载或保存偏好，修改可能尚未保存。")}{!ready && <button type="button" onClick={preferences.retry}>{text("Retry", "重试")}</button>}</p> : <p role="status">{status === "saved" ? text("Defaults saved to your account.", "默认设置已保存至账号。") : !ready ? text("Loading your preferences…", "正在加载偏好…") : text("Preview changes, then save your defaults.", "预览修改后保存默认设置。")}</p>}
    </>}
  </details>;
}
