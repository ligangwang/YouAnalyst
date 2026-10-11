"use client";

import { useMemo, useState } from "react";
import { useLocale } from "./providers/locale-provider";
import { AiKnowledgeGraph } from "./ai-knowledge-graph";
import { CompanyResearchTimeline } from "./company-timeline";
import { CompanyResearchPanel } from "./company-research-panel";
import type { KnowledgeGraph } from "@/lib/knowledge-graph/model";
import type { TimelinePrices } from "@/lib/ui/company-timeline";

export function CompanyTimelinePreview({ graph }: { graph: KnowledgeGraph }) {
  const { text } = useLocale();
  const [companyId, setCompanyId] = useState("US:AMD");
  const [page, setPage] = useState(false);
  const company = graph.nodes.find(n => n.id === companyId)!;
  const prices = useMemo<TimelinePrices>(() => {
    const end = "2026-10-09", start = "2021-10-09", bars = [];
    for (let i = 0; i <= 1826; i++) {
      const date = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000);
      if (date.toISOString().slice(0, 10) > end || [0, 6].includes(date.getUTCDay())) continue;
      bars.push({ date: date.toISOString().slice(0, 10), close: Number((55 + i * .055 + 11 * Math.sin(i / 32) + 5 * Math.cos(i / 9)).toFixed(2)), volume: Math.round(20_000_000 + 24_000_000 * Math.abs(Math.sin(i / 17)) + (i % 31 === 0 ? 45_000_000 : 0)) });
    }
    return { companyId, start, end, prices: bars, currency: "USD", available: true };
  }, [companyId]);
  return <>
    <div className="mx-auto max-w-6xl px-4 pt-6"><p className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-200">{text("Local design preview. Event evidence comes from the repository; price and volume are illustrative. This preview is disabled in production.", "本地设计预览。事件依据来自代码库；股价和成交量为示例数据。生产环境禁用此预览。")}</p>
      <div className="my-4 flex flex-wrap gap-3"><label className="text-sm text-slate-300">{text("Company", "公司")} <select className="ml-2 rounded-lg border border-white/20 bg-slate-900 p-2" value={companyId} onChange={e => setCompanyId(e.target.value)}><option value="US:AMD">{"AMD"}</option><option value="US:NVDA">{"NVIDIA"}</option><option value="US:CRWV">{"CoreWeave"}</option></select></label><button className="rounded-lg border border-cyan-700 px-4 py-2 text-sm text-cyan-200" onClick={() => setPage(value => !value)}>{page ? text("Show graph / tree / hierarchy / list", "查看图谱／树形／层级／列表") : text("Show company page", "查看公司页面")}</button></div>
    </div>
    {page ? <main className="mx-auto max-w-5xl px-4 pb-12"><h1 className="text-3xl text-slate-100">{company.name} {text("company research", "公司研究")}</h1><CompanyResearchTimeline company={company} graph={graph} initialPrices={prices} /><CompanyResearchPanel companyId={companyId} initialGraph={graph} /></main> : <AiKnowledgeGraph key={companyId} initialCompany={companyId} initialGraph={graph} previewPrices={prices} />}
  </>;
}
