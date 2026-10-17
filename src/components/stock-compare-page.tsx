"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { COMPARE_COLORS, comparePath, compareSymbol, latestCompareDate, returnLabel, type CompareConfig, type CompareData, type CompareStyle } from "@/lib/compare";
import { EARLIEST_PLAYBACK_DATE, MAX_PLAYBACK_YEARS, playbackStartDate, validatePlaybackConfig } from "@/lib/ui/compare-range";
import { localizedPath } from "@/lib/i18n/urls";
import { xPostIntentUrl, xTrackedShareUrl } from "@/lib/x-share";
import { compareEmbedPath, comparisonEmbedCode, type CompareEmbedTheme } from "@/lib/compare-embed";
import { comparisonPosition, snapComparisonProgress } from "@/lib/compare-chart";
import { COMPARE_LIGHT_COLORS } from "@/lib/compare";
import { CompanySearch } from "./company-search";
import { ComparisonVideoExport } from "./comparison-video-export";
import { LocalizedLink as Link } from "./localized-link";
import { useLocale } from "./providers/locale-provider";
import styles from "./stock-compare.module.css";

function ChartLoading() {
  const { text } = useLocale();
  return <p className="p-10 text-slate-400">{text("Loading chart…", "正在加载图表…")}</p>;
}
const Chart = dynamic(() => import("./stock-comparison-chart").then(module => module.StockComparisonChart), { ssr: false, loading: ChartLoading });

