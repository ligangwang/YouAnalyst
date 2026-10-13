"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { companyPathByName } from "@/lib/companies";
import type { CompanyGraphEdge, CompanyGraphRelationshipType } from "@/lib/company-graph/types";

type GraphResponse = {
  edges: CompanyGraphEdge[];
  filing: { filingUrl: string | null; filingDate: string | null } | null;
};

const LABELS: Record<CompanyGraphRelationshipType, string> = {
  SUPPLIER_OF: "Supplier", CUSTOMER_OF: "Customer", COMPETES_WITH: "Competitor",
  PARTNER_OF: "Partner", DISTRIBUTES_FOR: "Distributor", MANUFACTURES_FOR: "Manufacturer",
};
const VERBS: Record<CompanyGraphRelationshipType, string> = {
  SUPPLIER_OF: "supplies", CUSTOMER_OF: "buys from", COMPETES_WITH: "competes with",
  PARTNER_OF: "partners with", DISTRIBUTES_FOR: "distributes for", MANUFACTURES_FOR: "manufactures for",
};

function sourceUrl(edge: CompanyGraphEdge, filingUrl?: string | null) {
  if (/^\d{1,10}$/.test(edge.sourceCik) && /^\d{10}-\d{2}-\d{6}$/.test(edge.accessionNumber)) {
    return `https://www.sec.gov/Archives/edgar/data/${Number(edge.sourceCik)}/${edge.accessionNumber.replace(/-/g, "")}/${edge.accessionNumber}-index.html`;
  }
  if (!filingUrl) return null;
  try {
    const url = new URL(filingUrl);
    return url.protocol === "https:" && url.hostname === "www.sec.gov" ? url.href : null;
  } catch { return null; }
}

export function CompanyRelationships({ ticker, companyName }: { ticker: string; companyName: string }) {
  const [result, setResult] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [includeCategories, setIncludeCategories] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/company-graph/${encodeURIComponent(ticker)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Company relationships are temporarily unavailable.");
        return await response.json() as GraphResponse;
      })
      .then((payload) => { if (!controller.signal.aborted) setResult(payload); })
      .catch(() => { if (!controller.signal.aborted) setError("Company relationships are temporarily unavailable."); });
    return () => controller.abort();
  }, [ticker, reload]);

  const edges = useMemo(() => (result?.edges ?? []).filter((edge) =>
    (includeCategories || edge.targetType === "company") &&
    (filter === "all" || edge.relationshipType === filter) &&
    edge.targetName.toLowerCase().includes(search.trim().toLowerCase()),
  ), [result, includeCategories, filter, search]);
  const companyCount = new Set((result?.edges ?? []).filter((edge) => edge.targetType === "company").map((edge) => edge.targetName.toLowerCase())).size;

  return (
    <section id="relationships" className="mt-6 scroll-mt-28 rounded-2xl border border-cyan-400/20 bg-slate-950/55 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Business network</p>
          <h2 className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-white">Company relationships</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Explore named counterparties and the filing evidence behind each connection.</p>
        </div>
        {result ? <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1.5 text-sm text-cyan-100">{companyCount} named {companyCount === 1 ? "company" : "companies"}</span> : null}
      </div>

      <p className="mt-4 rounded-lg bg-white/5 px-3 py-2 text-xs leading-5 text-slate-400">
        Coverage: supply chain, competitors, and partners extracted from a saved 10-K. Ownership, financing, deals, and legal relationships are not yet covered here. Disclosures may be incomplete or historical.
      </p>

      {error ? (
        <div role="alert" className="mt-5 rounded-xl border border-rose-400/25 p-4 text-sm text-rose-200">
          {error} <button type="button" onClick={() => { setResult(null); setError(null); setReload((value) => value + 1); }} className="ml-2 underline">Retry</button>
        </div>
      ) : !result ? (
        <p role="status" className="mt-5 text-sm text-slate-400">Loading disclosed relationships…</p>
      ) : !result.edges.length ? (
        <div className="mt-5 rounded-xl border border-dashed border-white/15 p-6">
          <h3 className="font-semibold text-slate-200">No relationship research published yet</h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">There is no saved relationship coverage for {companyName}. This does not mean the company has no business relationships.</p>
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="text-xs text-slate-400">Find a counterparty
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search company names" className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300" />
            </label>
            <label className="text-xs text-slate-400">Relationship type
              <select value={filter} onChange={(event) => setFilter(event.target.value)} className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2.5 text-sm text-white focus:border-cyan-300">
                <option value="all">All types</option>
                {Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={includeCategories} onChange={(event) => setIncludeCategories(event.target.checked)} />
            Include unnamed industry groups
          </label>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {edges.map((edge) => {
              const targetPath = edge.targetType === "company" ? companyPathByName(edge.targetName) : null;
              const reverse = edge.direction === "target_to_source";
              const subject = reverse ? edge.targetName : companyName;
              const object = reverse ? companyName : edge.targetName;
              const url = sourceUrl(edge, result.filing?.filingUrl);
              return (
                <article key={edge.id} className="rounded-xl border border-white/10 bg-slate-900/55 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-cyan-300">{LABELS[edge.relationshipType]}</span>
                    {edge.targetType === "category" ? <span className="text-xs text-amber-200">Industry group</span> : null}
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-white">
                    {targetPath ? <Link href={targetPath} className="hover:text-cyan-200">{edge.targetName} <span aria-hidden="true">↗</span></Link> : edge.targetName}
                  </h3>
                  <p className="mt-1 text-sm text-slate-300">{subject} {VERBS[edge.relationshipType]} {object}.</p>
                  <details className="mt-4 border-t border-white/10 pt-3 text-sm">
                    <summary className="cursor-pointer text-cyan-200">Filing evidence</summary>
                    <blockquote className="mt-3 border-l-2 border-cyan-400/30 pl-3 leading-6 text-slate-300">{edge.evidenceText}</blockquote>
                    <p className="mt-3 text-xs leading-5 text-slate-400">{edge.filingType} · Filed {edge.filingDate || "date unavailable"}{edge.reportDate ? ` · Reporting date ${edge.reportDate}` : ""}</p>
                    {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-cyan-200 underline">Open SEC source ↗</a> : null}
                  </details>
                </article>
              );
            })}
          </div>
          {!edges.length ? <p role="status" className="mt-5 text-sm text-slate-400">No relationships match these filters. Try another type or include industry groups.</p> : null}
        </>
      )}
    </section>
  );
}
