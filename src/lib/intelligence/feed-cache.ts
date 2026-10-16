import { intelligenceSession, observation } from './model';

export const FEED_DAYS = 7;
export type FeedRecord = { collection: 'events' | 'sec_filings'; id: string; data: Record<string, unknown> };
export type FeedDays = Record<string, FeedRecord[]>;
export function shiftFeedDay(day: string, offset: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}
export function feedRecordDay(record: FeedRecord) {
  const data = record.data;
  if (record.collection === 'events' && !['company_news', 'company_disclosure'].includes(String(data.type))) return null;
  return observation(data.published_at ?? (record.collection === 'sec_filings' ? data.filingDate : data.publication_date))?.day ?? null;
}
export function feedWindow(now: Date) {
  const today = intelligenceSession(now).date;
  return { today, oldest: shiftFeedDay(today, 1 - FEED_DAYS) };
}
export function loadedFeedFrom(days:string[]){
  const present=new Set(days);
  let first=[...days].sort().at(-1)!;
  while(present.has(shiftFeedDay(first,-1)))first=shiftFeedDay(first,-1);
  return first;
}
/** One request can open only the next uncached day. Replayed cursors are safe. */
export function requestedFeedDays(existing: string[], now: Date, before?: string) {
  const { today, oldest } = feedWindow(now);
  const days = [...new Set([...existing.filter(day => day >= oldest && day <= today), today])].sort();
  if (before && before === loadedFeedFrom(days) && before > oldest) days.push(shiftFeedDay(before, -1));
  return days.sort();
}
/** Upsert by source identity, including corrections that move an item to a new day. */
export function mergeFeedChanges(days: FeedDays, records: FeedRecord[]): FeedDays {
  const changed = new Set(records.map(row => `${row.collection}/${row.id}`));
  const result = Object.fromEntries(Object.entries(days).map(([day, rows]) => [day, rows.filter(row => !changed.has(`${row.collection}/${row.id}`))]));
  for (const row of new Map(records.map(row => [`${row.collection}/${row.id}`, row])).values()) {
    const day = feedRecordDay(row);
    if (day && result[day]) result[day].push(row);
  }
  return result;
}
