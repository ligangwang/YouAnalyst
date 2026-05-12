import Link from "next/link";
import { getDailyScores, type DailyInsiderMove } from "@/lib/daily-scores/service";
import type { DailyInsiderMoveShareKind } from "@/lib/daily-scores/public-share";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
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

function findInsiderMove(
  moves: Awaited<ReturnType<typeof getDailyScores>>["insiderMoves"],
  kind: DailyInsiderMoveShareKind,
  ticker: string,
): DailyInsiderMove | null {
  const normalizedTicker = ticker.trim().toUpperCase();
  const items = kind === "purchase" ? moves.purchases : moves.sales;
  return items.find((move) => move.ticker.toUpperCase() === normalizedTicker) ?? null;
}

function moveCopy(move: DailyInsiderMove, kind: DailyInsiderMoveShareKind): string {
  const noun = kind === "purchase" ? "purchases" : "sales";
  return `Latest Form 4 reports show ${move.ticker} insider ${noun} totaling ${formatCurrency(move.totalValueUsd)} across ${move.insiderCount} insider${move.insiderCount === 1 ? "" : "s"}, filed ${move.filingDate}.`;
}

export async function DailyInsiderMoveShareView({
  date,
  kind,
  snapshot,
  ticker,
}: {
  date: string;
  kind: DailyInsiderMoveShareKind;
  snapshot: DailyInsiderMove | null;
  ticker: string;
}) {
  const normalizedTicker = ticker.trim().toUpperCase();
  let move: DailyInsiderMove | null = null;
  let resolvedDate = date;

  try {
    const result = await getDailyScores(date);
    resolvedDate = result.date ?? date;
    move = findInsiderMove(result.insiderMoves, kind, normalizedTicker) ?? snapshot;
  } catch {
    move = snapshot;
  }

  const title = `${normalizedTicker} Insider ${kind === "purchase" ? "Purchases" : "Sales"}`;
  const description = move
    ? moveCopy(move, kind)
    : `Latest insider ${kind} context for ${normalizedTicker} on YouAnalyst.`;
  const accent = kind === "purchase" ? "text-emerald-300" : "text-rose-300";

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-10 text-slate-100 sm:px-8 lg:px-10">
      <section className="rounded-[2rem] border border-cyan-400/20 bg-slate-950/70 p-8 shadow-2xl shadow-cyan-950/20 sm:p-10">
        <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="mb-3 text-sm font-bold uppercase tracking-[0.35em] text-cyan-300">Insider Form 4 Activity</p>
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
              <p className="mt-3 text-xl font-bold text-slate-50">{move.issuerName}</p>
            </div>
            <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Value</p>
              <p className={`mt-3 text-2xl font-black ${accent}`}>{formatCurrency(move.totalValueUsd)}</p>
            </div>
            <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Shares</p>
              <p className="mt-3 text-2xl font-black text-slate-50">{formatNumber(move.totalShares)}</p>
            </div>
            <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Insiders</p>
              <p className="mt-3 text-2xl font-black text-slate-50">{formatNumber(move.insiderCount)}</p>
            </div>
            <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5 sm:col-span-2">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Filed</p>
              <p className="mt-3 text-xl font-bold text-slate-50">{displayDate(move.filingDate)}</p>
            </div>
            <div className="rounded-2xl border border-slate-700/80 bg-slate-900/80 p-5 sm:col-span-2">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Latest Transaction</p>
              <p className="mt-3 text-xl font-bold text-slate-50">{displayDate(move.latestTransactionDate)}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-slate-300">
            No matching insider {kind} data is available yet.
          </div>
        )}
      </section>
    </main>
  );
}
