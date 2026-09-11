"use client";

import { useEffect, useState } from "react";
import { useLocale } from "./providers/locale-provider";
import type { ChinaCompany } from "@/lib/industry-research/china";
import overview from "./all-markets-overview.module.css";
import { matchesCompanySearch } from "@/lib/knowledge-graph/model";

export function ChinaSupplyChain({ embedded = false }: { embedded?: boolean }) {
  const Container = embedded ? "section" : "main";
  const { text } = useLocale();
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("");
  const [directory, setDirectory] = useState<ChinaCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setFailed(false);
      try {
        const items: ChinaCompany[] = [];
        let cursor: string | null = "";
        do {
          const response: Response = await fetch(`/api/market-companies${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { signal: controller.signal, cache: "no-store" });
          if (!response.ok) throw new Error("directory");
          const payload: { items: ChinaCompany[]; nextCursor: string | null } = await response.json();
          items.push(...payload.items); cursor = payload.nextCursor;
        } while (cursor);
        if (!controller.signal.aborted) setDirectory(items);
      } catch { if (!controller.signal.aborted) setFailed(true); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [retry]);
  const companies = directory.filter(company => (!stage || company.stage === stage) && matchesCompanySearch(company.searchText ?? `${company.name} ${company.en ?? ""} ${company.id} ${company.description} ${company.descriptionEn ?? ""} ${company.stage} ${company.stageEn ?? ""}`, query));
  return <Container id={embedded ? "a-share-companies" : undefined} aria-labelledby={embedded ? "a-share-heading" : undefined} className="mx-auto max-w-6xl px-4 py-10 sm:py-16">
    {embedded ? <header className={overview.sectionHeading}><h2 id="a-share-heading">{text("A-share companies", "A 股公司")}</h2><p>{text("Explore business roles and original disclosures.", "了解产业环节，查看原始披露。")}</p></header> : <>
    <p className="text-xs font-medium tracking-widest text-cyan-200">{text("CHINA · A-SHARES", "中国 · A 股")}</p>
    <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">{text("Explore A-share industries", "探索 A 股产业")}</h1>
    <p className="mt-5 max-w-2xl text-base leading-8 text-slate-400">{text("Discover companies by their business and industry role. Start with the overview, then read the evidence.", "按业务与产业环节发现公司。先了解业务，再查看原始披露。")}</p></>}
    <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <label className="w-full sm:max-w-sm"><span className="sr-only">{text("Search A-shares", "搜索 A 股公司")}</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={text("Company, ticker or business", "搜索公司、代码或业务")} className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none focus:border-cyan-300" /></label>
      <span className="text-xs text-slate-400">{!loading && !failed ? `${companies.length} / ${directory.length} · ` : ""}{text("Same companies as the AI graph", "与 AI 图谱使用同一公司名单")}</span>
    </div>
    <div className="my-6 flex flex-wrap gap-2" role="group" aria-label={text("Industry stages", "产业环节")}>
      {[{ stage: "", stageEn: "All" }, ...new Map(directory.map(c => [c.stage, c])).values()].map(item => <button key={item.stage} type="button" aria-pressed={stage === item.stage} onClick={() => setStage(item.stage)} className={`rounded-full border px-4 py-2 text-sm transition-colors ${stage === item.stage ? "border-white/30 bg-white/15 text-white" : "border-white/10 text-slate-400 hover:bg-white/5"}`}>{item.stage || text("All", "全部")}</button>)}
    </div>
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {companies.map(company => <article key={company.id} className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.025] p-6 transition-colors hover:border-white/25">
        <p className="text-xs text-cyan-200">{company.stage}</p>
        <h2 className="mt-4 text-2xl font-medium">{company.name}</h2>
        <p className="mt-2 text-xs tabular-nums text-slate-400">{company.id.split(":")[1]} · {company.id.startsWith("XSHG") ? text("Shanghai", "上交所") : text("Shenzhen", "深交所")}</p>
        <p className="mb-6 mt-5 flex-1 text-sm leading-7 text-slate-300">{company.description}</p>
        <a href={company.source} target="_blank" rel="noopener noreferrer" className="border-t border-white/10 pt-4 text-xs leading-6 text-slate-400 hover:text-cyan-200">{company.sourceLabel} <span aria-hidden="true">↗</span><span className="sr-only">{text(" (opens in a new tab)", "（新窗口打开）")}</span></a>
      </article>)}
    </div>
    {loading && <p role="status" className="py-12 text-center text-slate-400">{text("Loading companies…", "正在加载公司…")}</p>}
    {failed && <div role="alert" className="py-8 text-center text-slate-400"><p>{text("Companies could not be loaded.", "暂时无法加载公司。")}</p><button className="mt-3 text-cyan-200 underline" onClick={() => setRetry(n => n + 1)}>{text("Try again", "重试")}</button></div>}
    {!loading && !failed && !companies.length && <p role="status" className="py-12 text-center text-slate-400">{directory.length ? text("No matching companies. Try another name or stage.", "没有匹配的公司，试试其他名称或产业环节。") : text("No companies have been published yet.", "暂未发布公司。")}</p>}
    <p className="mt-8 max-w-3xl text-xs leading-6 text-slate-500">{text("This is a curated industry landscape, not a complete list or a claim that these companies supply one another. Sources describe business roles; they do not establish investment merit. A-share live prices and call tracking are not yet available.", "本图按产业环节整理首批公司，不代表完整名单，也不表示这些公司之间存在供货关系。业务归类不等于投资价值判断。A 股实时行情与观点收益跟踪尚未接入。")}</p>
  </Container>;
}
