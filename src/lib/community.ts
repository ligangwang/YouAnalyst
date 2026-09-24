// Client-safe community display switches. NEXT_PUBLIC_* values are inlined at build time;
// the typeof guard keeps bundles without a `process` global (test fixtures) working.
const hasProcess = typeof process !== "undefined";

/**
 * Analyst levels / tier names ("Level 1 · New Analyst") are hidden while the community is small.
 * Levels are still computed and stored; set NEXT_PUBLIC_SHOW_ANALYST_LEVELS=true to show them again.
 */
export const SHOW_ANALYST_LEVELS = ["1", "true", "yes", "on"].includes(((hasProcess ? process.env.NEXT_PUBLIC_SHOW_ANALYST_LEVELS : undefined) ?? "").trim().toLowerCase());

const DEFAULT_MIN_RANKED_ANALYSTS = 10;

/** Rankings stay hidden until at least this many analysts have a public ranked call. */
export const MIN_RANKED_ANALYSTS = (() => {
  const raw = (hasProcess ? process.env.NEXT_PUBLIC_MIN_RANKED_ANALYSTS : undefined)?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_RANKED_ANALYSTS;
})();

export function rankingsOpen(rankedAnalysts: unknown, minimum = MIN_RANKED_ANALYSTS): boolean {
  return typeof rankedAnalysts === "number" && Number.isFinite(rankedAnalysts) && rankedAnalysts >= minimum;
}
