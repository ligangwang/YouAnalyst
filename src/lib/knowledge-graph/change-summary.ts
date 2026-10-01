import type { CompanyUpdate } from "./company-updates";

/** A bounded reading list, not an inferred before/after history or impact model. */
export function researchChangeSummary(items: CompanyUpdate[], limit = 3): CompanyUpdate[] {
  const dated = (item: CompanyUpdate) => (item.eventDate ?? item.sourceDate ?? "").slice(0, 10);
  const events = items.filter(item => item.kind === "BUSINESS");
  const candidates = events.length ? events : items.filter(item => item.kind === "RESEARCH");
  return [...new Map(candidates.map(item => [item.id, item])).values()]
    .sort((a, b) => dated(b).localeCompare(dated(a)) || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, Math.min(5, Math.floor(limit))));
}
