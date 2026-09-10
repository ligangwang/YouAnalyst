"use client";

import { useLocale } from "./providers/locale-provider";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { publicEventFromDocument, type PublicEvent } from "@/lib/events/model";
import type { PublicEventPage } from "@/lib/events/service";
import styles from "./live-event-feed.module.css";
import { eventFilters, type EventFilter } from "@/lib/events/filters";
import { FilterTabs } from "./filter-tabs";
import { RelativeTime } from "./relative-time";

const feedChinese: Record<string, string> = {"Latest":"最新动态","Live":"实时","Paused":"已暂停","Reconnecting":"重新连接中","Connecting":"连接中","A quieter view of the market. Updated as events arrive.":"静看市场脉动，新动态自动呈现。","↑ New updates":"↑ 查看新动态","We’ll be right back.":"稍后即将恢复。","You’re here early.":"你来得很早。","Nothing here yet.":"暂无动态。","Your feed will appear when the connection is restored.":"连接恢复后，动态将自动显示。","New filings will appear here as they’re processed. Leave this page open—we’ll bring them to you.":"新披露处理完成后会自动出现在这里，无需刷新。","Loading…":"加载中…","Earlier events":"更早动态","You’ve reached the end of this view.":"已到达当前视图末尾。","INSIDER FILING":"内部人交易披露","INSTITUTIONAL HOLDINGS":"机构持仓","Read filing":"查看原文","Loading your feed":"正在加载动态","The feed is temporarily unavailable. Reconnecting automatically.":"动态暂时不可用，正在自动重连。","Couldn’t load older events. Please try again.":"无法加载更早动态，请重试。","All":"全部","Insider activity":"内部人交易","Institutional holdings":"机构持仓"};
function useFeedText() { const { chinese } = useLocale(); return (value: string) => chinese ? feedChinese[value] ?? value : value; }

function parsePage(value: unknown): PublicEventPage {
  const page = value as PublicEventPage;
  if (!page || !Array.isArray(page.items) || page.items.length > 50 || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || page.nextCursor.length > 512))) throw new Error("Invalid event page");
  return { items: page.items.map(event => {
    const item = publicEventFromDocument(event.id, event);
    if (!item) throw new Error("Invalid event");
    return item;
  }), nextCursor: page.nextCursor };
}

