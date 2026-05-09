import type { Metadata } from "next";
import Link from "next/link";
import { getInstitutionalDiscoverySummary } from "@/lib/securities/institutional-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Institutional activity | YouAnalyst",
  description: "Browse tracked 13F institutions and recent institutional buying and selling activity.",
  alternates: {
    canonical: "/institutions",
  },
  openGraph: {
    title: "Institutional activity | YouAnalyst",
    description: "Browse tracked 13F institutions and recent institutional buying and selling activity.",
    url: "/institutions",
  },
  twitter: {
    title: "Institutional activity | YouAnalyst",
    description: "Browse tracked 13F institutions and recent institutional buying and selling activity.",
  },
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    notation: Math.abs(value) >= 1_000_000_000 ? "compact" : "standard",
    style: "currency",
  }).format(value);
}

function formatSignedCurrency(value: number): string {
  const formatted = formatCurrency(value);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDate(value: string | null): string {
  return value || "Unknown";
}

function changeTone(status: string): string {
  if (status === "INCREASED" || status === "NEW") {
    return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
  }

  if (status === "REDUCED" || status === "SOLD_OUT") {
    return "border-rose-400/30 bg-rose-400/10 text-rose-100";
  }

  return "border-white/10 bg-slate-900/80 text-slate-300";
}

export default async function InstitutionsPage() {
  const summary = await getInstitutionalDiscoverySummary();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <section className="rounded-2xl border border-cyan-500/25 bg-slate-900/70 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">Institutional activity</p>
        <h1 className="mt-2 font-[var(--font-sora)] text-3xl font-semibold text-cyan-100 sm:text-4xl">
          Browse 13F institutions
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
          Recent manager filings and ticker-level activity from the tracked 13F pipeline.
        </p>
        <p className="mt-3 text-xs text-slate-500">Updated {formatDateTime(summary.generatedAt)}</p>
      </section>

      <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Recent ticker activity</h2>
            <p className="mt-1 text-sm text-slate-400">
              Tickers with the largest gross reported value changes in recent parsed filings.
            </p>
          </div>
          <Link href="/companies" className="text-sm font-semibold text-cyan-200 hover:text-cyan-100">
            Search a ticker
          </Link>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {summary.activeTickers.map((activity) => (
            <article key={`${activity.ticker}_${activity.reportDate}`} className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <Link href={`/ticker/${activity.ticker}`} className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100 hover:text-cyan-300">
                    {activity.ticker}
                  </Link>
                  <p className="mt-1 text-sm text-slate-400">{activity.nameOfIssuer}</p>
                </div>
                <p className="text-right text-sm font-semibold tabular-nums text-slate-100">{formatSignedCurrency(activity.netValueChangeUsd)}</p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <p className="text-slate-400">
                  Managers
                  <span className="mt-1 block font-semibold text-slate-100">{activity.managerCount}</span>
                </p>
                <p className="text-emerald-200">
                  Added
                  <span className="mt-1 block font-semibold">{activity.newManagers + activity.increasedManagers}</span>
                </p>
                <p className="text-rose-200">
                  Trimmed
                  <span className="mt-1 block font-semibold">{activity.reducedManagers + activity.soldOutManagers}</span>
                </p>
                <p className="text-slate-400">
                  Report
                  <span className="mt-1 block font-semibold text-slate-100">{formatDate(activity.reportDate)}</span>
                </p>
              </div>

              <div className="mt-4 grid gap-2">
                {activity.topManagers.map((manager) => (
                  <div key={`${activity.ticker}_${manager.managerCik}_${manager.status}`} className="flex flex-col gap-2 rounded-lg border border-white/10 bg-slate-950/55 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <Link href={`/institutions/${manager.managerCik}`} className="font-semibold text-slate-100 hover:text-cyan-200">
                      {manager.managerName}
                    </Link>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${changeTone(manager.status)}`}>
                        {manager.status}
                      </span>
                      <span className="text-sm tabular-nums text-slate-300">{formatSignedCurrency(manager.valueChangeUsd)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>

        {summary.activeTickers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
            No institutional ticker activity is available yet.
          </p>
        ) : null}
      </section>

      <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/55 p-5">
        <div className="mb-4">
          <h2 className="font-[var(--font-sora)] text-xl font-semibold text-cyan-100">Recently updated institutions</h2>
          <p className="mt-1 text-sm text-slate-400">
            Managers with recent parsed 13F filings.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summary.managers.map((manager) => (
            <Link
              key={manager.cik}
              href={`/institutions/${manager.cik}`}
              className="rounded-xl border border-white/10 bg-slate-900/60 p-4 transition hover:border-cyan-300/60 hover:bg-slate-900"
            >
              <p className="font-semibold text-cyan-100">{manager.name}</p>
              <p className="mt-1 text-xs text-slate-500">CIK {manager.cik}</p>
              <div className="mt-4 grid gap-1 text-sm text-slate-300">
                <p>Quarter {manager.latestQuarter ?? "Unknown"}</p>
                <p>Report {formatDate(manager.latestReportDate)}</p>
                <p className="truncate text-xs text-slate-500">Filing {manager.latestAccessionNumber ?? "Unknown"}</p>
              </div>
            </Link>
          ))}
        </div>

        {summary.managers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/20 p-5 text-sm text-slate-300">
            No institutions have been parsed yet.
          </p>
        ) : null}
      </section>
    </main>
  );
}
