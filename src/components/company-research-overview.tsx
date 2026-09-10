
import { UiText } from "@/components/ui-text";
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
        <Link href="/">YouAnalyst</Link><span aria-hidden="true">/</span><Link href="/companies"><UiText text={"Companies"} /></Link><span aria-hidden="true">/</span><span className="text-slate-300">{company.ticker}</span>
      </nav>
      <p className="text-sm font-semibold text-cyan-300"><UiText text={"Company research"} /></p>
      <h1 className="mt-2 break-words font-[var(--font-sora)] text-3xl font-semibold leading-tight text-white">{company.name}{company.name !== company.ticker ? ` (${company.ticker})` : ""}</h1>
      <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-4 text-sm">
        {facts.map(([label, value]) => <div key={label}><dt className="text-slate-400"><UiText text={label} /></dt><dd className="mt-1 font-medium text-slate-100">{value}</dd></div>)}
      </dl>
      {company.listingUpdatedAt && <p className="mt-3 text-xs text-slate-400"><UiText text={"Listing data synced "} />{company.listingUpdatedAt.slice(0, 10)}.</p>}
      {!company.known && <p className="mt-3 text-sm text-slate-400"><UiText text={"Company listing details are not available for this symbol."} /></p>}
      {company.inMap && <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-cyan-200">
        <Link href={`/map?company=${encodeURIComponent(company.ticker)}`} className="underline underline-offset-4"><UiText text={"Explore "} />{company.ticker}<UiText text={" on the company map"} /></Link>
      </div>}
      <CompanyCallActions ticker={company.ticker} />
      <nav aria-label="Company research sections" className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm text-cyan-200">
        {fundamentals && <a href="#company-fundamentals"><UiText text={"Business and financials"} /></a>}
        {company.inMap && <a href="#company-relationships"><UiText text={"Company relationships"} /></a>}
        <a href="#insider-transactions"><UiText text={"Insider transactions"} /></a>
        <a href="#institutional-holdings"><UiText text={"Institutional holdings"} /></a>
      </nav>
    </header>
    {fundamentals}
    {company.inMap && <section aria-labelledby="company-relationships" className="border-b border-white/15 py-6">
      <h2 id="company-relationships" className="scroll-mt-24 text-xl font-semibold text-cyan-100">{company.ticker}<UiText text={" suppliers, customers and competitors"} /></h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{company.connections.length ? <UiText text={`${company.connections.length} relationships in the loaded sources. `} /> : ""}<UiText text={"These are AI-assisted research and filing claims, not a complete or independently verified account of the business. Source dates do not establish whether a relationship remains active."} /></p>
      {!company.connections.length && <p className="mt-3 text-sm text-slate-400">{company.graphAvailable ? <UiText text={"No published relationships are available for this company yet."} /> : <UiText text={"Filing relationships are temporarily unavailable."} />}</p>}
      <div className="mt-4 divide-y divide-white/10">
        {company.connections.slice(0, 12).map((connection) => <article key={connection.id} className="py-4">
          <h3 className="text-sm font-semibold text-slate-100">{<UiText text={connection.label} />}</h3>
          {connection.related.ticker && <Link href={`/ticker/${encodeURIComponent(connection.related.ticker)}`} className="mt-1 inline-block text-sm text-cyan-200 underline underline-offset-4"><UiText text={"Research "} />{connection.related.name} ({connection.related.ticker})</Link>}
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-cyan-200">{connection.evidence.some(e => e.sourceKind === "web") ? <UiText text={"Sources"} /> : <UiText text={"Filing evidence"} />} ({connection.evidence.length})</summary>
            {connection.evidence.map((evidence) => <div key={evidence.id} className="mt-3 max-w-3xl border-l-2 border-cyan-700 pl-4">
              <p className="text-xs text-slate-400">{evidence.issuerTicker} {evidence.sourceKind === "web" ? <UiText text={"industry research summary"} /> : <UiText text={"filing"} />} · {evidence.filingDate}</p>
              {evidence.sourceKind === "web" ? <p className="mt-2 break-words leading-6 text-slate-300">{evidence.quote}</p> : <blockquote className="mt-2 break-words leading-6 text-slate-300">{evidence.quote}</blockquote>}
              {evidence.nameMatched && <p className="mt-2 text-xs text-amber-200"><UiText text={"Company identity is based on a provisional name match."} /></p>}
              {evidence.qualityReview && <p className="mt-2 text-xs text-amber-200"><UiText text={"Evidence reviewed "} />{evidence.qualityReview.reviewedAt}: {evidence.qualityReview.reason}</p>}
              <a href={evidence.filingUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-cyan-200 underline underline-offset-4">{evidence.sourceKind === "web" ? evidence.sourceTitle ?? <UiText text={"Read source"} /> : <UiText text={"Read SEC filing"} />}</a>
            </div>)}
          </details>
        </article>)}
      </div>
      {company.connections.length > 12 && <Link href={`/map?company=${encodeURIComponent(company.ticker)}`} className="mt-3 inline-block text-sm text-cyan-200 underline underline-offset-4"><UiText text={"View all "} />{company.connections.length}<UiText text={" relationships on the map"} /></Link>}
    </section>}
  </>;
}
