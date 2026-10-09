"use client";

import { useEffect, useState } from "react";
import { useLocale } from "./providers/locale-provider";
import { LocalizedLink as Link } from "./localized-link";
import { CompanyCallActions } from "./company-call-actions";
import { RelativeTime } from "./relative-time";
import { PredictionReturnSummary } from "./prediction-ui";
import { predictionInstrument } from "@/lib/predictions/instrument";
import type { Prediction } from "@/lib/predictions/types";
import type { GraphNode } from "@/lib/knowledge-graph/model";
import { ViewEvidenceList } from "./view-evidence-list";
import type { CompanyViewSummary } from "@/lib/posts/view-summary";
import styles from "./company-outlook.module.css";

type PublicCall = Prediction & { id: string; authorNickname?: string | null };

/** Only identities supported by the existing call workflow get publishing controls. */
export function GraphCompanyOutlook({ company }: { company: GraphNode }) {
  if (company.listingStatus === "PRIVATE") return null;
  const ticker = company.id.startsWith("US:") ? company.id.slice(3) : company.id;
  if (!predictionInstrument(ticker)) return null;
  return <CompanyOutlook key={ticker} ticker={ticker} compact entryPoint="evidence" />;
}

export function CompanyOutlook({ ticker, compact = false, entryPoint = "company" }: { ticker: string; compact?: boolean; entryPoint?: "company" | "evidence" }) {
  const { text } = useLocale();
  if (!predictionInstrument(ticker)) return null;
  // Other analysts' evidence-backed views come first; publishing your own follows them.
  return <section className={styles.panel} aria-label={`${text("Analyst views", "分析师观点")}: ${ticker}`}>
    <PublicCalls key={ticker} ticker={ticker} />
    <div className={styles.actions}><CompanyCallActions ticker={ticker} compact={compact} entryPoint={entryPoint} /></div>
  </section>;
}

function PublicCalls({ ticker }: { ticker: string }) {
  const { text } = useLocale();
  const [items, setItems] = useState<PublicCall[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [summary, setSummary] = useState<CompanyViewSummary | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ limit: expanded ? "25" : "3" });
    if (cursor) query.set("cursorCreatedAt", cursor); else query.set("summary", "1");
    fetch(`/api/ticker/${encodeURIComponent(ticker)}?${query}`, { credentials: "omit", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) })
      .then(async response => {
        if (!response.ok) throw new Error("unavailable");
        const payload = await response.json() as { items?: PublicCall[]; nextCursor?: string | null; summary?: CompanyViewSummary };
        if (!Array.isArray(payload.items)) throw new Error("unavailable");
        // The public endpoint owns visibility filtering; never render a viewerPosition here.
        if (!controller.signal.aborted) {
          const received = payload.items;
          setItems(previous => cursor ? [...new Map([...(previous ?? []), ...received].map(call => [call.id, call])).values()] : received);
          setNextCursor(payload.nextCursor ?? null); setFailed(false); setLoadingMore(false);
          if (payload.summary) setSummary(payload.summary);
        }
      }).catch(() => { if (!controller.signal.aborted) { setFailed(true); setLoadingMore(false); } });
    return () => controller.abort();
  }, [ticker, attempt, expanded, cursor]);
  return <section className={styles.community} aria-label={text("Analyst views", "分析师观点")}>
    <div className={styles.heading}><h3>{text("Analyst views", "分析师观点")}</h3><button type="button" aria-expanded={expanded} onClick={() => { setExpanded(value => !value); setCursor(null); setLoadingMore(false); }}>{expanded ? text("Show less", "收起") : text("View all", "查看全部")} {expanded ? "↑" : "→"}</button></div>
    {summary && summary.analysts > 0 && <ViewSummaryLine summary={summary} />}
    {failed ? <p role="status">{text("Views could not be loaded.", "暂时无法读取观点。")}{" "}<button type="button" onClick={() => setAttempt(value => value + 1)}>{text("Retry", "重试")}</button></p>
      : items === null ? <p role="status">{text("Loading views…", "正在读取观点…")}</p>
      : items.length === 0 ? <p>{nextCursor ? text("No views in this preview. View all to browse more.", "当前预览暂无观点，可查看全部继续浏览。") : text("No analyst views yet. Publish one that cites the research.", "暂无分析师观点。欢迎发布一条引用研究依据的观点。")}</p>
      : (expanded ? items : items.slice(0, 3)).map(call => <article key={call.id} className={styles.call}>
        <div className={styles.meta}><Link className={call.direction === "UP" ? styles.bullish : styles.bearish} href={`/predictions/${encodeURIComponent(call.id)}`}>{call.direction === "UP" ? text("Bullish", "看多") : text("Bearish", "看空")}</Link><span>{call.authorNickname ? `@${call.authorNickname}` : call.authorDisplayName || text("Anonymous", "匿名")}</span>{call.createdAt && <RelativeTime value={call.createdAt} />}</div>
        <Link className={styles.thesis} href={`/predictions/${encodeURIComponent(call.id)}`}>{call.thesisTitle || call.thesis || text("View", "查看观点")}</Link>
        <ViewEvidenceList evidence={call.evidence} compact />
        <PredictionReturnSummary prediction={call} status={call.status} />
      </article>)}
    {expanded && nextCursor && <button type="button" disabled={loadingMore} onClick={() => { setLoadingMore(true); setCursor(nextCursor); }}>{loadingMore ? text("Loading views…", "正在读取观点…") : text("Load more", "加载更多")}</button>}
  </section>;
}

/** "3 analysts track this company · 2 bullish, 1 bearish · 2 views cite TSMC → NVIDIA" */
function ViewSummaryLine({ summary }: { summary: CompanyViewSummary }) {
  const { text, locale } = useLocale();
  const top = summary.citations[0];
  return <p className={styles.summary}>
    {summary.analysts === 1 ? text("1 analyst tracks this company", "1 位分析师关注该公司") : text(`${summary.analysts} analysts track this company`, `${summary.analysts} 位分析师关注该公司`)}
    {" · "}{text(`${summary.bullish} bullish, ${summary.bearish} bearish`, `${summary.bullish} 看多，${summary.bearish} 看空`)}
    {top && <>{" · "}{top.views === 1 ? text("1 view cites ", "1 条观点引用 ") : text(`${top.views} views cite `, `${top.views} 条观点引用 `)}<Link href={top.href}>{locale === "zh-CN" ? top.label["zh-CN"] || top.label.en : top.label.en}</Link></>}
  </p>;
}
