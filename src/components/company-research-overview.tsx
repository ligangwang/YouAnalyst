import Link from "next/link";
import type { ReactNode } from "react";
import type { CompanyResearch } from "@/lib/company-research";
import { CompanyCallActions } from "./company-call-actions";

export function CompanyResearchOverview({ company, fundamentals }: { company: CompanyResearch; fundamentals?: ReactNode }) {
  const facts = [["Ticker", company.ticker], ["Exchange", company.exchange], ["Currency", company.currency],
    ["Country", company.country], ["Security", company.securityType], ["Map segment", company.segment]].filter(([, value]) => value);
  return <>
    <header className="border-b border-white/15 pb-6">
      <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap gap-2 text-sm text-cyan-200">
        <Link href="/">YouAnalyst</Link><span aria-hidden="true">/</span><Link href="/companies">Companies</Link><span aria-hidden="true">/</span><span className="text-slate-300">{company.ticker}</span>
      </nav>
      <p className="text-sm font-semibold text-cyan-300">Company research</p>
      <h1 className="mt-2 break-words font-[var(--font-sora)] text-3xl font-semibold leading-tight text-white">{company.name}{company.name !== company.ticker ? ` (${company.ticker})` : ""}</h1>
      <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-4 text-sm">
        {facts.map(([label, value]) => <div key={label}><dt className="text-slate-400">{label}</dt><dd className="mt-1 font-medium text-slate-100">{value}</dd></div>)}
      </dl>
      {company.listingUpdatedAt && <p className="mt-3 text-xs text-slate-400">Listing data synced {company.listingUpdatedAt.slice(0, 10)}.</p>}
      {!company.known && <p className="mt-3 text-sm text-slate-400">Company listing details are not available for this symbol.</p>}
      {company.inMap && <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-cyan-200">
        <Link href={`/map?company=${encodeURIComponent(company.ticker)}`} className="underline underline-offset-4">Explore {company.ticker} on the company map</Link>
      </div>}
      <CompanyCallActions ticker={company.ticker} />
      <nav aria-label="Company research sections" className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm text-cyan-200">
        {fundamentals && <a href="#company-fundamentals">Business and financials</a>}
        {company.inMap && <a href="#company-relationships">Company relationships</a>}
        <a href="#insider-transactions">Insider transactions</a>
        <a href="#institutional-holdings">Institutional holdings</a>
      </nav>
    </header>
    {fundamentals}
    {company.inMap && <section aria-labelledby="company-relationships" className="border-b border-white/15 py-6">
      <h2 id="company-relationships" className="scroll-mt-24 text-xl font-semibold text-cyan-100">{company.ticker} suppliers, customers and competitors</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{company.connections.length ? `${company.connections.length} relationships in the loaded sources. ` : ""}These are AI-assisted research and filing claims, not a complete or independently verified account of the business. Source dates do not establish whether a relationship remains active.</p>
      {!company.connections.length && <p className="mt-3 text-sm text-slate-400">{company.graphAvailable ? "No published relationships are available for this company yet." : "Filing relationships are temporarily unavailable."}</p>}
      <div className="mt-4 divide-y divide-white/10">
        {company.connections.slice(0, 12).map((connection) => <article key={connection.id} className="py-4">
          <h3 className="text-sm font-semibold text-slate-100">{connection.label}</h3>
          {connection.related.ticker && <Link href={`/ticker/${encodeURIComponent(connection.related.ticker)}`} className="mt-1 inline-block text-sm text-cyan-200 underline underline-offset-4">Research {connection.related.name} ({connection.related.ticker})</Link>}
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-cyan-200">{connection.evidence.some(e => e.sourceKind === "web") ? "Sources" : "Filing evidence"} ({connection.evidence.length})</summary>
            {connection.evidence.map((evidence) => <div key={evidence.id} className="mt-3 max-w-3xl border-l-2 border-cyan-700 pl-4">
              <p className="text-xs text-slate-400">{evidence.issuerTicker} {evidence.sourceKind === "web" ? "industry research summary" : "filing"} · {evidence.filingDate}</p>
              {evidence.sourceKind === "web" ? <p className="mt-2 break-words leading-6 text-slate-300">{evidence.quote}</p> : <blockquote className="mt-2 break-words leading-6 text-slate-300">{evidence.quote}</blockquote>}
              {evidence.nameMatched && <p className="mt-2 text-xs text-amber-200">Company identity is based on a provisional name match.</p>}
              {evidence.qualityReview && <p className="mt-2 text-xs text-amber-200">Evidence reviewed {evidence.qualityReview.reviewedAt}: {evidence.qualityReview.reason}</p>}
              <a href={evidence.filingUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-cyan-200 underline underline-offset-4">{evidence.sourceKind === "web" ? evidence.sourceTitle ?? "Read source" : "Read SEC filing"}</a>
            </div>)}
          </details>
        </article>)}
      </div>
      {company.connections.length > 12 && <Link href={`/map?company=${encodeURIComponent(company.ticker)}`} className="mt-3 inline-block text-sm text-cyan-200 underline underline-offset-4">View all {company.connections.length} relationships on the map</Link>}
    </section>}
  </>;
}
