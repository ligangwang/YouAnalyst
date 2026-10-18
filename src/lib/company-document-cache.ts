import { centralDocuments } from './central-cache/client';
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import { readCacheState, withCacheReadScope, type State } from './change-cache';
import { companyChangeDocument, companyChangeKey, companyChangeShard, type CompanyChange, type IndexedCollection } from './company-change-index';

type Entry<T> = { version: string; value: Promise<T> };
type Shard = Record<string, CompanyChange>;
const shardCaches = new WeakMap<Firestore, Map<string, Entry<Shard>>>();
const documents = new WeakMap<Firestore, Map<string, Entry<DocumentSnapshot>>>();
function cacheFor<T>(store: WeakMap<Firestore, Map<string, T>>, db: Firestore) {
  let cache = store.get(db); if (!cache) { cache = new Map(); store.set(db, cache); } return cache;
}
export function hasCompanyIndex(state: State, collection: IndexedCollection) {
  const index = state.companyIndexes?.[collection];
  return !!state.enabled && !!index && index.version === state.versions?.[collection];
}
export async function companyVersions(db: Firestore, collection: IndexedCollection, state: State, shards: string[]): Promise<Shard> {
  const cache = cacheFor(shardCaches, db), index = state.companyIndexes?.[collection];
  const result = await Promise.all([...new Set(shards)].map(shard => {
    const version = index?.shards[shard];
    if (!version) return {};
    const key = `${collection}:${shard}`, hit = cache.get(key);
    if (hit?.version === version) return hit.value;
    const entry = { version, value: db.collection('collectors').doc(companyChangeDocument(collection, shard)).get().then(doc => {
      if (!doc.exists) throw Error('Company change index unavailable');
      return (doc.get('entries') ?? {}) as Shard;
    }) };
    cache.set(key, entry);
    entry.value.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
    return entry.value;
  }));
  return Object.assign({}, ...result);
}

/** Cache each canonical company ID independently. Missing docs are cached too;
 * create/delete events change their token. Metadata is shared between instances,
 * but snapshots and in-flight loads remain process-local. No timer expiry.
 */
export function loadCompanyDocuments(db: Firestore, collection: IndexedCollection, ids: string[], projection: 'full' | 'marketCap' = 'full'): Promise<DocumentSnapshot[]> {
  return withCacheReadScope(async () => {
    if (!ids.length) return [];
    const central=await centralDocuments(db,collection,ids,undefined,projection==='marketCap'?'marketCap':undefined);if(central)return central;
    const state = await readCacheState(db), cache = cacheFor(documents, db);
    if (!state.enabled) { documents.delete(db); shardCaches.delete(db); }
    const indexed = hasCompanyIndex(state, collection);
    const versions = indexed ? await companyVersions(db, collection, state, ids.map(companyChangeShard)) : {};
    const missing: { id: string; key: string; version: string }[] = [];
    const pending = new Map<string, Promise<DocumentSnapshot>>();
    for (const id of new Set(ids)) {
      const key = `${collection}:${projection}:${id}`, change = versions[companyChangeKey(id)];
      const version = indexed ? `id:${state.companyIndexes![collection].generation}:${projection === 'marketCap' ? change?.marketCap ?? 'initial' : change?.version ?? 'initial'}` : `legacy:${state.versions?.[collection] ?? 'initial'}`;
      const hit = cache.get(key);
      if (state.enabled && hit?.version === version) { pending.set(id, hit.value); continue; }
      missing.push({id,key,version});
    }
    for (let i = 0; i < missing.length; i += 100) {
      const batch = missing.slice(i, i + 100);
      const refs = batch.map(({id}) => db.collection(collection).doc(id));
      const load = projection === 'marketCap' ? db.getAll(...refs, {fieldMask:['marketCap']}) : db.getAll(...refs);
      batch.forEach(({id,key,version}, offset) => {
        const entry = {version, value: load.then(docs => docs[offset])};
        pending.set(id,entry.value);
        if (state.enabled) cache.set(key,entry); else cache.delete(key);
        entry.value.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
      });
    }
    // Bound memory for opportunistic non-enrolled company lookups, without TTLs.
    while (cache.size > 4096) cache.delete(cache.keys().next().value!);
    return Promise.all(ids.map(id => pending.get(id)!));
  });
}
