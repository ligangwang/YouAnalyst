import assert from 'node:assert/strict';
import test from 'node:test';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { loadCachedFeed, encodeFeedDay, decodeFeedDay } from '../../src/lib/intelligence/feed-cache-store';
import { markFeedChanged } from '../../src/lib/intelligence/feed-cache-changes';
import { feedWindow, requestedFeedDays, mergeFeedChanges, type FeedRecord } from '../../src/lib/intelligence/feed-cache';

const noon = new Date('2026-10-16T16:00:00Z');
const record = (id: string, day = '2026-10-16', title = id): FeedRecord => ({ collection: 'events', id, data: { id, type: 'company_news', publication_date: day, published_at: null, title } });

// A shared, transactional store with commit timestamps and independently cached
// client objects simulates restarts, concurrent servers, and failed writes.
function database() {
  type Row = Record<string, unknown>;
  type Ref = { path: string };
  const data = new Map<string, Row>();
  const queries: Array<{ collection: string; filters: Array<[string, string, unknown]> }> = [];
  let time = noon.getTime(), failPublication = false;
  let chain = Promise.resolve();
  const value = (v: unknown): string | number | null => v instanceof Timestamp ? v.toMillis() : v as string | number | null;
  const snap = (ref: Ref) => ({ id: ref.path.split('/').at(-1)!, ref, exists: data.has(ref.path), readTime: Timestamp.fromMillis(time), data: () => data.get(ref.path), get: (key: string) => data.get(ref.path)?.[key] });
  const client = () => {
    const collection = (name: string) => {
      const query = (filters: Array<[string, string, unknown]> = [], after = '', count = 500) => ({
        doc: (id: string) => ({ path: `${name}/${id}` }),
        where: (field: string, op: string, test: unknown) => query([...filters, [field, op, test]], after, count),
        orderBy: () => query(filters, after, count),
        limit: (limit: number) => query(filters, after, limit),
        startAfter: (doc: { id: string }) => query(filters, doc.id, count),
        get: async () => {
          queries.push({ collection: name, filters });
          const docs = [...data].filter(([path, row]) => path.startsWith(name + '/') && path.split('/').at(-1)! > after && filters.every(([field, op, expected]) => {
            const a = value(row[field]), b = value(expected);
            if (a === undefined) return false;
            return op === '==' ? a === b : op === '>=' ? a! >= b! : op === '<=' ? a! <= b! : op === '>' ? a! > b! : a! < b!;
          })).sort(([a], [b]) => a.localeCompare(b)).slice(0, count).map(([path]) => snap({ path }));
          return { docs, size: docs.length };
        },
      });
      return query();
    };
    const db = {
      collection,
      getAll: async (...refs: Ref[]) => refs.map(snap),
      runTransaction: <T>(run: (tx: unknown) => Promise<T>) => {
        const request = chain.then(async () => {
          const writes: Array<() => void> = [];
          const commitTime = Timestamp.fromMillis(++time);
          const tx = {
            get: async (ref: Ref) => snap(ref), getAll: async (...refs: Ref[]) => refs.map(snap),
            set: (ref: Ref, row: Row, options?: { merge?: boolean }) => {
              if (failPublication && ref.path === 'collectors/_feed_cache_v1' && row.days) { failPublication = false; throw Error('Injected publication failure'); }
              const resolved = Object.fromEntries(Object.entries(row).map(([key, val]) => [key, val instanceof FieldValue && val.isEqual(FieldValue.serverTimestamp()) ? commitTime : val]));
              writes.push(() => data.set(ref.path, options?.merge ? { ...data.get(ref.path), ...resolved } : resolved));
            },
            delete: (ref: Ref) => writes.push(() => { data.delete(ref.path); }),
          };
          const result = await run(tx); writes.forEach(write => write()); return result;
        });
        chain = request.then(() => {}, () => {}); return request;
      },
    } as unknown as Firestore;
    return db;
  };
  const save = async (db: Firestore, row: FeedRecord) => db.runTransaction(async tx => {
    const ref = db.collection(row.collection).doc(row.id);
    tx.set(ref, row.data); markFeedChanged(db, tx, ref);
  });
  return { client, save, data, queries, failNextPublication: () => { failPublication = true; } };
}

test('starts with today, persists across clients, and never reloads history on a timer', async () => {
  const store = database(), first = store.client();
  await store.save(first, record('today')); await store.save(first, record('yesterday', '2026-10-15'));
  const initial = await loadCachedFeed(first, noon);
  assert.deepEqual(Object.keys(initial.days), ['2026-10-16']); assert.equal(initial.days['2026-10-16'].length, 1);
  const reads = store.queries.length;
  const restarted = await loadCachedFeed(store.client(), new Date(noon.getTime() + 3_600_000));
  assert.deepEqual(restarted.days, initial.days); assert.equal(store.queries.length, reads);
  assert.equal(restarted.revision, initial.revision);
});

test('arrival and correction notifications only read deltas, and retries do not duplicate items', async () => {
  const store = database(), db = store.client(); await store.save(db, record('a'));
  await loadCachedFeed(db, noon); const start = store.queries.length;
  await store.save(db, record('b')); await store.save(db, record('a', '2026-10-16', 'Corrected'));
  const next = await loadCachedFeed(db, noon);
  assert.equal(next.days['2026-10-16'].length, 2); assert.equal(next.days['2026-10-16'].find(row => row.id === 'a')?.data.title, 'Corrected');
  assert(store.queries.slice(start).every(query => query.filters.some(([key]) => key === 'feedCacheChangedAt')));
  const reads = store.queries.length; await loadCachedFeed(store.client(), noon); assert.equal(store.queries.length, reads);
});

