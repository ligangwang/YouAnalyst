"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "./providers/locale-provider";
import { LocalizedLink as Link } from "./localized-link";
import { companyName, type KnowledgeGraph } from "@/lib/knowledge-graph/model";
import { mostConnectedCompanies } from "@/lib/knowledge-graph/most-connected";
import { companyPageUrl } from "@/lib/market-companies/routes";

// Reads the same AI-map graph the map page loads; the section stays hidden if it is unavailable.
export function MostConnectedCompanies({ limit = 10 }: { limit?: number }) {
  const { text, locale } = useLocale();
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/knowledge-graph", { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(); return response.json() as Promise<KnowledgeGraph>; })
      .then(data => { setGraph(data); setStatus("ready"); })
      .catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, []);
  const ranked = useMemo(() => graph ? mostConnectedCompanies(graph, limit) : [], [graph, limit]);
  if (status === "error" || (status === "ready" && !ranked.length)) return null;
  return <section aria-labelledby="most-connected-heading" className="mt-10">
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 id="most-connected-heading" className="text-lg font-semibold text-slate-100">{text("Most-connected companies on the AI map", "AI 图谱中关系最多的公司")}</h2>
        <p className="mt-1 text-sm text-slate-400">{text("Ranked by documented supply-chain and partnership connections.", "按已收录的供应链与合作关系数量排序。")}</p>
      </div>
      <Link href="/" className="text-sm text-cyan-200 hover:underline">{text("Explore the AI map", "查看 AI 图谱")} →</Link>
    </div>
    {status === "loading"
      ? <p role="status" className="mt-4 text-sm text-slate-400">{text("Loading AI map companies…", "正在加载 AI 图谱公司…")}</p>
      : <ol className="mt-4 grid gap-2 sm:grid-cols-2" data-testid="most-connected-companies">
        {ranked.map(({ company, connections, layer }, index) => <li key={company.id}>
          <Link
            href={companyPageUrl(company.id.startsWith("US:") ? company.symbol ?? company.id.slice(3) : company.id, company.market)}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2.5 transition hover:border-cyan-300/60 hover:bg-cyan-500/10"
          >
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-slate-500">{index + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-cyan-50">{companyName(company, locale)}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                {company.symbol && <span className="font-medium text-slate-300">{company.symbol}</span>}
                {layer && <span className="inline-flex items-center gap-1"><i aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: layer.color }} />{text(layer.en, layer.zh)}</span>}
              </span>
            </span>
            <span className="shrink-0 text-right text-xs text-slate-400"><span className="block text-sm font-semibold tabular-nums text-cyan-100">{connections}</span>{connections === 1 ? text("connection", "项关系") : text("connections", "项关系")}</span>
          </Link>
        </li>)}
      </ol>}
  </section>;
}
