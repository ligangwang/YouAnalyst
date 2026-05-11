const DAILY_SHARE_CARD_VERSION = "v2";
const DAILY_INSTITUTIONAL_SHARE_CARD_VERSION = "v2";

export type DailyInstitutionalMoveShareKind = "increase" | "decrease";

export function isDailyInstitutionalMoveShareKind(value: string | null): value is DailyInstitutionalMoveShareKind {
  return value === "increase" || value === "decrease";
}

export function dailyCanonicalPath(date: string | null): string {
  return date ? `/daily/${encodeURIComponent(date)}` : "/daily";
}

export function dailyInstitutionalMoveSharePath(date: string, kind: DailyInstitutionalMoveShareKind, ticker: string): string {
  return `/daily/institutional/${encodeURIComponent(date)}/${encodeURIComponent(kind)}/${encodeURIComponent(ticker)}`;
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
