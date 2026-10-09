"use client";

import { useMemo, useState } from "react";
import { LocalizedLink as Link } from "./localized-link";
import { useLocale } from "./providers/locale-provider";
import { ResearchChangeSummary } from "./research-change-summary";
import { CompanyChangeCard } from "./company-change-card";
import type { KnowledgeGraph } from "@/lib/knowledge-graph/model";
import type { CompanyUpdate } from "@/lib/knowledge-graph/company-updates";
import { groupFeedUpdates, orderFeed } from "@/lib/knowledge-graph/feed-order";

export function ResearchUpdateFeed({ graph, items }: { graph: KnowledgeGraph | null; items: CompanyUpdate[] }) {
  const { text } = useLocale();
  const [limit, setLimit] = useState(20);
  const [category, setCategory] = useState("all");
  const entries = useMemo(() => orderFeed(groupFeedUpdates(items)).filter(entry => category === "all" || (category === "research" ? entry.item.kind === "RESEARCH" : entry.item.business?.category === category)), [items, category]);
  return <main className="mx-auto max-w-5xl px-4 py-8">
    <h1 className="text-3xl font-semibold text-cyan-100">{text("Curated research updates", "精选研究动态")}</h1>
    <p className="mt-3 text-sm text-slate-400">{text("Reviewed supply-chain research, ordered by source publication date. Collected news and filings are available in the command center.", "已复核的产业链研究，按来源发布日期排列。采集的新闻和公告可在投资情报中查看。")}</p>
    <div className="my-6 flex flex-wrap items-center justify-between gap-4">
      <nav aria-label={text("Update feeds", "动态类型")} className="flex flex-wrap gap-5 text-cyan-200"><Link href="/">{text("News & filings", "新闻与公告")}</Link><Link href="/feed" aria-current="page">{text("Curated research", "精选研究")}</Link><Link href="/feed?scope=following">{text("Following", "我关注的")}</Link></nav>
    </div>
    {graph && <ResearchChangeSummary graph={graph} items={items} />}
    <label className="mb-5 flex items-center gap-3 text-sm text-slate-300">{text("Update type", "动态类型")}<select aria-label={text("Update type", "动态类型")} value={category} onChange={event => { setCategory(event.target.value); setLimit(20); }} className="rounded-lg border border-white/20 bg-slate-950 px-3 py-2">
      {[["all", "All updates", "全部动态"], ["ORDER", "Orders", "订单"], ["CAPACITY", "Capacity", "扩产"], ["PRODUCT", "Products", "产品"], ["PARTNERSHIP", "Partnerships", "合作"], ["research", "Evidence reviews", "证据复核"]].map(([id, en, zh]) => <option key={id} value={id}>{text(en, zh)}</option>)}
    </select></label>
    {!graph ? <p role="status">{text("Research updates are temporarily unavailable. Please try again later.", "研究动态暂时无法加载，请稍后重试。")}</p> : !entries.length ? <p>{text("No reliable updates available yet.", "暂无可核实的更新。")}</p> : <ol className="space-y-4">{entries.slice(0, limit).map(entry => <li key={entry.item.id}><CompanyChangeCard item={entry.item} evidence={entry.evidence} graph={graph} publicFeed /></li>)}</ol>}
    {entries.length > limit && <button className="mt-6 rounded-full border border-cyan-400/30 px-4 py-2 text-cyan-200" onClick={() => setLimit(n => n + 20)}>{text("Show more", "显示更多")}</button>}
  </main>;
}
