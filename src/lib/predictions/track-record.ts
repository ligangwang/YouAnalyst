import { canonicalPredictionStatus } from "./types";
import { predictionInstrument } from "./instrument";

/** US views are compared with the Nasdaq-100 over the same entry-to-mark window. */
export const TRACK_RECORD_BENCHMARK = "QQQ";

export type TrackRecordRow = {
  id: string; ticker?: unknown; direction?: unknown; status?: unknown; visibility?: unknown; thesisTitle?: unknown;
  entryDate?: unknown; markPriceDate?: unknown; markReturnValue?: unknown; result?: unknown; evidence?: unknown;
};
export type TrackRecordView = {
  id: string; ticker: string; direction: "UP" | "DOWN"; status: "OPEN" | "CLOSING" | "SETTLED"; title: string;
  entryDate: string; markDate: string; viewReturn: number;
  /** The benchmark's return over the same window, signed in the view's direction (a bearish view is compared with being short the benchmark). */
  benchmarkReturn: number | null; excessReturn: number | null; cited: number;
};
export type TrackRecord = {
  benchmark: string; views: number; open: number; settled: number;
  /** Share of views currently ahead (open) or that finished ahead (settled). */
  hitRate: number | null; averageReturn: number | null;
  /** Average return over the benchmark, for the views with benchmark prices. */
  averageExcess: number | null; benchmarkCovered: number; recent: TrackRecordView[];
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** Dates whose benchmark close is needed for these rows. */
export function trackRecordDates(rows: TrackRecordRow[]) {
  return [...new Set(rows.flatMap(row => predictionInstrument(String(row.ticker ?? ""))?.market === "US" ? [date(row.entryDate), date(row.markPriceDate)] : []).filter((value): value is string => Boolean(value)))].sort();
}

/**
 * A public, verifiable record: every public view that has an entry price and a mark, with its
 * return and the benchmark's return over the same dates. Canceled, private and pending views are excluded.
 */
export function computeTrackRecord(rows: TrackRecordRow[], benchmarkClose: ReadonlyMap<string, number>, recentLimit = 20): TrackRecord {
  const views = rows.flatMap((row): TrackRecordView[] => {
    const status = canonicalPredictionStatus(row.status);
    if (row.visibility !== "PUBLIC" || (status !== "OPEN" && status !== "CLOSING" && status !== "SETTLED")) return [];
    if (row.direction !== "UP" && row.direction !== "DOWN") return [];
    const entryDate = date(row.entryDate), markDate = date(row.markPriceDate);
    const result = row.result as { returnValue?: unknown } | null | undefined;
    const viewReturn = status === "SETTLED" && finite(result?.returnValue) ? result.returnValue : row.markReturnValue;
    if (!entryDate || !markDate || !finite(viewReturn)) return [];
    const ticker = String(row.ticker ?? "");
    const start = benchmarkClose.get(entryDate), end = benchmarkClose.get(markDate);
    const benchmarkReturn = predictionInstrument(ticker)?.market === "US" && start && end ? (row.direction === "UP" ? 1 : -1) * (end / start - 1) : null;
    return [{
      id: row.id, ticker, direction: row.direction, status, title: typeof row.thesisTitle === "string" ? row.thesisTitle : "",
      entryDate, markDate, viewReturn, benchmarkReturn, excessReturn: benchmarkReturn === null ? null : viewReturn - benchmarkReturn,
      cited: Array.isArray(row.evidence) ? row.evidence.length : 0,
    }];
  });
  const excess = views.map(view => view.excessReturn).filter(finite);
  return {
    benchmark: TRACK_RECORD_BENCHMARK,
    views: views.length,
    open: views.filter(view => view.status !== "SETTLED").length,
    settled: views.filter(view => view.status === "SETTLED").length,
    hitRate: views.length ? views.filter(view => view.viewReturn > 0).length / views.length : null,
    averageReturn: average(views.map(view => view.viewReturn)),
    averageExcess: average(excess),
    benchmarkCovered: excess.length,
    recent: [...views].sort((a, b) => b.entryDate.localeCompare(a.entryDate) || a.id.localeCompare(b.id)).slice(0, recentLimit),
  };
}
