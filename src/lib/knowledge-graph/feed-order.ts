import type { CompanyUpdate } from "./company-updates";

/** "event": event/announcement date, newest first (source date, then collected date when no event date). "added": collected date. */
export type FeedOrder = "event" | "added";
/** One feed card: a primary update plus evidence updates that describe the same event. */
export type FeedEntry = { item: CompanyUpdate; evidence: CompanyUpdate[] };

const day = (value: string | null | undefined): string | null => value ? value.slice(0, 10) : null;

/** The event happened before it was collected, so the collection date is not a new business event. */
export function collectedLater(item: CompanyUpdate): boolean {
  const eventDay = day(item.eventDate);
  return Boolean(eventDay && day(item.collectedAt)! > eventDay);
}

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
  const events = items.filter(item => item.kind === "BUSINESS");
  const entries = new Map<string, FeedEntry>(events.map(item => [item.id, { item, evidence: [] }]));
  const standalone: FeedEntry[] = [];
  for (const item of items) {
    if (item.kind === "BUSINESS") continue;
    const event = events.find(candidate => sameEvent(item, candidate));
    if (event) entries.get(event.id)!.evidence.push(item);
    else standalone.push({ item, evidence: [] });
  }
  for (const entry of entries.values()) entry.evidence.sort((a, b) => b.collectedAt.localeCompare(a.collectedAt) || a.id.localeCompare(b.id));
  return [...entries.values(), ...standalone];
}

/** Most recent collection/review time across a card and its grouped evidence. */
export function entryCollectedAt(entry: FeedEntry): string {
  return entry.evidence.reduce((latest, item) => item.collectedAt > latest ? item.collectedAt : latest, entry.item.collectedAt);
}

export function orderFeed(entries: FeedEntry[], order: FeedOrder = "event"): FeedEntry[] {
  const key = (entry: FeedEntry) => order === "event" ? day(entry.item.eventDate) ?? day(entry.item.sourceDate) ?? day(entry.item.collectedAt) ?? "" : entryCollectedAt(entry);
  return [...entries].sort((a, b) => key(b).localeCompare(key(a)) || entryCollectedAt(b).localeCompare(entryCollectedAt(a)) || a.item.id.localeCompare(b.item.id));
}
