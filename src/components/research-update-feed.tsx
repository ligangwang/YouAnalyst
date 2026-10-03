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
  const entries = useMemo(() => orderFeed(groupFeedUpdates(items)), [items]);
  return <main className="mx-auto max-w-5xl px-4 py-8">
    <h1 className="text-3xl font-semibold text-cyan-100">{text("Company research updates", "公司研究动态")}</h1>
    <p className="mt-3 text-sm text-slate-400">{text("Sourced AI supply-chain developments, ordered by source publication date.", "有来源的 AI 产业链进展，按来源发布日期排列。")}</p>
    <div className="my-6 flex flex-wrap items-center justify-between gap-4">
      <nav className="flex gap-5 text-cyan-200"><Link href="/feed">{text("All updates", "全部动态")}</Link><Link href="/feed?scope=following">{text("Following", "我关注的")}</Link></nav>
    </div>
    {graph && <ResearchChangeSummary graph={graph} items={items} />}
    {!graph ? <p role="status">{text("Research updates are temporarily unavailable. Please try again later.", "研究动态暂时无法加载，请稍后重试。")}</p> : !entries.length ? <p>{text("No reliable updates available yet.", "暂无可核实的更新。")}</p> : <ol className="space-y-4">{entries.slice(0, limit).map(entry => <li key={entry.item.id}><CompanyChangeCard item={entry.item} evidence={entry.evidence} graph={graph} publicFeed /></li>)}</ol>}
    {entries.length > limit && <button className="mt-6 rounded-full border border-cyan-400/30 px-4 py-2 text-cyan-200" onClick={() => setLimit(n => n + 20)}>{text("Show more", "显示更多")}</button>}
  </main>;
}
