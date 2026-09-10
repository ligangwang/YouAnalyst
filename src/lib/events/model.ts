export const EVENT_PAGE_SIZE = 30;
export const MAX_EVENT_PAGE_SIZE = 50;

/** Shared events contain public source facts only, never private user activity. */
export type PublicEvent = {
  id: string;
  dedupeKey: string;
  schemaVersion: 1;
  visibility: "PUBLIC";
  type: "SEC_FORM4" | "SEC_13F";
  tickers: string[];
  occurredAt: string;
  occurredAtPrecision: "date";
  publishedAt: string;
  updatedAt: string;
  title: string;
  summary: string;
  sourceName: "SEC EDGAR";
  sourceUrl: string;
  accessionNumber: string;
};

export type FilingEventInput = {
  type: PublicEvent["type"];
  accessionNumber: string;
  filingDate: string;
  sourceUrl: string;
  entityName: string;
  tickers: string[];
  amended: boolean;
};

export function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function isEventTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

export function filingEvent(input: FilingEventInput, publishedAt: string): PublicEvent {
  if (input.type !== "SEC_FORM4" && input.type !== "SEC_13F") throw new Error("Invalid filing event type");
  if (!/^\d{10}-\d{2}-\d{6}$/.test(input.accessionNumber) || !isDate(input.filingDate)) throw new Error("Invalid filing event identity or date");
  const url = new URL(input.sourceUrl);
  if (url.protocol !== "https:" || url.hostname !== "www.sec.gov" || !url.pathname.startsWith("/Archives/") || url.username || url.password) throw new Error("Invalid SEC source URL");
  const entity = input.entityName.trim().slice(0, 200);
  if (!entity || !isEventTimestamp(publishedAt)) throw new Error("Invalid event metadata");
  const form = input.type === "SEC_FORM4" ? "Form 4" : "13F";
  const id = `${input.type.toLowerCase()}-${input.accessionNumber}`;
  return {
    id, dedupeKey: id, schemaVersion: 1, visibility: "PUBLIC", type: input.type,
    tickers: [...new Set(input.tickers.map(ticker => ticker.trim().toUpperCase()).filter(ticker => /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker)))].sort(),
    occurredAt: input.filingDate, occurredAtPrecision: "date", publishedAt, updatedAt: publishedAt,
    title: `${entity}: ${form}${input.amended ? " amendment" : " filing"}`,
    summary: input.type === "SEC_FORM4"
      ? "An insider ownership filing was processed. The filing date may differ from the dates of the reported transactions."
      : "An institutional holdings filing was processed. Holdings describe a past reporting period, not current trades.",
    sourceName: "SEC EDGAR", sourceUrl: url.href, accessionNumber: input.accessionNumber,
  };
}

/** Allowlist fields instead of returning arbitrary database document contents. */
export function publicEventFromDocument(id: string, data: Record<string, unknown>): PublicEvent | null {
  if (data.visibility !== "PUBLIC" || data.schemaVersion !== 1 || (data.type !== "SEC_FORM4" && data.type !== "SEC_13F")) return null;
  if (data.id !== id || data.dedupeKey !== id || data.occurredAtPrecision !== "date" || data.sourceName !== "SEC EDGAR") return null;
  const strings = ["occurredAt", "publishedAt", "updatedAt", "title", "summary", "sourceUrl", "accessionNumber"] as const;
  if (strings.some(key => typeof data[key] !== "string")) return null;
  if (!Array.isArray(data.tickers) || data.tickers.some(ticker => typeof ticker !== "string")) return null;
  try {
    const checked = filingEvent({ type: data.type, accessionNumber: data.accessionNumber as string, filingDate: data.occurredAt as string, sourceUrl: data.sourceUrl as string, entityName: data.title as string, tickers: data.tickers, amended: false }, data.publishedAt as string);
    if (checked.id !== id || !isEventTimestamp(data.updatedAt as string)) return null;
    return { ...checked, title: (data.title as string).slice(0, 240), summary: (data.summary as string).slice(0, 1000), updatedAt: data.updatedAt as string };
  } catch { return null; }
}
