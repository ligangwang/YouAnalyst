
import { UiText } from "@/components/ui-text";
import type { CompanyFundamentals } from "@/lib/fundamentals/model";

function displayValue(value: number | null, unit: string | null) {
  if (value === null || !unit) return "Unavailable";
  const perShare = unit.endsWith("/shares");
  return `${new Intl.NumberFormat("en-US", { notation: perShare ? "standard" : "compact", maximumFractionDigits: 2 }).format(value)} ${unit.replace("/shares", " / share")}`;
}

export function CompanyFundamentalsView({ data }: { data: CompanyFundamentals | null }) {
  return <section aria-labelledby="company-fundamentals" className="border-b border-white/15 py-6">
    <h2 id="company-fundamentals" className="scroll-mt-24 text-xl font-semibold text-cyan-100"><UiText text={"Business and financials"} /></h2>
    {!data ? <p className="mt-3 text-sm text-slate-400"><UiText text={"SEC fundamentals are unavailable for this company right now. Other company research remains available."} /></p> : <>
      <p className="mt-2 text-sm text-slate-300"><UiText text={"Annual report for the year ended "} />{data.report.end}<UiText text={". These are reported annual figures, not trailing twelve-month estimates."} /></p>
      {data.excerpt ? <details className="mt-4 rounded-xl border border-white/10 p-4" open>
        <summary className="cursor-pointer text-sm font-semibold text-cyan-200"><UiText text={"What the company says it does"} /></summary>
        <blockquote className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">{data.excerpt}</blockquote>
        <p className="mt-2 text-xs text-slate-400"><UiText text={"Excerpt from Item 1 — Business; filed "} />{data.report.filed}<UiText text={". May be shortened."} /></p>
      </details> : <p className="mt-3 text-sm text-slate-400"><UiText text={"A business excerpt is not available. Read the annual report for the company’s description."} /></p>}
      <a href={data.report.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm text-cyan-200 underline underline-offset-4"><UiText text={"Read the "} />{data.report.form}<UiText text={" annual report ↗"} /></a>
      <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {data.metrics.map(metric => <div key={metric.label} className="min-w-0 rounded-xl border border-white/10 bg-slate-900/40 p-4">
          <dt className="text-sm text-slate-300">{<UiText text={metric.label} />}</dt>
          <dd className="mt-2 break-words text-xl font-semibold text-white"><UiText text={displayValue(metric.value, metric.unit)} /></dd>
          <dd className="mt-2 text-xs leading-5 text-slate-400">{metric.value === null ? <UiText text={"No comparable standard-tagged figure in this annual period."} /> : <>
            {metric.start ? <UiText text={`${metric.start} to ${metric.end}`} /> : <UiText text={`As of ${metric.end}`} />}<br />
            <a href={metric.sourceUrl!} target="_blank" rel="noopener noreferrer" className="text-cyan-200 underline underline-offset-2"><UiText text={"Filed "} />{metric.filed} ↗</a>
          </>}</dd>
        </div>)}
      </dl>
      <p className="mt-3 text-xs leading-5 text-slate-400"><UiText text={"Source: SEC Company Facts. Checked "} />{data.fetchedAt.slice(0, 10)}<UiText text={". We check for updates on visits after 24 hours. Missing or ambiguous figures are left unavailable."} /></p>
      {data.stale && <p className="mt-2 text-xs text-amber-200"><UiText text={"Showing a previously fetched snapshot. A recent refresh has not completed."} /></p>}
    </>}
  </section>;
}
