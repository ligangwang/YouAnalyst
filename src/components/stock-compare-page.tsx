"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { COMPARE_COLORS, comparePath, compareSymbol, latestCompareDate, returnLabel, validateCompareConfig, yearsBefore, type CompareConfig, type CompareData, type CompareStyle } from "@/lib/compare";
import { localizedPath } from "@/lib/i18n/urls";
import { xPostIntentUrl, xTrackedShareUrl } from "@/lib/x-share";
import { TickerSearchInput } from "./ticker-search-input";
import { LocalizedLink as Link } from "./localized-link";
import { useLocale } from "./providers/locale-provider";
import styles from "./stock-compare.module.css";

const Chart = dynamic(() => import("./stock-comparison-chart").then(module => module.StockComparisonChart), { ssr: false, loading: () => <p className="p-10 text-slate-400">Loading chart…</p> });

export function StockComparePage({ initial }: { initial: CompareConfig }) {
  const { text, locale } = useLocale();
  const [draft, setDraft] = useState(initial), [applied, setApplied] = useState(initial);
  const [style, setStyle] = useState<CompareStyle>(initial.style);
  const [query, setQuery] = useState(""), [notice, setNotice] = useState("");
  const [data, setData] = useState<CompareData | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0);
  const [progress, setProgress] = useState(1), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const [highlighted, setHighlighted] = useState<string | null>(null), [shareUrl, setShareUrl] = useState("");
  const editor = useRef<HTMLElement>(null);
  const requestKey = new URLSearchParams({ symbols: applied.symbols.join(","), start: applied.start, end: applied.end }).toString();

  useEffect(() => {
    const controller = new AbortController();
    const invalid = validateCompareConfig(applied);
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
    setDraft({ ...draft, symbols: [...draft.symbols, symbol] }); setQuery(""); setNotice("");
  }
  function updateAddress(config: CompareConfig) {
    window.history.replaceState(null, "", localizedPath(comparePath(config), locale));
  }
  function apply() {
    const invalid = validateCompareConfig(draft);
    if (invalid) { setNotice(invalid); return; }
    setApplied({ ...draft, style }); setNotice(""); setShareUrl(""); updateAddress({ ...draft, style });
  }
  function changeStyle(next: CompareStyle) {
    setStyle(next); setShareUrl(""); updateAddress({ ...applied, style: next });
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
  const index = data ? Math.min(data.dates.length - 1, Math.floor(progress * (data.dates.length - 1))) : 0;
  const next = data ? Math.min(index + 1, data.dates.length - 1) : 0;
  const fraction = data ? progress * (data.dates.length - 1) - index : 0;
  const ranking = data?.series.map((series, i) => ({ symbol: series.symbol, color: COMPARE_COLORS[i], value: series.values[index] + (series.values[next] - series.values[index]) * fraction })).sort((a,b) => b.value - a.value);
  const dirty = draft.symbols.join(",") !== applied.symbols.join(",") || draft.start !== applied.start || draft.end !== applied.end;

  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>{text("THE MARKET, IN MOTION", "市场，动起来")}</p><h1>{text("Compare stocks", "股票对比")}</h1><p>{text("Pick your stocks. Set the starting line. Watch the story unfold.", "选择股票，设定起点，回放市场表现。")}</p></div><Link href="/compare/analyst-views" className={styles.subtle}>{text("Analyst comparisons", "分析师观点对比")} ↗</Link></header>
    <section ref={editor} id="comparison-editor" className={styles.editor} aria-label={text("Edit comparison", "编辑对比")}>
      <div className={styles.editorHeading}><h2>{text("Your lineup", "对比股票")}</h2><span>{draft.symbols.length} / 10</span></div>
      <div className={styles.chips}>{draft.symbols.map((symbol, i) => <button key={symbol} type="button" onClick={() => { setDraft({ ...draft, symbols: draft.symbols.filter(s => s !== symbol) }); setNotice(""); }} aria-label={text(`Remove ${symbol}`, `移除 ${symbol}`)}><i style={{ background: COMPARE_COLORS[i] }}/>{symbol}<span aria-hidden="true">×</span></button>)}</div>
      <div className={styles.settings}>
        <div className={styles.search}><TickerSearchInput value={query} onChange={setQuery} onSelectSuggestion={item => addStock(/^(XSHG|XSHE):/.test(item.id) ? item.id : item.symbol)} label={text("Add a stock", "添加股票")} showHelperText={false}/><button type="button" onClick={() => addStock(query)} disabled={!query.trim() || draft.symbols.length >= 10}>{text("Add", "添加")}</button></div>
        <label>{text("From", "起始日期")}<input type="date" value={draft.start} max={draft.end} onChange={e => setDraft({ ...draft, start: e.target.value })}/></label>
        <label>{text("To", "结束日期")}<input type="date" value={draft.end} max={latestCompareDate()} onChange={e => setDraft({ ...draft, end: e.target.value })}/></label>
        <button type="button" className={styles.primary} onClick={apply} disabled={!draft.symbols.length}>{text("Compare", "开始对比")} <span aria-hidden="true">→</span></button>
      </div>
      <div className={styles.presets}><span>{text("Quick range", "快捷区间")}</span>{[1, 3, 5, 10].map(years => <button type="button" key={years} onClick={() => setDraft({ ...draft, start: yearsBefore(draft.end || initial.end, years) })}>{years}Y</button>)}{dirty && <span>{text("Apply your changes with Compare.", "点击「开始对比」应用修改。")}</span>}</div>
    </section>
    <p className={styles.notice} role="status">{notice}</p>
    <section className={styles.stage} aria-label={text("Performance chart", "表现图表")} aria-busy={loading}>
      <div className={styles.stageHeading}><div><p className={styles.eyebrow}>{text("PRICE RETURN", "价格收益")}</p><h2>{text("Every stock. Same starting line.", "相同起点，逐一对比。")}</h2></div><div className={styles.styleSwitch} role="group" aria-label={text("Animation style", "动画样式")}>{(["line", "bar"] as const).map(option => <button key={option} type="button" aria-pressed={style === option} onClick={() => changeStyle(option)}>{option === "line" ? text("Line race", "折线竞赛") : text("Bar race", "条形竞赛")}</button>)}</div></div>
      {loading ? <div className={styles.empty} role="status">{text("Loading daily closes…", "正在加载每日收盘价…")}</div> : error ? <div className={styles.empty}><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>{text("Retry", "重试")}</button></div> : data && <>
        <div className={styles.dateRow}><time data-testid="comparison-date">{data.dates[index]}</time><span>{text(data.frequency + " closes", data.frequency === "Daily" ? "每日收盘" : data.frequency === "Weekly" ? "每周收盘" : "每月收盘")}</span></div>
        <Chart data={data} progress={progress} style={style} highlighted={highlighted}/>
        <div className={styles.legend} aria-label={text("Highlight a stock", "突出显示股票")}>{data.series.map((series, i) => <button key={series.symbol} type="button" aria-pressed={highlighted === series.symbol} onClick={() => setHighlighted(highlighted === series.symbol ? null : series.symbol)}><i style={{ background: COMPARE_COLORS[i] }}/>{series.symbol}</button>)}</div>
        <div className={styles.playback}>
          <button type="button" className={styles.primary} aria-label={playing ? text("Pause animation", "暂停动画") : text("Play animation", "播放动画")} onClick={() => { if (!playing && progress >= 1) setProgress(0); setPlaying(!playing); }}>{playing ? "Ⅱ" : "▶"} {playing ? text("Pause", "暂停") : text("Play", "播放")}</button>
          <button type="button" aria-label={text("Replay animation", "重播动画")} onClick={() => { setProgress(0); setPlaying(true); }}>↺</button>
          <input type="range" aria-label={text("Comparison timeline", "对比时间轴")} min="0" max="1" step="0.001" value={progress} onChange={e => { setPlaying(false); setProgress(Number(e.target.value)); }}/>
          <label className={styles.speed}>{text("Speed", "速度")}<select aria-label={text("Playback speed", "播放速度")} value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[.5, 1, 2, 4].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
        </div>
        <div className={styles.caption}><p>{text("Shared trading dates", "共同交易日期")}: {data.dates[0]} → {data.dates.at(-1)}. {text("All stocks start at 0%.", "所有股票从 0% 开始。")}</p><span>YouAnalyst</span></div>
        {(data.dates[0] > applied.start || data.dates.at(-1)! < applied.end) && <p className={styles.coverage}>{text("The chart uses the first and last available shared trading days within your selected range.", "图表使用所选区间内首尾可用的共同交易日。")}</p>}
        <p className={styles.method}>{text("Uses the same stored closes and corporate action adjustments as company charts. Dividends are not reinvested. Weekly/monthly views keep the exact first and last closes. Motion between points is interpolated.", "使用与公司图表相同的收盘价和公司行动调整。股息不再投资。周线和月线保留首尾实际收盘价，数据点之间的动画为插值。")}</p>
      </>}
    </section>
    <div className={styles.shareRow}><p>{text("A comparison worth sharing.", "分享你的对比。")} <span>{text("One link. The same stocks, dates, and style.", "一个链接，保留股票、日期和样式。")}</span></p><div><button type="button" disabled={!data || loading} onClick={() => void copy()}>{text("Copy link", "复制链接")}</button><button type="button" disabled={!data || loading} onClick={() => void share()}>{text("Share", "分享")} <span aria-hidden="true">↗</span></button>{data && !loading && <a href={xPostIntentUrl({ text: `Watch ${applied.symbols.join(" vs ")} on YouAnalyst`, url: xTrackedShareUrl({campaign: "stock-comparison", url: localizedPath(comparePath({ ...applied, style }), locale)}) })} target="_blank" rel="noopener noreferrer">{text("Post to X", "分享到 X")}</a>}</div></div>
    {shareUrl && <input className={styles.shareInput} aria-label={text("Shareable comparison link", "对比分享链接")} readOnly value={shareUrl} onFocus={e => e.target.select()}/>}
    {ranking && <section className={styles.results}><h2>{text("At a glance", "表现一览")} <span>{data?.dates[index]}</span></h2><table><caption className="sr-only">{text("Price returns at the selected playback date", "回放所选日期的价格收益")}</caption><thead><tr><th>{text("Rank", "排名")}</th><th>{text("Stock", "股票")}</th><th>{text("Price return", "价格收益")}</th></tr></thead><tbody>{ranking.map((row, i) => <tr key={row.symbol}><td>{i + 1}</td><td><i style={{ background: row.color }}/>{row.symbol}</td><td>{returnLabel(row.value)}</td></tr>)}</tbody></table></section>}
  </main>;
}