test('an older day is loaded once and reused across users; stale cursors do not expand again', async () => {
  const store = database(), a = store.client(), b = store.client();
  await store.save(a, record('yesterday', '2026-10-15')); await loadCachedFeed(a, noon);
  const [one, two] = await Promise.all([loadCachedFeed(a, noon, '2026-10-16'), loadCachedFeed(b, noon, '2026-10-16')]);
  assert.equal(one.loadedFrom, '2026-10-15'); assert.equal(two.loadedFrom, one.loadedFrom);
  const reads = store.queries.length;
  await loadCachedFeed(b, noon, '2026-10-16'); assert.equal(store.queries.length, reads);
  const next = await loadCachedFeed(b, noon, '2026-10-15'); assert.equal(next.loadedFrom, '2026-10-14');
});

test('late arrivals update previously loaded days without eagerly loading untouched history', async () => {
  const store = database(), db = store.client(); await loadCachedFeed(db, noon, '2026-10-16');
  await store.save(db, record('late', '2026-10-15')); await store.save(db, record('older', '2026-10-13'));
  const next = await loadCachedFeed(db, noon);
  assert.equal(next.days['2026-10-15'].length, 1); assert.equal(next.days['2026-10-13'], undefined);
  await store.save(db, record('late', '2026-10-16'));
  const corrected = await loadCachedFeed(db, noon);
  assert.equal(corrected.days['2026-10-15'].length, 0); assert.equal(corrected.days['2026-10-16'].length, 1);
});

test('seven-day cap and Eastern midnight eviction delete cache chunks, not source records', async () => {
  const store = database(), db = store.client(); await store.save(db, record('old', '2026-10-10'));
  let loaded = await loadCachedFeed(db, noon);
  for (let i = 0; i < 8; i++) loaded = await loadCachedFeed(db, noon, loaded.loadedFrom);
  assert.equal(loaded.loadedFrom, '2026-10-10'); assert.equal(loaded.hasMore, false); assert.equal(Object.keys(loaded.days).length, 7);
  const next = await loadCachedFeed(db, new Date('2026-10-17T04:00:00Z'));
  assert.equal(next.loadedFrom, '2026-10-11'); assert.equal(next.days['2026-10-10'], undefined);
  assert(store.data.has('events/old')); assert(![...store.data.keys()].some(key => key.startsWith('collectors/_feed_cache_v1_2026-10-10')));
});

test('failed cache publication preserves checkpoint and retries the same notification', async () => {
  const store = database(), db = store.client(); const first = await loadCachedFeed(db, noon);
  await store.save(db, record('new')); store.failNextPublication();
  await assert.rejects(loadCachedFeed(db, noon), /Injected/);
  assert.equal(store.data.get('collectors/_feed_cache_v1')?.revision, first.revision);
  const retried = await loadCachedFeed(store.client(), noon); assert.equal(retried.days['2026-10-16'][0].id, 'new');
});

test('missing persistent chunks recover only their day after a restart', async () => {
  const store = database(), db = store.client(); await store.save(db, record('today')); await loadCachedFeed(db, noon);
  const chunk = [...store.data.keys()].find(key => key.startsWith('collectors/_feed_cache_v1_2026-10-16'))!;
  store.data.delete(chunk);
  const recovered = await loadCachedFeed(store.client(), noon); assert.equal(recovered.days['2026-10-16'][0].id, 'today');
});

test('calendar dates, not 24-hour buckets, bound the cache through daylight-saving changes', () => {
  assert.deepEqual(feedWindow(new Date('2026-11-02T04:59:00Z')), { today: '2026-11-01', oldest: '2026-10-26' });
  assert.deepEqual(feedWindow(new Date('2026-11-02T05:00:00Z')), { today: '2026-11-02', oldest: '2026-10-27' });
  assert.deepEqual(requestedFeedDays([], noon, '2020-01-01'), ['2026-10-16']);
  assert.deepEqual(requestedFeedDays(['2026-09-01'], noon), ['2026-10-16']);
});

test('compression round-trips large days; identity-based upserts preserve independent sources', () => {
  const rows = Array.from({ length: 3000 }, (_, i) => record(String(i)));
  assert.deepEqual(decodeFeedDay(encodeFeedDay(rows)), rows);
  const days = mergeFeedChanges({ '2026-10-16': [] }, [record('a'), record('a'), record('b')]);
  assert.equal(days['2026-10-16'].length, 2);
});


test('a delayed request from yesterday cannot roll shared cache storage backwards',async()=>{
  const store=database(),db=store.client();
  await loadCachedFeed(db,new Date('2026-10-17T04:00:00Z'));
  const delayed=await loadCachedFeed(store.client(),noon);
  assert.equal(delayed.days['2026-10-16'],undefined);
  assert(delayed.days['2026-10-17']);
});

test('timestamped SEC publications use the New York publication day even when filingDate differs',async()=>{
  const store=database(),db=store.client();
  await store.save(db,{collection:'sec_filings',id:'filing',data:{filingDate:'2026-10-01',published_at:'2026-10-16T13:00:00Z'}});
  const cached=await loadCachedFeed(db,noon);
  assert.equal(cached.days['2026-10-16'][0].id,'filing');
});


test('idle days are loaded on demand without presenting a gap as complete history',async()=>{
  const store=database(),db=store.client();
  await loadCachedFeed(db,new Date('2026-10-14T16:00:00Z'));
  const today=await loadCachedFeed(db,noon);
  assert.equal(today.loadedFrom,'2026-10-16');
  const reads=store.queries.length;
  const filled=await loadCachedFeed(db,noon,today.loadedFrom);
  assert.equal(filled.loadedFrom,'2026-10-14');
  assert(store.queries.slice(reads).every(query=>query.filters.some(([, , value])=>String(value).includes('2026-10-15'))));
});
