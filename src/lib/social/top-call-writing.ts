import type { DailyCallHighlight } from "@/lib/daily-scores/service";

export type TopCallFacts = {
  date: string;
  predictionId: string;
  ticker: string;
  analyst: string;
  direction: "UP" | "DOWN";
  callDate: string;
  dailyReturn: number;
  sinceEntry: number;
  status: "LIVE" | "SETTLED";
  thesis: string | null;
};
export type RecentPost = { text: string; opening: string };
export type Writing = { opening: string; layout: "analyst_first" | "result_first" };

export function easternDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function eodReady(run: Record<string, unknown> | undefined, date: string): boolean {
  return run?.status === "COMPLETED" && run.runDate === date && run.latestTradingDate === date &&
    run.marksUpdated === true && run.hasMoreCandidatePredictions === false && run.missingPrices === 0 && run.priceFailures === 0 &&
    typeof run.completedAt === "string";
}

export function topCallFacts(date: string, call: DailyCallHighlight): TopCallFacts {
  const analyst = (call.nickname || call.displayName || "").trim();
  // Keep source labels short enough for a standard post, and do not turn site nicknames into X mentions.
  if (!validDate(date) || !call.predictionId || !call.ticker || !/^[A-Z0-9.^-]{1,15}$/.test(call.ticker) ||
      !analyst || analyst.length > 40 || /[\r\n@]|https?:/i.test(analyst) || !call.direction ||
      call.dailyReturnChange === null || !Number.isFinite(call.dailyReturnChange) ||
      call.returnSinceEntry === null || !Number.isFinite(call.returnSinceEntry) ||
      !Number.isFinite(Date.parse(call.createdAt))) {
    throw new Error("Top Call has missing or unsupported source facts");
  }
  return {
    date, predictionId: call.predictionId, ticker: call.ticker, analyst, direction: call.direction,
    callDate: easternDate(new Date(call.createdAt)), dailyReturn: call.dailyReturnChange,
    sinceEntry: call.returnSinceEntry, status: call.status,
    thesis: (call.thesisTitle || call.thesis)?.slice(0, 1500) || null,
  };
}

const normalized = (text: string) => text.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
export function repeatedOpening(opening: string, recent: RecentPost[]): boolean {
  const words = normalized(opening).split(" ");
  return recent.some((post) => {
    const previous = normalized(post.opening).split(" ");
    if (words.slice(0, 4).join(" ") === previous.slice(0, 4).join(" ")) return true;
    const a = new Set(words), b = new Set(previous);
    const intersection = [...a].filter((word) => b.has(word)).length;
    return intersection / new Set([...a, ...b]).size >= 0.7;
  });
}

export function validateWriting(value: unknown, recent: RecentPost[]): Writing {
  const writing = value as Partial<Writing> | null;
  if (!writing || typeof writing.opening !== "string" ||
      !["analyst_first", "result_first"].includes(writing.layout || "")) throw new Error("Invalid writing response");
  const opening = writing.opening.trim();
  // Figures, links, identifiers and attribution are rendered by code, never generated.
  if (!opening || opening.length > 70 || /[\d$%@#?\r\n]|https?:|www\./i.test(opening) ||
      /guarantee|can't lose|cannot lose|buy now|sell now|moon|next winner|what do you think/i.test(opening) ||
      repeatedOpening(opening, recent)) throw new Error("Unsafe or repetitive opening");
  return { opening, layout: writing.layout as Writing["layout"] };
}

const percent = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
// Conservative upper bound: ASCII costs one, all other code points cost two;
// count the literal URL too, rather than assuming a URL-shortening allowance.
export function postLength(text: string): number {
  return [...text].reduce((sum, char) => sum + (char.codePointAt(0)! <= 127 ? 1 : 2), 0);
}

export function renderPost(facts: TopCallFacts, writing: Writing): string {
  const identity = `$${facts.ticker} ${facts.direction} by ${facts.analyst} (called ${facts.callDate}; ${facts.status.toLowerCase()})`;
  const returns = `Call return: ${percent(facts.dailyReturn)} today; ${percent(facts.sinceEntry)} since entry.`;
  const lines = writing.layout === "analyst_first" ? [identity, returns] : [returns, identity];
  const text = [writing.opening, `YouAnalyst Top Call | ${facts.date}`, ...lines,
    `https://youanalyst.com/predictions/${encodeURIComponent(facts.predictionId)}`].join("\n");
  if (postLength(text) > 280) throw new Error("Post exceeds conservative X length limit");
  return text;
}
