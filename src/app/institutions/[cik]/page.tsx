import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getInstitutionalManagerSummary } from "@/lib/securities/institutional-data";

export const dynamic = "force-dynamic";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatSignedCurrency(value: number): string {
  const formatted = formatCurrency(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "new";
  }

  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    style: "percent",
  }).format(value)}`;
}

function changeTone(status: string | null): string {
  if (status === "INCREASED" || status === "NEW") {
    return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
  }

  if (status === "REDUCED" || status === "SOLD_OUT") {
    return "border-rose-400/30 bg-rose-400/10 text-rose-100";
  }

  return "border-white/10 bg-slate-900/80 text-slate-300";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ cik: string }>;
}): Promise<Metadata> {
  const { cik } = await params;
  const summary = await getInstitutionalManagerSummary(cik);
  const name = summary?.manager.name ?? "Institution";
  const title = `${name} 13F holdings | YouAnalyst`;
  const description = `Latest 13F positions and changes for ${name}.`;

  return {
    title,
    description,
    alternates: {
      canonical: `/institutions/${summary?.manager.cik ?? cik}`,
    },
    openGraph: {
      title,
      description,
      url: `/institutions/${summary?.manager.cik ?? cik}`,
    },
    twitter: {
      title,
      description,
    },
  };
}

export default async function InstitutionPage({ params }: { params: Promise<{ cik: string }> }) {
  const { cik } = await params;
  const summary = await getInstitutionalManagerSummary(cik);

  if (!summary) {
    notFound();
  }

  const totalValueUsd = summary.holdings.reduce((total, holding) => total + holding.valueUsd, 0);
  const netValueChangeUsd = summary.holdings.reduce((total, holding) => total + (holding.valueChangeUsd ?? 0), 0);
  const changedHoldings = summary.holdings.filter((holding) => holding.changeStatus && holding.changeStatus !== "UNCHANGED").length;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Institution</p>
        <h1 className="mt-2 font-[var(--font-sora)] text-3xl font-semibold text-cyan-100 sm:text-4xl">
          {summary.manager.name}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          CIK {summary.manager.cik}
          {summary.manager.latestQuarter ? ` - ${summary.manager.latestQuarter}` : ""}
          {summary.manager.latestReportDate ? ` report dated ${summary.manager.latestReportDate}` : ""}
        </p>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-slate-950/55 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shown positions</p>
          <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">{summary.holdings.length}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/55 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shown market value</p>
          <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">{formatCurrency(totalValueUsd)}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/55 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Net value change</p>
          <p className="mt-2 font-[var(--font-sora)] text-2xl font-semibold text-cyan-100">{formatSignedCurrency(netValueChangeUsd)}</p>
          <p className="mt-1 text-xs text-slate-500">{changedHoldings} changed positions shown</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-950/55 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest filing</p>
          <p className="mt-2 break-all text-sm font-semibold text-cyan-100">{summary.manager.latestAccessionNumber ?? "Unknown"}</p>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <div className="mb-4">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Latest 13F holdings</h2>
          <p className="mt-1 text-sm text-slate-400">
            Top reported positions by market value. 13F filings are delayed and may not reflect current holdings.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-3 pr-3">Ticker</th>
                <th className="py-3 pr-3">Issuer</th>
                <th className="py-3 pr-3 text-right">Value</th>
                <th className="py-3 pr-3 text-right">Shares</th>
                <th className="py-3 pr-3">Change</th>
                <th className="py-3 pr-3 text-right">Value change</th>
                <th className="py-3">Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {summary.holdings.map((holding) => (
                <tr key={holding.positionKey} className="text-slate-200">
                  <td className="py-3 pr-3 font-semibold text-cyan-100">
                    {holding.ticker ? (
                      <Link href={`/ticker/${holding.ticker}`} className="hover:text-cyan-300">
                        ${holding.ticker}
                      </Link>
                    ) : (
                      "Unmapped"
                    )}
                  </td>
                  <td className="py-3 pr-3">{holding.nameOfIssuer}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{formatCurrency(holding.valueUsd)}</td>
                  <td className="py-3 pr-3 text-right tabular-nums">{formatNumber(holding.shares)}</td>
                  <td className="py-3 pr-3">
                    <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${changeTone(holding.changeStatus)}`}>
                      {holding.changeStatus ?? "CURRENT"} {holding.changeStatus ? formatPercent(holding.percentChange) : ""}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums">
                    {holding.valueChangeUsd === null ? "Unknown" : formatSignedCurrency(holding.valueChangeUsd)}
                  </td>
                  <td className="py-3 text-slate-400">{holding.reportDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {summary.holdings.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
            No mapped holdings are available for this manager yet.
          </p>
        ) : null}
      </section>
    </main>
  );
}
