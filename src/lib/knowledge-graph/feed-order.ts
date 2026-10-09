import type { CompanyUpdate } from "./company-updates";

/** Legacy order selectors are accepted; investor ordering always uses source publication. */
export type FeedOrder = "event" | "added";
/** One feed card: a primary update plus evidence updates that describe the same event. */
export type FeedEntry = { item: CompanyUpdate; evidence: CompanyUpdate[] };

const day = (value: string | null | undefined): string | null => value ? value.slice(0, 10) : null;

function sameEvent(evidence: CompanyUpdate, event: CompanyUpdate): boolean {
  if (evidence.sourceUrl && evidence.sourceUrl === event.sourceUrl) return true;
  const eventDay = day(event.eventDate);
  if (!eventDay || day(evidence.eventDate) !== eventDay) return false;
  const relationshipId = event.edgeId ?? event.business?.relationshipId;
  if (evidence.edgeId && relationshipId) return evidence.edgeId === relationshipId;
  return evidence.companyIds.length > 0 && evidence.companyIds.every(id => event.companyIds.includes(id));
}

/** Evidence added / reviewed for a curated business event is shown under that event instead of as a second card. */
export function groupFeedUpdates(items: CompanyUpdate[]): FeedEntry[] {
  items = deduplicateUpdates(items);
  const events = items.filter(item => item.kind === "BUSINESS");
  const entries = new Map<string, FeedEntry>(events.map(item => [item.id, { item, evidence: [] }]));
  const standalone: FeedEntry[] = [];
  for (const item of items) {
    if (item.kind === "BUSINESS") continue;
    const event = events.find(candidate => sameEvent(item, candidate));
    if (event) entries.get(event.id)!.evidence.push(item);
    else standalone.push({ item, evidence: [] });
  }
  for (const entry of entries.values()) entry.evidence.sort((a, b) => (b.published_at??b.sourceDate??'').localeCompare(a.published_at??a.sourceDate??'') || a.id.localeCompare(b.id));
  return [...entries.values(), ...standalone];
}

const normalized = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
function sourceKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch { return value.trim(); }
}
// A single source can document several relationships. Keep distinct evidence
// scopes while collapsing repeated imports of the same event or evidence.
export function deduplicateUpdates(items: CompanyUpdate[]): CompanyUpdate[] {
  const ids = new Set<string>(), urls = new Set<string>(), titles = new Set<string>();
  return [...items].sort((a, b) => (b.collectedAt ?? b.published_at ?? "").localeCompare(a.collectedAt ?? a.published_at ?? "") || a.id.localeCompare(b.id)).filter(item => {
    const scope = JSON.stringify([item.kind, [...item.companyIds].sort(), day(item.eventDate) ?? day(item.sourceDate), item.state,
      item.kind === "RESEARCH" ? [item.edgeId, normalized(item.description)] : item.business?.category]);
    const url = item.sourceUrl ? `${scope}:${sourceKey(item.sourceUrl)}` : "";
    const title = normalized(item.business?.title ?? item.sourceTitle);
    const titleKey = title ? `${scope}:${title}` : "";
    const duplicate = ids.has(item.id) || Boolean(url && urls.has(url)) || Boolean(titleKey && titles.has(titleKey));
    ids.add(item.id);
    if (url) urls.add(url);
    if (titleKey) titles.add(titleKey);
    return !duplicate;
  });
}

export function orderFeed(entries: FeedEntry[], order: FeedOrder = "event"): FeedEntry[] {
  void order; // Legacy URLs still resolve to the publication-ordered investor feed.
  const key = (entry: FeedEntry) => entry.item.published_at??entry.item.sourceDate??'';
  return [...entries].sort((a, b) => key(b).localeCompare(key(a)) || a.item.id.localeCompare(b.item.id));
}
