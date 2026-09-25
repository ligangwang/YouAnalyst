"use client";

import { useMemo, useState } from "react";
import { LocalizedLink as Link } from "./localized-link";
import { useLocale } from "./providers/locale-provider";
import { CompanyChangeCard, LaterCollectionNote } from "./company-change-card";
import type { KnowledgeGraph } from "@/lib/knowledge-graph/model";
import type { CompanyUpdate } from "@/lib/knowledge-graph/company-updates";
import { groupFeedUpdates, orderFeed, type FeedOrder } from "@/lib/knowledge-graph/feed-order";

export function ResearchUpdateFeed({ graph, items }: { graph: KnowledgeGraph | null; items: CompanyUpdate[] }) {
  const { text } = useLocale();
  const [limit, setLimit] = useState(20);
  const [order, setOrder] = useState<FeedOrder>("event");
  const entries = useMemo(() => orderFeed(groupFeedUpdates(items), order), [items, order]);
  const orders: [FeedOrder, string, string][] = [["event", "Event date", "事件日期"], ["added", "Recently added", "最近收录"]];
  return <main className="mx-auto max-w-5xl px-4 py-8">
    <h1 className="text-3xl font-semibold text-cyan-100">{text("Company research updates", "公司研究动态")}</h1>
    <p className="mt-3 text-sm text-slate-400">{order === "event"
      ? text("Sourced AI supply-chain developments and evidence reviews, newest event or announcement first. Undated items are placed by the date we collected them.", "有来源的 AI 产业链进展与证据复核，按事件或宣布日期由近及远排列；未注明日期的按收录日期排列。")
      : text("Sourced AI supply-chain developments and evidence reviews, most recently collected first.", "有来源的 AI 产业链进展与证据复核，按收录时间由近及远排列。")}</p>
    <LaterCollectionNote className="mt-2" />
    <div className="my-6 flex flex-wrap items-center justify-between gap-4">
      <nav className="flex gap-5 text-cyan-200"><Link href="/feed">{text("All updates", "全部动态")}</Link><Link href="/feed?scope=following">{text("Following", "我关注的")}</Link></nav>
      <div className="flex items-center gap-2 text-sm" role="group" aria-label={text("Sort updates", "排序方式")}>
        {orders.map(([value, en, zh]) => <button key={value} type="button" aria-pressed={order === value} onClick={() => { setOrder(value); setLimit(20); }} className="rounded-full border border-cyan-400/30 px-3 py-1 text-cyan-200 aria-pressed:bg-cyan-900 aria-pressed:text-cyan-50">{text(en, zh)}</button>)}
      </div>
    </div>
    {!graph ? <p role="status">{text("Research updates are temporarily unavailable. Please try again later.", "研究动态暂时无法加载，请稍后重试。")}</p> : !entries.length ? <p>{text("No reliable updates available yet.", "暂无可核实的更新。")}</p> : <ol className="space-y-4">{entries.slice(0, limit).map(entry => <li key={entry.item.id}><CompanyChangeCard item={entry.item} evidence={entry.evidence} graph={graph} publicFeed /></li>)}</ol>}
    {entries.length > limit && <button className="mt-6 rounded-full border border-cyan-400/30 px-4 py-2 text-cyan-200" onClick={() => setLimit(n => n + 20)}>{text("Show more", "显示更多")}</button>}
  </main>;
}