function dateLabel(date: string, chinese = false) {
  return new Date(date).toLocaleDateString(chinese ? "zh-CN" : "en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function LiveEventFeed({ initialPage, initialError = false, type = "all" }: { initialPage: PublicEventPage; initialError?: boolean; type?: EventFilter }) {
  const t = useFeedText();
  const [page, setPage] = useState(initialPage);
  const [pending, setPending] = useState<PublicEventPage | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "reconnecting" | "paused">("connecting");
  const [error, setError] = useState(initialError ? "The feed is temporarily unavailable. Reconnecting automatically." : "");
  const [loadingMore, setLoadingMore] = useState(false);
  const current = useRef(initialPage);
  const latest = useRef(JSON.stringify(initialPage));
  const generation = useRef(0);
  const moreController = useRef<AbortController | null>(null);

  function replacePage(next: PublicEventPage) {
    generation.current++;
    moreController.current?.abort(); setLoadingMore(false);
    current.current = next; setPage(next); setPending(null);
  }

  useEffect(() => {
    let source: EventSource | null = null;
    const connect = () => {
      source?.close();
      if (document.hidden) { setStatus("paused"); return; }
      source = new EventSource(type === "all" ? "/api/events/stream" : `/api/events/stream?type=${type}`);
      source.addEventListener("snapshot", event => {
        try {
          const next = parsePage(JSON.parse((event as MessageEvent).data));
          setStatus("live"); setError("");
          const serialized = JSON.stringify(next);
          if (serialized === latest.current) return;
          latest.current = serialized;
          const reading = window.scrollY > 100 || document.activeElement?.closest("article");
          if (reading && current.current.items.length) setPending(next);
          else {
            generation.current++; moreController.current?.abort(); setLoadingMore(false);
            current.current = next; setPage(next); setPending(null);
          }
        } catch { setStatus("reconnecting"); }
      });
      source.addEventListener("unavailable", () => setStatus("reconnecting"));
      source.onerror = () => setStatus("reconnecting");
    };
    connect();
    document.addEventListener("visibilitychange", connect);
    return () => { source?.close(); moreController.current?.abort(); document.removeEventListener("visibilitychange", connect); };
  }, [type]);

  async function loadMore() {
    if (!current.current.nextCursor || loadingMore) return;
    const version = generation.current;
    const controller = new AbortController(); moreController.current = controller;
    setLoadingMore(true); setError("");
    try {
      const response = await fetch(`/api/events?cursor=${encodeURIComponent(current.current.nextCursor)}${type === "all" ? "" : `&type=${type}`}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
      if (!response.ok) throw new Error();
      const next = parsePage(await response.json());
      if (version !== generation.current || controller.signal.aborted) return;
      const ids = new Set(current.current.items.map(item => item.id));
      const combined = { items: [...current.current.items, ...next.items.filter(item => !ids.has(item.id))], nextCursor: next.nextCursor };
      current.current = combined; setPage(combined);
    } catch { if (!controller.signal.aborted) setError("Couldn’t load older events. Please try again."); }
    finally { if (version === generation.current) setLoadingMore(false); }
  }

  return <main className={styles.feed}>
    <div className={styles.heading}><h1>{t("Latest")}</h1><span role="status" className={`${styles.status} ${status === "live" ? styles.live : ""}`}><span className={styles.dot} />{status === "live" ? t("Live") : status === "paused" ? t("Paused") : status === "reconnecting" ? t("Reconnecting") : t("Connecting")}</span></div>
    <p className={styles.intro}>{t("A quieter view of the market. Updated as events arrive.")}</p>
    <FilterTabs label="Event types" items={eventFilters.map(filter => ({ label: t(filter.label), href: filter.value === "all" ? "/" : `/?type=${filter.value}`, active: type === filter.value }))} />
    {pending && <div className={styles.updates}><button type="button" onClick={() => { replacePage(pending); window.scrollTo({ top: 0, behavior: "instant" }); }}>{t("↑ New updates")}</button></div>}
    {error && <p role="alert" className={styles.error}>{t(error)}</p>}
    {!page.items.length ? <div className={styles.empty}>
      <div className={styles.emptyIcon} aria-hidden="true"><FeedIcon /></div>
      <h2>{initialError && status !== "live" ? t("We’ll be right back.") : type === "all" ? t("You’re here early.") : t("Nothing here yet.")}</h2>
      <p>{initialError && status !== "live" ? t("Your feed will appear when the connection is restored.") : t("New filings will appear here as they’re processed. Leave this page open—we’ll bring them to you.")}</p>
    </div> : <ol className={styles.list} aria-label="Latest market events">{page.items.map(event => <li key={event.id}><EventCard event={event} /></li>)}</ol>}
    {page.nextCursor && page.items.length < 300 && <button className={styles.more} type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? t("Loading…") : t("Earlier events")}</button>}
    {page.nextCursor && page.items.length >= 300 && <p className={styles.intro}>{t("You’ve reached the end of this view.")}</p>}
  </main>;
}

function FeedIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M5 5h14v14H5zM8 9h8M8 12h8M8 15h5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function EventCard({ event }: { event: PublicEvent }) {
  const { chinese } = useLocale();
  const t = useFeedText();
  return <article className={styles.card} aria-label={event.title}>
    <div className={styles.meta}><span className={styles.icon} aria-hidden="true"><FeedIcon /></span><span>{event.type === "SEC_FORM4" ? t("INSIDER FILING") : t("INSTITUTIONAL HOLDINGS")}</span><span aria-hidden="true">·</span><span>SEC EDGAR</span></div>
    <h2>{event.title}</h2><p>{event.summary}</p>
    <div className={styles.bottom}><div className={styles.tickers}>{event.tickers.slice(0, 5).map(ticker => <Link key={ticker} href={`/ticker/${encodeURIComponent(ticker)}`}>{ticker}</Link>)}{event.tickers.length > 5 && <span className={styles.status}>+{event.tickers.length - 5}</span>}</div><a className={styles.source} href={event.sourceUrl} target="_blank" rel="noopener noreferrer">{t("Read filing")} <span aria-hidden="true">↗</span></a></div>
    <div className={styles.date}><span>{chinese ? "披露于" : "Filed"} <time dateTime={event.occurredAt}>{dateLabel(event.occurredAt, chinese)}</time></span><span aria-hidden="true"> · </span><RelativeTime value={event.publishedAt} /></div>
  </article>;
}

export function LiveFeedLoading() {
  const t = useFeedText();
  return <main className={styles.feed} aria-busy="true"><div className={styles.heading}><h1>{t("Latest")}</h1><span role="status" className={styles.status}>{t("Loading your feed")}</span></div><p className={styles.intro}>{t("A quieter view of the market. Updated as events arrive.")}</p><div className={styles.skeleton} /><div className={styles.skeleton} /></main>;
}
