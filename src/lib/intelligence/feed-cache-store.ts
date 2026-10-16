import { randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { FEED_CHANGE_FIELD, FEED_REVISION_DOCUMENT } from './feed-cache-changes';
import { feedWindow, loadedFeedFrom, mergeFeedChanges, requestedFeedDays, type FeedDays, type FeedRecord } from './feed-cache';
import { intelligenceSession } from './model';
import { readPeriodDocuments } from './period-query';

const MANIFEST = '_feed_cache_v1';
const CHUNK_BYTES = 400_000;
type Checkpoint = { seconds: number; nanoseconds: number };
type Manifest = { days: Record<string, string[]>; checkpoint: Checkpoint; revision: string; through?: string; lease?: string; leaseUntil?: number };
export type CachedFeed = { days: FeedDays; revision: string; loadedFrom: string; hasMore: boolean };
const memory = new WeakMap<Firestore, { revision: string; days: FeedDays }>();
const pending = new WeakMap<Firestore, Promise<CachedFeed>>();
const stamp = (value: Checkpoint) => `${value.seconds}:${value.nanoseconds}`;
const plainStamp = (value: Timestamp): Checkpoint => ({ seconds: value.seconds, nanoseconds: value.nanoseconds });

// Compressed chunks keep the persistent shared cache below Firestore's 1 MiB
// document limit. No TTL: only rolling-window eviction removes cached days.
export function encodeFeedDay(records: FeedRecord[]) {
  const bytes = gzipSync(JSON.stringify(records));
  return Array.from({ length: Math.ceil(bytes.length / CHUNK_BYTES) }, (_, i) => bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES));
}
export function decodeFeedDay(chunks: Uint8Array[]): FeedRecord[] {
  return JSON.parse(gunzipSync(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))).toString('utf8'));
}

async function readDay(db: Firestore, day: string): Promise<FeedRecord[]> {
  const session = intelligenceSession(new Date(`${day}T12:00:00Z`));
  const events = db.collection('events');
  const groups = await Promise.all([
    readPeriodDocuments(db.collection('sec_filings').where('published_at', '>=', session.startAt).where('published_at', '<', session.endAt).orderBy('published_at', 'desc')),
    readPeriodDocuments(db.collection('sec_filings').where('published_at', '==', null).where('filingDate', '==', day).orderBy('filingDate', 'desc')),
    ...['company_news', 'company_disclosure'].flatMap(type => [
      readPeriodDocuments(events.where('type', '==', type).where('published_at', '>=', session.startAt).where('published_at', '<', session.endAt).orderBy('published_at', 'desc')),
      readPeriodDocuments(events.where('type', '==', type).where('published_at', '==', null).where('publication_date', '==', day).orderBy('publication_date', 'desc')),
    ]),
  ]);
  return groups.flatMap((docs, index) => docs.map(doc => ({ collection: index < 2 ? 'sec_filings' as const : 'events' as const, id: doc.id, data: Object.fromEntries(Object.entries(doc.data()).filter(([key])=>key!==FEED_CHANGE_FIELD)) })));
}
async function readChanges(db: Firestore, from: Checkpoint, through: Checkpoint) {
  const groups = await Promise.all((['sec_filings', 'events'] as const).map(async collection => {
    const docs = await readPeriodDocuments(db.collection(collection)
      .where(FEED_CHANGE_FIELD, '>', new Timestamp(from.seconds, from.nanoseconds))
      .where(FEED_CHANGE_FIELD, '<=', new Timestamp(through.seconds, through.nanoseconds))
      .orderBy(FEED_CHANGE_FIELD));
    return docs.map(doc => ({ collection, id: doc.id, data: Object.fromEntries(Object.entries(doc.data()).filter(([key])=>key!==FEED_CHANGE_FIELD)) }));
  }));
  return groups.flat();
}

async function restore(db: Firestore, state: Manifest): Promise<FeedDays> {
  const local = memory.get(db);
  if (local?.revision === state.revision) return local.days;
  const days: FeedDays = {};
  for (const [day, ids] of Object.entries(state.days)) {
    const docs = await db.getAll(...ids.map(id => db.collection('collectors').doc(id)));
    if (docs.some(doc => !doc.exists)) continue;
    try { days[day] = decodeFeedDay(docs.map(doc => doc.get('payload') as Uint8Array)); }
    catch { /* Rebuild only this missing/corrupt partition while holding the lease. */ }
  }
  return days;
}

