import { centralRequest } from './central-cache/client';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {companyChangeKey,companyChangeShard,companyChangeDocument,marketCapChanged,type CompanyIndex,type IndexedCollection,type CompanyChange} from './company-change-index';

// Existing collection; this document is written only by the authenticated change receiver.
export const CHANGE_CACHE_DOCUMENT = '_read_cache_versions_v1';
export const CHANGE_CACHE_COLLECTIONS = ['companies', 'company_relationships', 'company_fundamentals',
  'eod_prices', 'corporate_actions', 'earnings_records', 'collectors', 'events', 'users', 'directory_syncs', 'predictions', 'watchlists'] as const;
export type CacheCollection = typeof CHANGE_CACHE_COLLECTIONS[number];
export type State = { enabled?: boolean; versions?: Record<string, string>; companyIndexes?: Record<string, CompanyIndex>; collectorDocumentsTracked?: boolean };
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
export async function changeCached<T>(db: Firestore, key: string, collections: readonly (CacheCollection | `collector:${string}`)[], load: () => Promise<T>, cacheWhen: (value:T)=>boolean=()=>true): Promise<T> {
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

/** Invalidate a list of canonical document IDs. A single event is a one-item list.
 * Duplicate IDs are collapsed, and each touched shard is written once per chunk.
 * Large lists commit in bounded chunks; callers must retry a failed call (completed
 * chunks are safe to invalidate again). This updates metadata, not source documents.
 */
export async function invalidateCompanyDocuments(db: Firestore, collection: IndexedCollection, companyIds: readonly string[], options: {marketCapChanged?: boolean} = {}) {
  const ids = [...new Set(companyIds)];
  if (ids.some(id => !id || id.includes('/') || Buffer.byteLength(id, 'utf8') > 1500)) throw Error('Invalid company ID');
  const stateRef = db.collection('collectors').doc(CHANGE_CACHE_DOCUMENT);
  for (let offset = 0; offset < ids.length; offset += 500) {
    const version = randomUUID();
    const shards = new Map<string, Record<string, CompanyChange>>();
    for (const id of ids.slice(offset, offset + 500)) {
      const shard = companyChangeShard(id), entries = shards.get(shard) ?? {};
      entries[companyChangeKey(id)] = {id,version,
        ...(collection === 'company_fundamentals' && options.marketCapChanged !== false ? {marketCap:version} : {})};
      shards.set(shard,entries);
    }
    await db.runTransaction(async transaction => {
      const state = (await transaction.get(stateRef)).data() as State | undefined;
      const index = state?.companyIndexes?.[collection];
      // Preserve gaps from old receivers, even when no reader observed the gap.
      const generation = index?.generation && index.version === state?.versions?.[collection] ? index.generation : randomUUID();
      for (const [shard,entries] of shards) transaction.set(
        db.collection('collectors').doc(companyChangeDocument(collection,shard)), {entries}, {merge:true});
      // Atomic publication: the index pointer cannot precede its ID updates.
      transaction.set(stateRef, {versions:{[collection]:version},companyIndexes:{[collection]:{
        version,generation,shards:Object.fromEntries([...shards.keys()].map(shard=>[shard,version])),
      }}}, {merge:true});
    });
  }
}

/** Eventarc deliveries are at least once and unordered. Every delivery invalidates;
 * never compare event timestamps and accidentally discard an older late delivery.
 * Cache bookkeeping is excluded to prevent recursive invalidation.
 */
export async function applyCacheChange(db: Firestore, headers: Headers, project: string, body?: Uint8Array) {
  if (headers.get('ce-type') !== 'google.cloud.firestore.document.v1.written'
    || headers.get('ce-source') !== `//firestore.googleapis.com/projects/${project}/databases/(default)`
    || !headers.get('ce-id')) throw new Error('Invalid Firestore change event');
  const path = /^documents\/([^/]+)\/([^/]+)$/.exec(headers.get('ce-subject') ?? '');
  if (!path || !CHANGE_CACHE_COLLECTIONS.includes(path[1] as CacheCollection)) throw new Error('Unexpected change document');
  const [, collection, id] = path;
  if (collection === 'collectors' && id.startsWith('_')) return;
  // Operational locks/batch ledgers are not company data and must not fan out
  // into central fundamentals refreshes. Collector freshness is still observed.
  if (collection === 'company_fundamentals' && id.startsWith('_') && id !== '_sec_filings_collector') return;
  // A duplicate delivery may invalidate again, but can never restore stale data.
  if (collection === 'companies' || collection === 'company_fundamentals' || collection === 'company_relationships') {
    if (process.env.CENTRAL_CACHE_URL) {
      // Persist hard deletions before publishing the collection version. Existing
      // collectors collection; underscore IDs are excluded from event recursion.
      const changedDoc=await db.collection(collection).doc(id).get();
      const themes=changedDoc.get('themeIds');
      if (!changedDoc.exists || (collection==='companies' && (!Array.isArray(themes) || !themes.some(theme=>['ai','robotics','space'].includes(theme))))) await db.collection('collectors')
        .doc(`_cache_deleted_${companyChangeKey(`${collection}/${id}`)}`).set({cacheDeletedCollection:collection,sourceId:id,cacheUpdatedAt:FieldValue.serverTimestamp()});
      await db.collection('collectors').doc(CHANGE_CACHE_DOCUMENT).set({versions:{[collection]:randomUUID()}},{merge:true});
      if(await centralRequest('/change',{collection,ids:[id]})===undefined)throw Error('Central cache change delivery failed');
      return;
    }
    await invalidateCompanyDocuments(db, collection, [id], {
      marketCapChanged: marketCapChanged(body, headers.get('content-type') ?? ''),
    });
    return;
  }
  const probeNonce=collection==='collectors'&&id==='cache-change-probe'
    ? (await db.collection(collection).doc(id).get()).get('nonce') : undefined;
  await db.collection('collectors').doc(CHANGE_CACHE_DOCUMENT).set({ versions: { [collection]: randomUUID(), ...(collection === 'collectors' ? { [`collector:${id}`]: randomUUID() } : {}) },
    ...(collection === 'collectors' ? {collectorDocumentsTracked:true} : {}),
    ...(typeof probeNonce==='string'?{probeNonce}:{}) }, { merge: true });
}
