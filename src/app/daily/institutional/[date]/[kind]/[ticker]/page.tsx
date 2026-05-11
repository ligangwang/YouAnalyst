import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { institutionalMoveFromShareParams } from "@/lib/daily-scores/institutional-share-snapshot";
import { dailyInstitutionalMoveMetadata } from "@/lib/daily-scores/page-metadata";
import { isDailyInstitutionalMoveShareKind, type DailyInstitutionalMoveShareKind } from "@/lib/daily-scores/public-share";
import { getDailyScores, isDailyScoreDate, type DailyInstitutionalMove } from "@/lib/daily-scores/service";

type Props = {
  params: Promise<{
    date: string;
    kind: string;
    ticker: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

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

function displayDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function findInstitutionalMove(
  moves: Awaited<ReturnType<typeof getDailyScores>>["institutionalMoves"],
  kind: DailyInstitutionalMoveShareKind,
  ticker: string,
): DailyInstitutionalMove | null {
  const normalizedTicker = ticker.trim().toUpperCase();
  const items = kind === "increase" ? moves.increases : moves.decreases;
  return items.find((move) => move.ticker.toUpperCase() === normalizedTicker) ?? null;
}

function moveCopy(move: DailyInstitutionalMove, kind: DailyInstitutionalMoveShareKind): string {
  const verb = kind === "increase" ? "increased" : "reduced";
  const amount = kind === "increase" ? formatSignedCurrency(move.valueChangeUsd) : formatCurrency(Math.abs(move.valueChangeUsd));
  return `Latest 13F reports show ${move.ticker} ${verb} by ${amount} across ${move.managerCount} manager${move.managerCount === 1 ? "" : "s"} as of ${move.reportDate}.`;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { date, kind, ticker } = await params;
  if (!isDailyScoreDate(date) || !isDailyInstitutionalMoveShareKind(kind)) {
    notFound();
  }

  const snapshot = institutionalMoveFromShareParams(await searchParams, ticker);
  return dailyInstitutionalMoveMetadata(date, kind, ticker, snapshot);
}

export default async function DailyInstitutionalMoveSharePage({ params, searchParams }: Props) {
  const { date, kind, ticker } = await params;
  if (!isDailyScoreDate(date) || !isDailyInstitutionalMoveShareKind(kind)) {
    notFound();
  }

  const normalizedTicker = ticker.trim().toUpperCase();
  const snapshot = institutionalMoveFromShareParams(await searchParams, normalizedTicker);
  let move: DailyInstitutionalMove | null = null;
  let resolvedDate = date;

  try {
    const result = await getDailyScores(date);
    resolvedDate = result.date ?? date;
    move = findInstitutionalMove(result.institutionalMoves, kind, normalizedTicker) ?? snapshot;
  } catch {
    move = snapshot;
  }

  const title = `${normalizedTicker} 13F ${kind === "increase" ? "Increase" : "Decrease"}`;
  const description = move
    ? moveCopy(move, kind)
    : `Latest institutional 13F ${kind} context for ${normalizedTicker} on YouAnalyst.`;
  const amount = move ? (kind === "increase" ? formatSignedCurrency(move.valueChangeUsd) : `-${formatCurrency(Math.abs(move.valueChangeUsd))}`) : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-10 text-slate-100 sm:px-8 lg:px-10">
      <section className="rounded-[2rem] border border-cyan-400/20 bg-slate-950/70 p-8 shadow-2xl shadow-cyan-950/20 sm:p-10">
        <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.35em] text-cyan-300">Institutional 13F Move</p>
            <h1 className="text-4xl font-black tracking-tight text-cyan-100 sm:text-5xl">{title}</h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-300">{description}</p>
          </div>
          <Link
            href={`/daily/${resolvedDate}`}
            className="inline-flex shrink-0 items-center justify-center rounded-2xl border border-cyan-300/30 px-5 py-3 text-sm font-bold text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-300/10"
          >
            Daily moves
          </Link>
        </div>

        {move ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Issuer</p>
              <p className="mt-3 text-xl font-bold text-slate-50">{move.nameOfIssuer}</p>
            </div>
            <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Value Change</p>
              <p className={`mt-3 text-2xl font-black ${move.valueChangeUsd >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{amount}</p>
            </div>
            <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Share Change</p>
              <p className={`mt-3 text-2xl font-black ${move.shareChange >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {move.shareChange > 0 ? "+" : ""}
                {formatNumber(move.shareChange)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Report Date</p>
              <p className="mt-3 text-2xl font-black text-slate-50">{move.reportDate}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 p-6 text-slate-300">
            This institutional move is not available in the latest daily snapshot yet.
          </div>
        )}

        {move ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-4">
            <div className="rounded-2xl bg-slate-900/50 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Managers</p>
              <p className="mt-2 text-xl font-black text-cyan-100">{formatNumber(move.managerCount)}</p>
            </div>
            <div className="rounded-2xl bg-slate-900/50 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">New</p>
              <p className="mt-2 text-xl font-black text-cyan-100">{formatNumber(move.newManagers)}</p>
            </div>
            <div className="rounded-2xl bg-slate-900/50 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Increased</p>
              <p className="mt-2 text-xl font-black text-cyan-100">{formatNumber(move.increasedManagers)}</p>
            </div>
            <div className="rounded-2xl bg-slate-900/50 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Reduced/Sold</p>
              <p className="mt-2 text-xl font-black text-cyan-100">{formatNumber(move.reducedManagers + move.soldOutManagers)}</p>
            </div>
          </div>
        ) : null}

        <p className="mt-8 text-sm text-slate-500">13F filings are delayed and may not reflect current holdings. Last daily snapshot: {displayDate(resolvedDate)}.</p>
      </section>
    </main>
  );
}