async function update(db: Firestore, now: Date, before?: string): Promise<CachedFeed> {
  const ref = db.collection('collectors').doc(MANIFEST);
  const lease = randomUUID();
  let repair=false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const acquired = await db.runTransaction(async tx => {
      const [doc, revision] = await tx.getAll(ref, db.collection('collectors').doc(FEED_REVISION_DOCUMENT));
      const raw = doc.data();
      const state = raw?.days && raw?.checkpoint ? raw as Manifest : undefined;
      const effectiveNow=state?.through&&state.through>feedWindow(now).today?new Date(`${state.through}T12:00:00Z`):now;
      const target = requestedFeedDays(Object.keys(state?.days ?? {}), effectiveNow, before);
      const changedAt = revision.get('changedAt') as Timestamp | undefined;
      const checkpoint = changedAt ? plainStamp(changedAt) : state?.checkpoint ?? plainStamp(doc.readTime);
      const needsWork = repair || !state || stamp(state.checkpoint) !== stamp(checkpoint) || target.join() !== Object.keys(state.days).sort().join();
      if (!needsWork) return { state: state!, target, checkpoint, work: false };
      if (raw?.lease && Number(raw.leaseUntil) > Date.now()) return null;
      tx.set(ref, { lease, leaseUntil: Date.now() + 120_000 }, { merge: true });
      return { state, target, checkpoint, work: true };
    });
    if (!acquired) { await new Promise(resolve => setTimeout(resolve, 250)); continue; }
    const { state, target, checkpoint, work } = acquired;
    try {
      const restored = state?.days ? await restore(db, state) : {};
      if(!work&&target.some(day=>!restored[day])){repair=true;continue;}
      let days: FeedDays = Object.fromEntries(target.filter(day => restored[day]).map(day => [day, restored[day]]));
      if (work) {
        for (const day of target) if (!days[day]) days = mergeFeedChanges({ ...days, [day]: [] }, await readDay(db, day));
        if (state?.checkpoint && Object.keys(restored).some(day=>target.includes(day)) && stamp(state.checkpoint) !== stamp(checkpoint)) days = mergeFeedChanges(days, await readChanges(db, state.checkpoint, checkpoint));
        const revision = randomUUID();
        const chunks: Array<{ id: string; payload: Buffer }> = [];
        const dayRefs: Record<string, string[]> = {};
        for (const [day, rows] of Object.entries(days)) {
          if (JSON.stringify(rows) === JSON.stringify(restored[day])) { dayRefs[day] = state!.days[day]; continue; }
          dayRefs[day] = encodeFeedDay(rows).map((payload, i) => {
            const id = `${MANIFEST}_${day}_${revision}_${i}`;
            chunks.push({ id, payload }); return id;
          });
        }
        // Keep publication atomic; fail without advancing the checkpoint on an
        // unusually large day instead of silently losing part of the feed.
        if (chunks.reduce((sum, chunk) => sum + chunk.payload.length, 0) > 8_000_000) throw new Error('Feed cache update exceeds atomic write budget');
        await db.runTransaction(async tx => {
          const current = await tx.get(ref);
          if (current.get('lease') !== lease) throw new Error('Feed cache lease changed; retry');
          for (const chunk of chunks) tx.set(db.collection('collectors').doc(chunk.id), { payload: chunk.payload });
          const retained = new Set(Object.values(dayRefs).flat());
          for (const id of Object.values(state?.days ?? {}).flat()) if (!retained.has(id)) tx.delete(db.collection('collectors').doc(id));
          tx.set(ref, { days: dayRefs, through:target.at(-1), checkpoint, revision, lease: '', leaseUntil: 0 });
        });
        memory.set(db, { revision, days });
      } else memory.set(db, { revision: state!.revision, days });
      const cached = memory.get(db)!;
      const loadedFrom = loadedFeedFrom(Object.keys(days));
      return { ...cached, loadedFrom, hasMore: Object.keys(days).length < 7 };
    } catch (error) {
      if (work) await db.runTransaction(async tx => {
        const current = await tx.get(ref);
        if (current.get('lease') === lease) tx.set(ref, { lease: '', leaseUntil: 0 }, { merge: true });
      });
      throw error;
    }
  }
  throw new Error('Feed cache is being updated; please retry');
}

export async function loadCachedFeed(db: Firestore, now: Date, before?: string): Promise<CachedFeed> {
  // Recheck after another request completes: its cursor/day may differ.
  const active = pending.get(db);
  if (active) { try { await active; } catch { /* Retry failed work. */ } }
  const request = update(db, now, before);
  pending.set(db, request);
  try { return await request; } finally { if (pending.get(db) === request) pending.delete(db); }
}
