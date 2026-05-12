const DAILY_SHARE_CARD_VERSION = "v2";
const DAILY_INSTITUTIONAL_SHARE_CARD_VERSION = "v3";
const DAILY_INSIDER_SHARE_CARD_VERSION = "v3";

export type DailyInstitutionalMoveShareKind = "increase" | "decrease";
export type DailyInsiderMoveShareKind = "purchase" | "sale";

export function isDailyInstitutionalMoveShareKind(value: string | null): value is DailyInstitutionalMoveShareKind {
  return value === "increase" || value === "decrease";
}

export function isDailyInsiderMoveShareKind(value: string | null): value is DailyInsiderMoveShareKind {
  return value === "purchase" || value === "sale";
}

export function dailyCanonicalPath(date: string | null): string {
  return date ? `/daily/calls/${encodeURIComponent(date)}` : "/daily/calls";
}

export function dailyInstitutionalMoveSharePath(date: string, kind: DailyInstitutionalMoveShareKind, ticker: string): string {
  return `/daily/institutional/${encodeURIComponent(date)}/${encodeURIComponent(kind)}/${encodeURIComponent(ticker)}`;
}

export function dailyInsiderMoveSharePath(date: string, kind: DailyInsiderMoveShareKind, ticker: string): string {
  return `/daily/insider/${encodeURIComponent(date)}/${encodeURIComponent(kind)}/${encodeURIComponent(ticker)}`;
}

export function dailyShareImageDate(date: string | null): string {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "latest";
}

export function dailyShareVersion(date: string | null): string {
  return `${DAILY_SHARE_CARD_VERSION}-${dailyShareImageDate(date)}`;
}

export function dailyInstitutionalMoveShareVersion(
  date: string,
  kind: DailyInstitutionalMoveShareKind,
  ticker: string,
): string {
  return `${DAILY_INSTITUTIONAL_SHARE_CARD_VERSION}-${dailyShareImageDate(date)}-${kind}-${ticker.toUpperCase()}`;
}

export function dailyInsiderMoveShareVersion(
  date: string,
  kind: DailyInsiderMoveShareKind,
  ticker: string,
): string {
  return `${DAILY_INSIDER_SHARE_CARD_VERSION}-${dailyShareImageDate(date)}-${kind}-${ticker.toUpperCase()}`;
}
