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
  return <section className={styles.panel} aria-label={`${text("Company calls", "公司观点")}: ${ticker}`}>
    <CompanyCallActions ticker={ticker} compact={compact} entryPoint={entryPoint} />
    <PublicCalls key={ticker} ticker={ticker} />
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
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ limit: expanded ? "25" : "3" });
    if (cursor) query.set("cursorCreatedAt", cursor);
    fetch(`/api/ticker/${encodeURIComponent(ticker)}?${query}`, { credentials: "omit", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) })
      .then(async response => {
        if (!response.ok) throw new Error("unavailable");
        const payload = await response.json() as { items?: PublicCall[]; nextCursor?: string | null };
        if (!Array.isArray(payload.items)) throw new Error("unavailable");
        // The public endpoint owns visibility filtering; never render a viewerPosition here.
        if (!controller.signal.aborted) {
          const received = payload.items;
          setItems(previous => cursor ? [...new Map([...(previous ?? []), ...received].map(call => [call.id, call])).values()] : received);
          setNextCursor(payload.nextCursor ?? null); setFailed(false); setLoadingMore(false);
        }
      }).catch(() => { if (!controller.signal.aborted) { setFailed(true); setLoadingMore(false); } });
    return () => controller.abort();
  }, [ticker, attempt, expanded, cursor]);
  return <section className={styles.community} aria-label={text("Community calls", "社区观点")}>
    <div className={styles.heading}><h3>{text("Community calls", "社区观点")}</h3><button type="button" aria-expanded={expanded} onClick={() => { setExpanded(value => !value); setCursor(null); setLoadingMore(false); }}>{expanded ? text("Show less", "收起") : text("View all", "查看全部")} {expanded ? "↑" : "→"}</button></div>
    {failed ? <p role="status">{text("Calls could not be loaded.", "暂时无法读取观点。")}{" "}<button type="button" onClick={() => setAttempt(value => value + 1)}>{text("Retry", "重试")}</button></p>
      : items === null ? <p role="status">{text("Loading calls…", "正在读取观点…")}</p>
      : items.length === 0 ? <p>{nextCursor ? text("No calls in this preview. View all to browse more.", "当前预览暂无观点，可查看全部继续浏览。") : text("No public calls yet. Share your outlook.", "暂无公开观点，欢迎分享你的看法。")}</p>
      : (expanded ? items : items.slice(0, 3)).map(call => <article key={call.id} className={styles.call}>
        <div className={styles.meta}><Link className={call.direction === "UP" ? styles.bullish : styles.bearish} href={`/predictions/${encodeURIComponent(call.id)}`}>{call.direction === "UP" ? text("Bullish", "看多") : text("Bearish", "看空")}</Link><span>{call.authorNickname ? `@${call.authorNickname}` : call.authorDisplayName || text("Anonymous", "匿名")}</span>{call.createdAt && <RelativeTime value={call.createdAt} />}</div>
        <Link className={styles.thesis} href={`/predictions/${encodeURIComponent(call.id)}`}>{call.thesisTitle || call.thesis || text("View call", "查看观点")}</Link>
        <PredictionReturnSummary prediction={call} status={call.status} />
      </article>)}
    {expanded && nextCursor && <button type="button" disabled={loadingMore} onClick={() => { setLoadingMore(true); setCursor(nextCursor); }}>{loadingMore ? text("Loading calls…", "正在读取观点…") : text("Load more", "加载更多")}</button>}
  </section>;
}
