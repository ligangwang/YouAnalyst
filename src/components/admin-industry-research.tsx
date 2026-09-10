"use client";

import { UiText, useUiText } from "@/components/ui-text";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { RELATIONSHIP_LABELS } from "@/lib/industry-graph/model";
import type { ResearchResult } from "@/lib/industry-research/model";
import { RESEARCH_SECTORS, TAXONOMY_SOURCE, type ResearchTopic } from "@/lib/industry-research/taxonomy";
import { INDUSTRY_SEGMENTS } from "@/lib/industry-graph/catalog";

type Run = { id: string; industry: string; topic?: ResearchTopic; status: string; model?: string; responseId?: string; createdAt: string; result?: ResearchResult; error?: string; searchCalls?: number; publishedIds?: string[] };
const control = "rounded-md border border-white/20 px-3 py-2 text-sm disabled:opacity-50";
export function AdminIndustryResearch() {
  const ui = useUiText();
  const { user, loading, getIdToken } = useAuth();
  const [industry, setIndustry] = useState("AI data-center supply chain");
  const [sectorCode, setSectorCode] = useState("45");
  const [industryCode, setIndustryCode] = useState("453010");
  const [filterSector, setFilterSector] = useState("");
  const sector = RESEARCH_SECTORS.find(s => s.code === sectorCode);
  const [runs, setRuns] = useState<Run[]>([]);
  const [runsOwner, setRunsOwner] = useState<string | null>(null);
  const [active, setActive] = useState<string>("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const requestTopic = useRef("");
  const api = useCallback(async (body?: unknown) => {
    const token = await getIdToken();
    if (!token) throw new Error("Sign in with an admin account.");
    const response = await fetch("/api/admin/industry-research", { method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Research request failed.");
    return payload;
  }, [getIdToken]);
  const reload = useCallback(async () => {
    const payload = await api();
    setRuns(payload.items);
    setRunsOwner(user?.uid ?? null);
    setActive(current => current || payload.items[0]?.id || "");
  }, [api, user?.uid]);
  useEffect(() => {
    if (!loading && user) void reload().catch(e => setError(e.message));
  }, [loading, user, reload]);
  const visibleRuns = user && runsOwner === user.uid ? runs : [];
  const filteredRuns = visibleRuns.filter(r => !filterSector || (filterSector === "custom" ? !r.topic?.sectorCode : r.topic?.sectorCode === filterSector));
  const run = filteredRuns.find(r => r.id === active);
  useEffect(() => {
    if (run?.status !== "PROCESSING") return;
    let stopped = false;
    const timer = setTimeout(() => {
      void api({ action: "refresh", id: run.id }).then(payload => {
        if (!stopped) setRuns(current => current.map(r => r.id === payload.item.id ? payload.item : r));
      }).catch(e => { if (!stopped) setError(e.message); });
    }, 10000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [run, api]);
  async function act(action: "start" | "refresh" | "publish") {
    setBusy(true); setError("");
    try {
      const topicKey = JSON.stringify([sectorCode, industryCode, industry.trim()]);
      if (action === "start" && requestTopic.current !== topicKey) { requestId.current = null; requestTopic.current = topicKey; }
      requestId.current ??= crypto.randomUUID();
      const payload = await api({ action, industry, category: sector ? { sectorCode, industryCode } : null, requestId: requestId.current, id: active, selectedIds: selected });
      if (action === "start") requestId.current = null;
      setRuns(current => [payload.item, ...current.filter(r => r.id !== payload.item.id)]);
      setRunsOwner(user?.uid ?? null);
      setFilterSector(""); setActive(payload.item.id); setSelected([]);
    } catch (e) { setError(e instanceof Error ? e.message : "Research request failed."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-6xl px-4 py-8 text-slate-100">
    <h1 className="text-2xl font-semibold"><UiText text={"Industry research"} /></h1>
    <div className="my-5 flex flex-wrap items-end gap-3">
      <label className="flex min-w-0 basis-full flex-col gap-1 text-sm sm:basis-64"><UiText text={"Sector"} /><select value={sectorCode} disabled={busy} onChange={e => { setSectorCode(e.target.value); setIndustryCode(RESEARCH_SECTORS.find(s => s.code === e.target.value)?.industries[0][0] ?? ""); setIndustry(""); }} className={`${control} w-full bg-slate-950`}>
          {RESEARCH_SECTORS.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
          <option value="custom"><UiText text={"Custom / cross-industry"} /></option>
        </select>
      </label>
      {sector && <label className="flex min-w-0 flex-1 basis-full flex-col gap-1 text-sm sm:basis-72"><UiText text={"Industry"} /><select value={industryCode} disabled={busy} onChange={e => { setIndustryCode(e.target.value); setIndustry(""); }} className={`${control} w-full bg-slate-950`}>
          {sector.industries.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>}
      <label className="flex min-w-0 basis-full flex-col gap-1 text-sm">{sector ? <UiText text={"Research scope (optional)"} /> : <UiText text={"Custom research topic"} />}
        <input value={industry} disabled={busy} maxLength={120} onChange={e => setIndustry(e.target.value)} className={`${control} w-full bg-slate-950`} />
      </label>
      <button className={`${control} bg-cyan-500 text-slate-950`} disabled={busy || !user || (!sector && industry.trim().length < 3)} onClick={() => void act("start")}><UiText text={"Research industry"} /></button>
      <button className={control} disabled={busy || !user} onClick={() => void reload().catch(e => setError(e.message))}><UiText text={"Refresh runs"} /></button>
    </div>
    <p className="text-sm text-slate-400"><UiText text={"Paid research · maximum 3 batches/day · 8 tool calls and 12,000 output tokens/batch · US-listed companies and ADRs"} /></p>
    <a href={TAXONOMY_SOURCE} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-cyan-200 underline"><UiText text={"GICS sector and industry reference"} /></a>
    {!loading && !user && <p role="alert" className="mt-4"><UiText text={"Sign in with an admin account."} /></p>}
    {error && <p role="alert" className="my-4 text-rose-300">{<UiText text={error} />}</p>}
    <label className="mt-5 flex flex-col gap-1 text-sm"><UiText text={"Recent runs by sector"} /><select className={`${control} w-full bg-slate-950`} value={filterSector} onChange={e => { setFilterSector(e.target.value); setActive(""); setSelected([]); }}>
        <option value=""><UiText text={"All sectors"} /></option>
        {RESEARCH_SECTORS.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
        <option value="custom"><UiText text={"Custom / uncategorized"} /></option>
      </select>
    </label>
    <label className="my-5 flex min-w-0 flex-col gap-1 text-sm"><UiText text={"Research run"} /><select className={`${control} w-full bg-slate-950`} value={run?.id ?? ""} onChange={e => { setActive(e.target.value); setSelected([]); }}>
        <option value=""><UiText text={"Select a run"} /></option>
        {filteredRuns.map(r => <option value={r.id} key={r.id}>{r.industry} · {<UiText text={r.status} />} · {r.createdAt.slice(0, 10)}</option>)}
      </select>
    </label>
    {run && <section>
      <p className="mb-3 break-words text-sm text-slate-300">{run.topic?.sectorName ? `${run.topic.sectorName} / ${run.topic.industryName}` : <UiText text={"Custom / uncategorized"} />}</p>
      <div className="flex flex-wrap items-center gap-3 border-y border-white/15 py-3">
        <strong>{<UiText text={run.status} />}</strong><span>{run.model ?? <UiText text={"Model pending"} />}</span>
        {run.searchCalls !== undefined && <span>{run.searchCalls}<UiText text={" search tool calls"} /></span>}
        <button className={control} disabled={busy || !run.responseId || !["PROCESSING", "FAILED"].includes(run.status)} onClick={() => void act("refresh")}><UiText text={"Check status"} /></button>
      </div>
      {run.error && <p className="my-4 text-rose-300">{<UiText text={run.error} />}</p>}
      {run.result && <>
        <p className="my-4 text-sm">{run.result.companies.length}<UiText text={" companies · "} />{run.result.relationships.length}<UiText text={" sourced candidates · "} />{run.result.withheld}<UiText text={" withheld"} /></p>
        <details className="mb-4 text-sm">
          <summary className="cursor-pointer"><UiText text={"Company map categories"} /></summary>
          <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">{run.result.companies.map(c => <div key={c.ticker} className="flex flex-wrap justify-between gap-2 border-b border-white/10 py-2">
            <dt>{c.ticker}</dt><dd>{INDUSTRY_SEGMENTS.find(s => s.id === c.segment)?.label ?? <UiText text={"Related companies"} />}</dd>
          </div>)}</dl>
        </details>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr className="border-b border-white/15"><th className="p-2"><UiText text={"Reviewed"} /></th><th className="p-2"><UiText text={"Connection"} /></th><th className="p-2"><UiText text={"Source and research summary"} /></th></tr></thead>
          <tbody>{run.result.relationships.map(r => <tr key={r.id} className="border-b border-white/10 align-top">
            <td className="p-2"><input type="checkbox" aria-label={ui(`Approve ${r.source} ${RELATIONSHIP_LABELS[r.type]} ${r.target}`)} checked={selected.includes(r.id)} disabled={busy} onChange={e => setSelected(current => e.target.checked ? [...current, r.id] : current.filter(id => id !== r.id))} />{run.publishedIds?.includes(r.id) && <span className="ml-2 text-emerald-300"><UiText text={"Published"} /></span>}</td>
            <td className="min-w-40 p-2">{r.source} {<UiText text={RELATIONSHIP_LABELS[r.type]} />} {r.target}<p className="mt-1 text-xs text-slate-400">{run.result?.companies.find(c => c.ticker === r.source)?.name} / {run.result?.companies.find(c => c.ticker === r.target)?.name}</p></td>
            <td className="min-w-64 max-w-xl p-2">{r.evidence.map(e => <div key={e.url} className="mb-3">
              <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-cyan-200 underline">{e.title}</a>
              <p className="mt-1 text-slate-300">{e.summary}</p><span className="text-xs text-slate-400">{e.sourceDate ?? <UiText text={"Publication date not supplied"} />}</span>
            </div>)}</td>
          </tr>)}</tbody>
        </table></div>
        <button className={`${control} mt-5 bg-emerald-600`} disabled={busy || !selected.length} onClick={() => void act("publish")}><UiText text={"Publish "} />{selected.length}<UiText text={" reviewed connections"} /></button>
      </>}
    </section>}
  </main>;
}
