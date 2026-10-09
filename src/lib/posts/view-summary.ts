import type { ViewEvidence } from "./evidence";

export type CompanyViewSummary = {
  /** Distinct analysts with an active public view on the company. */
  analysts: number;
  bullish: number;
  bearish: number;
  /** Research cited by those views, most cited first. */
  citations: Array<Pick<ViewEvidence, "kind" | "id" | "label" | "href"> & { views: number }>;
};

type ViewRow = { userId?: unknown; direction?: unknown; status?: unknown; visibility?: unknown; evidence?: unknown };
const ACTIVE = new Set(["CREATED", "OPEN", "CLOSING"]);

/** Summarizes active public views; settled, canceled and private views are not counted. */
export function summarizeCompanyViews(rows: ViewRow[], citationLimit = 3): CompanyViewSummary {
  const active = rows.filter(row => row.visibility === "PUBLIC" && typeof row.status === "string" && ACTIVE.has(row.status) && typeof row.userId === "string" && row.userId);
  const citations = new Map<string, CompanyViewSummary["citations"][number]>();
  for (const row of active) {
    const cited = Array.isArray(row.evidence) ? row.evidence as ViewEvidence[] : [];
    for (const item of new Map(cited.filter(item => item && typeof item.id === "string" && typeof item.href === "string" && item.label).map(item => [`${item.kind}:${item.id}`, item])).values()) {
      const key = `${item.kind}:${item.id}`;
      const entry = citations.get(key) ?? { kind: item.kind, id: item.id, label: item.label, href: item.href, views: 0 };
      entry.views += 1;
      citations.set(key, entry);
    }
  }
  return {
    analysts: new Set(active.map(row => row.userId as string)).size,
    bullish: active.filter(row => row.direction === "UP").length,
    bearish: active.filter(row => row.direction === "DOWN").length,
    citations: [...citations.values()].sort((a, b) => b.views - a.views || a.label.en.localeCompare(b.label.en)).slice(0, citationLimit),
  };
}
