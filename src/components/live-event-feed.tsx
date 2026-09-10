"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { publicEventFromDocument, type PublicEvent } from "@/lib/events/model";
import type { PublicEventPage } from "@/lib/events/service";
import styles from "./live-event-feed.module.css";

function parsePage(value: unknown): PublicEventPage {
  const page = value as PublicEventPage;
  if (!page || !Array.isArray(page.items) || page.items.length > 50 || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || page.nextCursor.length > 512))) throw new Error("Invalid event page");
  return { items: page.items.map(event => {
    const item = publicEventFromDocument(event.id, event);
    if (!item) throw new Error("Invalid event");
    return item;
  }), nextCursor: page.nextCursor };
}

function dateLabel(date: string) {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function LiveEventFeed({ initialPage, initialError = false }: { initialPage: PublicEventPage; initialError?: boolean }) {
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
      source = new EventSource("/api/events/stream");
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
  }, []);

  async function loadMore() {
    if (!current.current.nextCursor || loadingMore) return;
    const version = generation.current;
    const controller = new AbortController(); moreController.current = controller;
    setLoadingMore(true); setError("");
    try {
      const response = await fetch(`/api/events?cursor=${encodeURIComponent(current.current.nextCursor)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]) });
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
    <div className={styles.heading}><h1>Latest</h1><span role="status" className={`${styles.status} ${status === "live" ? styles.live : ""}`}><span className={styles.dot} />{status === "live" ? "Live" : status === "paused" ? "Paused" : status === "reconnecting" ? "Reconnecting" : "Connecting"}</span></div>
    <p className={styles.intro}>A quieter view of the market. Updated as events arrive.</p>
    {pending && <div className={styles.updates}><button type="button" onClick={() => { replacePage(pending); window.scrollTo({ top: 0, behavior: "instant" }); }}>↑ New updates</button></div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!page.items.length ? <div className={styles.empty}>
      <div className={styles.emptyIcon} aria-hidden="true"><FeedIcon /></div>
      <h2>{initialError && status !== "live" ? "We’ll be right back." : "You’re here early."}</h2>
      <p>{initialError && status !== "live" ? "Your feed will appear when the connection is restored." : "New filings will appear here as they’re processed. Leave this page open—we’ll bring them to you."}</p>
    </div> : <ol className={styles.list} aria-label="Latest market events">{page.items.map(event => <li key={event.id}><EventCard event={event} /></li>)}</ol>}
    {page.nextCursor && page.items.length < 300 && <button className={styles.more} type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Earlier events"}</button>}
    {page.nextCursor && page.items.length >= 300 && <p className={styles.intro}>You’ve reached the end of this view.</p>}
  </main>;
}

function FeedIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M5 5h14v14H5zM8 9h8M8 12h8M8 15h5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function EventCard({ event }: { event: PublicEvent }) {
  return <article className={styles.card} aria-label={event.title}>
    <div className={styles.meta}><span className={styles.icon} aria-hidden="true"><FeedIcon /></span><span>{event.type === "SEC_FORM4" ? "INSIDER FILING" : "INSTITUTIONAL HOLDINGS"}</span><span aria-hidden="true">·</span><span>SEC EDGAR</span></div>
    <h2>{event.title}</h2><p>{event.summary}</p>
    <div className={styles.bottom}><div className={styles.tickers}>{event.tickers.slice(0, 5).map(ticker => <Link key={ticker} href={`/ticker/${encodeURIComponent(ticker)}`}>{ticker}</Link>)}{event.tickers.length > 5 && <span className={styles.status}>+{event.tickers.length - 5}</span>}</div><a className={styles.source} href={event.sourceUrl} target="_blank" rel="noopener noreferrer">Read filing <span aria-hidden="true">↗</span></a></div>
    <div className={styles.date}>Filed <time dateTime={event.occurredAt}>{dateLabel(event.occurredAt)}</time> · Added <time dateTime={event.publishedAt}>{dateLabel(event.publishedAt)}, {new Date(event.publishedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC</time></div>
  </article>;
}

export function LiveFeedLoading() {
  return <main className={styles.feed} aria-busy="true"><div className={styles.heading}><h1>Latest</h1><span role="status" className={styles.status}>Loading your feed</span></div><p className={styles.intro}>A quieter view of the market. Updated as events arrive.</p><div className={styles.skeleton} /><div className={styles.skeleton} /></main>;
}