export function StockComparePage({ initial, embedded = false, embedTheme = "dark" }: { initial: CompareConfig; embedded?: boolean; embedTheme?: CompareEmbedTheme }) {
  const { text, locale } = useLocale();
  const [draft, setDraft] = useState(initial), [applied, setApplied] = useState(initial);
  const [style, setStyle] = useState<CompareStyle>(initial.style);
  const [notice, setNotice] = useState("");
  const [data, setData] = useState<CompareData | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [progress, setProgress] = useState(1), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const [highlighted, setHighlighted] = useState<string | null>(null), [shareUrl, setShareUrl] = useState("");
  const [showEmbed, setShowEmbed] = useState(false), [theme, setTheme] = useState<CompareEmbedTheme>(embedTheme), [embedCode, setEmbedCode] = useState("");
  const [chartUnavailable, setChartUnavailable] = useState(false);
  const handleUnavailable = useCallback(() => setChartUnavailable(true), []);
  const colors = embedded && theme === "light" ? COMPARE_LIGHT_COLORS : COMPARE_COLORS;
  const editor = useRef<HTMLElement>(null);
  const requestKey = new URLSearchParams({ symbols: applied.symbols.join(","), start: applied.start, end: applied.end }).toString();

  useEffect(() => {
    const controller = new AbortController();
    const invalid = validatePlaybackConfig(applied);
    setLoading(true); setData(null); setError(""); setPlaying(false); setProgress(1); setHighlighted(null);
    if (invalid) { setError(invalid); setLoading(false); return; }
    void fetch(`/api/compare?${requestKey}`, { signal: controller.signal }).then(async response => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load comparison.");
      return payload as CompareData;
    }).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load comparison."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // requestKey includes every field that affects the price data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, retry]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0, previous = 0;
    function advance(now: number) {
      const delta = previous ? Math.min(now - previous, 100) : 0;
      previous = now;
      setProgress(value => Math.min(1, value + delta * speed / 20000));
      frame = requestAnimationFrame(advance);
    }
    frame = requestAnimationFrame(advance);
    const pause = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", pause);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("visibilitychange", pause); };
  }, [playing, speed]);
  useEffect(() => { if (progress >= 1) setPlaying(false); }, [progress]);

  function addStock(raw: string) {
    const symbol = raw.trim().toUpperCase().replace(/^\$/, "").replace(/^US:/, "");
    if (!compareSymbol(symbol)) { setNotice(text("Choose a listed stock ticker.", "请选择上市股票代码。")); return; }
    if (draft.symbols.includes(symbol)) { setNotice(text("This stock is already selected.", "已选择此股票。")); return; }
    if (draft.symbols.length >= 10) { setNotice(text("You can compare up to 10 stocks.", "最多可对比 10 只股票。")); return; }
    setDraft({ ...draft, symbols: [...draft.symbols, symbol] }); setNotice("");
  }
  function updateAddress(config: CompareConfig) {
    window.history.replaceState(null, "", localizedPath(embedded ? compareEmbedPath(config, theme) : comparePath(config), locale));
  }
  function apply() {
    const invalid = validatePlaybackConfig(draft);
    if (invalid) { setNotice(invalid); return; }
    setApplied({ ...draft, style }); setNotice(""); setShareUrl(""); setShowEmbed(false); updateAddress({ ...draft, style });
  }
  function changeStyle(next: CompareStyle) {
    setStyle(next); setShareUrl(""); setShowEmbed(false); updateAddress({ ...applied, style: next });
  }
  function currentUrl() { return new URL(localizedPath(comparePath({ ...applied, style }), locale), window.location.origin).href; }
  async function copy() {
    const url = currentUrl();
    try { await navigator.clipboard.writeText(url); setNotice(text("Comparison link copied.", "已复制对比链接。")); }
    catch { setShareUrl(url); setNotice(text("Copy the link below to share this comparison.", "复制下方链接分享此对比。")); }
  }
  async function share() {
    const url = currentUrl();
    if (navigator.share) {
      try { await navigator.share({ title: "Stock comparison | YouAnalyst", url }); return; }
      catch (error) { if (error instanceof Error && error.name === "AbortError") return; }
    }
    await copy();
  }
  function buildEmbed(nextTheme = theme) {
    return comparisonEmbedCode({ ...applied, style }, nextTheme, locale, window.location.origin);
  }
  async function copyEmbed() {
    const code = buildEmbed();
    setEmbedCode(code); setShowEmbed(true);
    try { await navigator.clipboard.writeText(code); setNotice(text("Embed code copied.", "已复制嵌入代码。")); }
    catch { setNotice(text("Copy the embed code below.", "请复制下方嵌入代码。")); }
  }
  const visibleProgress = data && !playing ? snapComparisonProgress(progress, data.dates.length) : progress;
  const { index, next, fraction } = comparisonPosition(visibleProgress, data?.dates.length ?? 0);
  const ranking = data?.series.map((series, i) => ({ symbol: series.symbol, color: colors[i], value: series.values[index] + (series.values[next] - series.values[index]) * fraction })).sort((a,b) => b.value - a.value);
  const dirty = draft.symbols.join(",") !== applied.symbols.join(",") || draft.start !== applied.start || draft.end !== applied.end;

  const results = ranking && <section className={styles.results}><h2>{text("At a glance", "表现一览")} <span>{fraction > 0 ? text("Interpolated", "插值") : data?.dates[index]}</span></h2><table><caption className="sr-only">{fraction > 0 ? text("Animated returns between stored closes", "收盘数据之间的动画插值收益") : text("Price returns at the selected playback date", "回放所选日期的价格收益")}</caption><thead><tr><th>{text("Rank", "排名")}</th><th>{text("Stock", "股票")}</th><th>{text("Price return", "价格收益")}</th></tr></thead><tbody>{ranking.map((row, i) => <tr key={row.symbol}><td>{i + 1}</td><td><i style={{ background: row.color }}/>{row.symbol}</td><td>{returnLabel(row.value)}</td></tr>)}</tbody></table></section>;

  return <main className={`${styles.page}${embedded ? ` ${styles.embedded}` : ""}`} data-embed-theme={embedded ? theme : undefined}>
    <h1 className="sr-only">{text("Stock performance playback", "股票表现回放")}</h1>
    <section className={styles.stage} aria-label={text("Performance chart", "表现图表")} aria-busy={loading}>
      <div className={styles.stageHeading}><div><p className={styles.eyebrow} title={text("Dividends are not reinvested. Motion between closes is interpolated.", "股息不再投资，收盘数据之间的动画为插值。")}>{text("PRICE RETURN", "价格收益")}</p></div><div className={styles.styleSwitch} role="group" aria-label={text("Animation style", "动画样式")}>{(["line", "bar"] as const).map(option => <button key={option} type="button" aria-pressed={style === option} onClick={() => changeStyle(option)}>{option === "line" ? text("Line race", "折线竞赛") : text("Bar race", "条形竞赛")}</button>)}</div></div>
      {loading ? <div className={styles.empty} role="status">{text("Loading daily closes…", "正在加载每日收盘价…")}</div> : error ? <div className={styles.empty}><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>{text("Retry", "重试")}</button></div> : data && <>
        <div className={styles.dateRow}><time data-testid="comparison-date">{data.dates[index]}</time><span>{fraction > 0 ? `→ ${data.dates[next]} · ${text("Interpolated", "插值")}` : text(data.frequency + " closes", data.frequency === "Daily" ? "每日收盘" : data.frequency === "Weekly" ? "每周收盘" : "每月收盘")}</span></div>
        <Chart data={data} progress={visibleProgress} style={style} highlighted={highlighted} colors={colors} onUnavailable={handleUnavailable}/>
        <div className={styles.legend} aria-label={text("Highlight a stock", "突出显示股票")}>{data.series.map((series, i) => <button key={series.symbol} type="button" aria-pressed={highlighted === series.symbol} onClick={() => setHighlighted(highlighted === series.symbol ? null : series.symbol)}><i style={{ background: colors[i] }}/>{series.symbol}</button>)}</div>
        <div className={styles.playback}>
          <button type="button" className={styles.primary} aria-label={playing ? text("Pause animation", "暂停动画") : text("Play animation", "播放动画")} onClick={() => { setProgress(!playing && progress >= 1 ? 0 : data ? snapComparisonProgress(progress, data.dates.length) : progress); setPlaying(!playing); }}>{playing ? "Ⅱ" : "▶"} {playing ? text("Pause", "暂停") : text("Play", "播放")}</button>
          <button type="button" aria-label={text("Replay animation", "重播动画")} onClick={() => { setProgress(0); setPlaying(true); }}>↺</button>
          <input type="range" aria-label={text("Comparison timeline", "对比时间轴")} min="0" max="1" step="any" value={visibleProgress} onChange={e => { setPlaying(false); setProgress(snapComparisonProgress(Number(e.target.value), data.dates.length)); }}/>
          <label className={styles.speed}>{text("Speed", "速度")}<select aria-label={text("Playback speed", "播放速度")} value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[.5, 1, 2, 4].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
        </div>
        <div className={styles.caption}><p>{text("Shared trading dates", "共同交易日期")}: {data.dates[0]} → {data.dates.at(-1)}. {text("All stocks start at 0%.", "所有股票从 0% 开始。")}</p><span>YouAnalyst</span></div>
        {!embedded && <ComparisonVideoExport data={data} style={style} onStart={() => setPlaying(false)}/>}
      </>}
    </section>
    {!embedded && <section ref={editor} id="comparison-editor" className={styles.editor} aria-label={text("Edit comparison", "编辑对比")}>
      <div className={styles.editorHeading}><h2>{text("Your lineup", "对比股票")}</h2><span>{draft.symbols.length} / 10</span></div>
      <div className={styles.chips}>{draft.symbols.map((symbol, i) => <button key={symbol} type="button" onClick={() => { setDraft({ ...draft, symbols: draft.symbols.filter(s => s !== symbol) }); setNotice(""); }} aria-label={text(`Remove ${symbol}`, `移除 ${symbol}`)}><i style={{ background: COMPARE_COLORS[i] }}/>{symbol}<span aria-hidden="true">×</span></button>)}</div>
      <div className={styles.settings}>
        <div className={styles.search}><span>{text("Add a stock", "添加股票")}</span><CompanySearch inline owner="chart" typeToSearch={false} clearOnSelect onSelect={item => addStock(/^(XSHG|XSHE):/.test(item.id) ? item.id : item.symbol)}/></div>
        <label>{text("From", "起始日期")}<input type="date" value={draft.start} min={playbackStartDate(draft.end)} max={draft.end} onChange={e => setDraft({ ...draft, start: e.target.value })}/></label>
        <label>{text("To", "结束日期")}<input type="date" value={draft.end} min={draft.start > EARLIEST_PLAYBACK_DATE ? draft.start : EARLIEST_PLAYBACK_DATE} max={latestCompareDate()} onChange={e => setDraft({ ...draft, end: e.target.value })}/></label>
        <button type="button" className={styles.primary} onClick={apply} disabled={!draft.symbols.length}>{text("Compare", "开始对比")} <span aria-hidden="true">→</span></button>
      </div>
      <div className={styles.presets}><span>{text("Quick range", "快捷区间")}</span>{[1, 3, MAX_PLAYBACK_YEARS].map(years => <button type="button" key={years} onClick={() => setDraft({ ...draft, start: playbackStartDate(draft.end || initial.end, years) })}>{years}Y</button>)}<span>{text("Up to 5 years · Available from Dec 31, 2020", "最长 5 年 · 数据始于 2020 年 12 月 31 日")}</span>{dirty && <span>{text("Apply your changes with Compare.", "点击「开始对比」应用修改。")}</span>}</div>
    </section>}
    {!embedded && <p className={styles.notice} role="status">{notice}</p>}
    {!embedded && <div className={styles.shareRow}><p>{text("A comparison worth sharing.", "分享你的对比。")} <span>{text("One link. The same stocks, dates, and style.", "一个链接，保留股票、日期和样式。")}</span></p><div><button type="button" disabled={!data || loading} onClick={() => void copy()}>{text("Copy link", "复制链接")}</button><button type="button" disabled={!data || loading} onClick={() => void share()}>{text("Share", "分享")} <span aria-hidden="true">↗</span></button><button type="button" disabled={!data || loading} onClick={() => { setEmbedCode(buildEmbed()); setShowEmbed(value => !value); }} aria-expanded={showEmbed} aria-controls="comparison-embed-options">{text("Embed", "嵌入网站")}</button>{data && !loading && <a href={xPostIntentUrl({ text: `Watch ${applied.symbols.join(" vs ")} on YouAnalyst`, url: xTrackedShareUrl({campaign: "stock-comparison", url: localizedPath(comparePath({ ...applied, style }), locale)}) })} target="_blank" rel="noopener noreferrer">{text("Post to X", "分享到 X")}</a>}</div></div>}
    {!embedded && showEmbed && <section id="comparison-embed-options" className={styles.embedOptions} aria-label={text("Website embed", "网站嵌入")}>
      <h2>{text("Add this comparison to your website", "将此对比嵌入你的网站")}</h2>
      <label>{text("Widget theme", "组件主题")}<select aria-label={text("Widget theme", "组件主题")} value={theme} onChange={event => { const nextTheme = event.target.value === "light" ? "light" : "dark"; setTheme(nextTheme); setEmbedCode(buildEmbed(nextTheme)); }}><option value="dark">{text("Dark", "深色")}</option><option value="light">{text("Light", "浅色")}</option></select></label>
      <p>{text("Includes playback controls and the YouAnalyst watermark. Paste this code into your website's HTML.", "包含播放控件及 YouAnalyst 水印。将此代码粘贴到网站 HTML 中。")}</p>
      <textarea aria-label={text("Website embed code", "网站嵌入代码")} readOnly value={embedCode} onFocus={event => event.target.select()}/>
      <button type="button" disabled={!data || loading} onClick={() => void copyEmbed()}>{text("Copy embed code", "复制嵌入代码")}</button>
      <Link href={compareEmbedPath({ ...applied, style }, theme)} target="_blank" rel="noopener noreferrer">{text("Preview widget", "预览组件")} ↗</Link>
    </section>}
    {shareUrl && <input className={styles.shareInput} aria-label={text("Shareable comparison link", "对比分享链接")} readOnly value={shareUrl} onFocus={e => e.target.select()}/>}
    {embedded ? <><div className={styles.embedFooter}><span>YouAnalyst</span><Link href={comparePath({ ...applied, style })} target="_blank" rel="noopener noreferrer">{text("Open in YouAnalyst", "在 YouAnalyst 中打开")} ↗</Link></div>{results && <details className={styles.embedResults} open={chartUnavailable || undefined}><summary>{text("View returns table", "查看收益表")}</summary>{results}</details>}</> : results}
  </main>;
}
