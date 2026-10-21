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
  const [state, setState] = useState<{ uid: string; appearance: CompareAppearance; savedAppearance: CompareAppearance; ready: boolean } | null>(null);
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
        if (!controller.signal.aborted) setState({ uid, appearance, savedAppearance: appearance, ready: true });
      } catch { if (!controller.signal.aborted) setStatus("error"); }
    })();
    return () => controller.abort();
  }, [uid, getIdToken, attempt]);
  const current = uid && state?.uid === uid ? state : null;
  return {
    signedIn: !!uid, loading: auth?.loading ?? false, ready: current?.ready ?? false,
    appearance: current?.appearance ?? DEFAULT_COMPARE_APPEARANCE, savedAppearance: current?.savedAppearance ?? DEFAULT_COMPARE_APPEARANCE, status,
    retry: () => setAttempt(value => value + 1),
    change: (appearance: CompareAppearance) => {
      if (uid && current?.ready && !locked.current) { setState({ ...current, appearance }); setStatus(""); }
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
        const confirmed = parseCompareAppearance((await response.json()).appearance);
        if (!confirmed) throw new Error();
        if (owner.current === uid) { setState({ uid, appearance: confirmed, savedAppearance: confirmed, ready: true }); setStatus("saved"); }
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
  const { appearance, savedAppearance, signedIn, ready, status } = preferences;
  return <details className={styles.customization}>
    <summary>{text("Colors & style templates", "颜色与样式模板")}</summary>
    <p>{text("Keep a fixed color for each company across comparisons. Save a template and chart style as your account defaults.", "为每家公司固定对比颜色，并将模板和图表样式保存为账号默认设置。")}</p>
    <p>{text("Restore custom color restores your last saved color; System default color uses the current template’s palette.", "“恢复自选色”还原你上次保存的自选颜色；“系统默认颜色”使用当前模板的配色。")}</p>
    {!signedIn ? <Link href={`/auth?${new URLSearchParams({ next })}`}>{text("Sign in or create an account to customize", "登录或注册以自定义")}</Link> : <>
      <fieldset disabled={!ready || status === "saving"}>
        <legend>{text("Style template", "样式模板")}</legend>
        <div className={styles.templateOptions}>{COMPARE_TEMPLATES.map(template => <button key={template} type="button" aria-pressed={appearance.template === template} onClick={() => onChange({ ...appearance, template })}>{template === "classic" ? text("Classic", "经典") : template === "pastel" ? text("Pastel", "柔和") : text("High contrast", "高对比")}</button>)}</div>
        <div className={styles.companyColors}>{symbols.map(symbol => <CompanyColorControl key={symbol} symbol={symbol} appearance={appearance} savedAppearance={savedAppearance} light={light} colors={colors} onChange={onChange}/>)}</div>
        <button type="button" onClick={() => void preferences.save(style, colors)}>{status === "saving" ? text("Saving…", "保存中…") : text("Save custom colors", "保存自选色")}</button>
      </fieldset>
      {status === "error" ? <p role="alert">{text("Could not load or save preferences. Your changes may not be saved.", "无法加载或保存偏好，修改可能尚未保存。")}{!ready && <button type="button" onClick={preferences.retry}>{text("Retry", "重试")}</button>}</p> : <p role="status">{status === "saved" ? text("Custom colors saved to your account.", "自选色已保存至账号。") : !ready ? text("Loading your preferences…", "正在加载偏好…") : text("Preview changes, then save your custom colors.", "预览修改后保存自选色。")}</p>}
    </>}
  </details>;
}

export function CompanyColorControl({ symbol, appearance, savedAppearance, light, colors, onChange }: {
  symbol: string; appearance: CompareAppearance; savedAppearance: CompareAppearance; light: boolean; colors: Record<string, string>; onChange: (appearance: CompareAppearance) => void;
}) {
  const { text } = useLocale();
  const savedColor = companyCompareColor(symbol, savedAppearance, light);
  const currentColor = colors[symbol] ?? companyCompareColor(symbol, appearance, light);
  return <div role="group" aria-label={text(`${symbol} color settings`, `${symbol} 颜色设置`)}>
    <label><input type="color" aria-label={text(`Color for ${symbol}`, `${symbol} 的颜色`)} value={currentColor} onChange={event => onChange({ ...appearance, companyColors: { ...appearance.companyColors, ...colors, [symbol]: event.target.value } })}/>{symbol}</label>
    <button type="button" disabled={currentColor === savedColor} onClick={() => {
      const companyColors = { ...appearance.companyColors, ...colors };
      if (savedAppearance.companyColors[symbol] || savedAppearance.template !== appearance.template) companyColors[symbol] = savedColor;
      else delete companyColors[symbol];
      onChange({ ...appearance, companyColors });
    }}>{text("Restore custom color", "恢复自选色")}</button>
    <button type="button" disabled={!appearance.companyColors[symbol] && !colors[symbol]} onClick={() => {
      const companyColors = { ...appearance.companyColors, ...colors }; delete companyColors[symbol]; onChange({ ...appearance, companyColors });
    }}>{text("System default color", "系统默认颜色")}</button>
  </div>;
}
