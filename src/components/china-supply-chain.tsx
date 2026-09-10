"use client";

import { useState } from "react";
import { useLocale } from "./providers/locale-provider";
import { chinaSupplyChain } from "@/lib/industry-graph/china";

export function ChinaSupplyChain() {
  const { text, chinese } = useLocale();
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("");
  const companies = chinaSupplyChain.filter(company => (!stage || company.stage === stage) && `${company.name} ${company.en} ${company.id} ${company.description} ${company.stageEn}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <main className="mx-auto max-w-6xl px-4 py-10 sm:py-16">
    <p className="text-xs font-medium tracking-widest text-cyan-200">{text("CHINA · A-SHARES", "中国 · A 股")}</p>
    <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-5xl">{text("Inside the AI supply chain", "看懂 AI 产业链")}</h1>
    <p className="mt-5 max-w-2xl text-base leading-8 text-slate-400">{text("Explore the companies behind compute, connections and cooling. Start with their business, then read the evidence.", "从芯片、互连到服务器与散热，发现算力背后的公司。先了解业务，再查看原始披露。")}</p>
    <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <label className="w-full sm:max-w-sm"><span className="sr-only">{text("Search A-shares", "搜索 A 股公司")}</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={text("Company, ticker or business", "搜索公司、代码或业务")} className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none focus:border-cyan-300" /></label>
      <span className="text-xs text-slate-400">{text("Curated starting set · Sources reviewed Sep 10, 2026", "首批精选 · 来源核对于 2026 年 9 月 10 日")}</span>
    </div>
    <div className="my-6 flex flex-wrap gap-2" role="group" aria-label={text("Industry stages", "产业环节")}>
      {[{ stage: "", stageEn: "All", name: "全部" }, ...chinaSupplyChain].map(item => <button key={item.stage} type="button" aria-pressed={stage === item.stage} onClick={() => setStage(item.stage)} className={`rounded-full border px-4 py-2 text-sm transition-colors ${stage === item.stage ? "border-white/30 bg-white/15 text-white" : "border-white/10 text-slate-400 hover:bg-white/5"}`}>{chinese ? item.stage || "全部" : item.stageEn}</button>)}
    </div>
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {companies.map(company => <article key={company.id} className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.025] p-6 transition-colors hover:border-white/25">
        <p className="text-xs text-cyan-200">{chinese ? company.stage : company.stageEn}</p>
        <h2 className="mt-4 text-2xl font-medium">{chinese ? company.name : company.en}</h2>
        <p className="mt-2 text-xs tabular-nums text-slate-400">{company.id.split(":")[1]} · {company.id.startsWith("XSHG") ? text("Shanghai", "上交所") : text("Shenzhen", "深交所")}</p>
        <p className="mb-6 mt-5 flex-1 text-sm leading-7 text-slate-300">{chinese ? company.description : company.descriptionEn}</p>
        <a href={company.source} target="_blank" rel="noopener noreferrer" className="border-t border-white/10 pt-4 text-xs leading-6 text-slate-400 hover:text-cyan-200">{chinese ? company.sourceLabel : company.sourceLabelEn} <span aria-hidden="true">↗</span><span className="sr-only">{text(" (opens in a new tab)", "（新窗口打开）")}</span></a>
      </article>)}
    </div>
    {!companies.length && <p role="status" className="py-12 text-center text-slate-400">{text("No matching companies. Try another name or stage.", "没有匹配的公司，试试其他名称或产业环节。")}</p>}
    <p className="mt-8 max-w-3xl text-xs leading-6 text-slate-500">{text("This is a curated industry landscape, not a complete list or a claim that these companies supply one another. Sources describe business roles; they do not establish investment merit. A-share live prices and call tracking are not yet available.", "本图按产业环节整理首批公司，不代表完整名单，也不表示这些公司之间存在供货关系。业务归类不等于投资价值判断。A 股实时行情与观点收益跟踪尚未接入。")}</p>
  </main>;
}
