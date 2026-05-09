import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InstitutionDetailHoldings } from "@/components/institution-detail-holdings";
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

      <InstitutionDetailHoldings holdings={summary.holdings} />
    </main>
  );
}
