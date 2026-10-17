import type { Firestore } from 'firebase-admin/firestore';
import {AsyncLocalStorage} from 'node:async_hooks';

// Existing collection; this document is written only by the authenticated change receiver.
export const CHANGE_CACHE_DOCUMENT = '_read_cache_versions_v1';
export const CHANGE_CACHE_COLLECTIONS = ['companies', 'company_relationships', 'company_fundamentals',
  'eod_prices', 'corporate_actions', 'earnings_records', 'collectors', 'events', 'users', 'directory_syncs', 'predictions', 'watchlists'] as const;
export type CacheCollection = typeof CHANGE_CACHE_COLLECTIONS[number];
type State = { enabled?: boolean; versions?: Record<string, string> };
type Entry = { version: string; value: Promise<unknown> };
const caches = new WeakMap<Firestore, Map<string, Entry>>();
const pendingStates = new WeakMap<Firestore, Promise<State>>();
const scopes=new AsyncLocalStorage<Map<Firestore,Promise<State>>>();
export function withCacheReadScope<T>(work:()=>Promise<T>):Promise<T>{
  return scopes.getStore()?work():scopes.run(new Map(),work);
}

/** Coalesce concurrent checks only. Never keep a version check on a timer. */
export async function readCacheState(db: Firestore): Promise<State> {
  const scope=scopes.getStore(),scoped=scope?.get(db);if(scoped)return scoped;
  const pending = pendingStates.get(db); if (pending) { scope?.set(db,pending); return pending; }
  const request = db.collection('collectors').doc(CHANGE_CACHE_DOCUMENT).get().then(doc => (doc.data() ?? {}) as State);
  scope?.set(db,request);
  pendingStates.set(db, request);
  try { return await request; } finally { if (pendingStates.get(db) === request) pendingStates.delete(db); }
}

/** Cache until a relevant write, never until a timestamp. Failed loads are retried.
 * Disabled/missing receiver configuration bypasses caching instead of freezing data.
 * Capacity eviction and process restarts can require a fresh load.
 */
export async function changeCached<T>(db: Firestore, key: string, collections: readonly CacheCollection[], load: () => Promise<T>, cacheWhen: (value:T)=>boolean=()=>true): Promise<T> {
  if(!scopes.getStore())return withCacheReadScope(()=>changeCached(db,key,collections,load,cacheWhen));
  const state = await readCacheState(db);
  if (!state.enabled) { caches.delete(db); return load(); }
  const version = JSON.stringify(collections.map(name => state.versions?.[name] ?? 'initial'));
  let cache = caches.get(db); if (!cache) { cache = new Map(); caches.set(db, cache); }
  const hit = cache.get(key);
  if (hit?.version === version) { cache.delete(key); cache.set(key, hit); return hit.value as Promise<T>; }
  const entry = { version, value: Promise.resolve().then(load) };
  cache.delete(key); cache.set(key, entry);
  if (cache.size > 1024) cache.delete(cache.keys().next().value!);
  try {
    const value=await entry.value;
    if(!cacheWhen(value)&&cache.get(key)===entry)cache.delete(key);
    return value;
  }
  catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
}

/** Eventarc deliveries are at least once and unordered. Every delivery invalidates;
 * never compare event timestamps and accidentally discard an older late delivery.
 * Cache bookkeeping is excluded to prevent recursive invalidation.
 */
export async function applyCacheChange(db: Firestore, headers: Headers, project: string) {
  if (headers.get('ce-type') !== 'google.cloud.firestore.document.v1.written'
    || headers.get('ce-source') !== `//firestore.googleapis.com/projects/${project}/databases/(default)`
    || !headers.get('ce-id')) throw new Error('Invalid Firestore change event');
  const path = /^documents\/([^/]+)\/([^/]+)$/.exec(headers.get('ce-subject') ?? '');
  if (!path || !CHANGE_CACHE_COLLECTIONS.includes(path[1] as CacheCollection)) throw new Error('Unexpected change document');
  const [, collection, id] = path;
  if (collection === 'collectors' && id.startsWith('_')) return;
  // A duplicate delivery may invalidate again, but can never restore stale data.
  const { randomUUID } = await import('node:crypto');
  const probeNonce=collection==='collectors'&&id==='cache-change-probe'
    ? (await db.collection(collection).doc(id).get()).get('nonce') : undefined;
  await db.collection('collectors').doc(CHANGE_CACHE_DOCUMENT).set({ versions: { [collection]: randomUUID() },
    ...(typeof probeNonce==='string'?{probeNonce}:{}) }, { merge: true });
}
