/* eslint-disable @typescript-eslint/no-explicit-any -- SDK snapshots retain their public shape. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { Watch, track } from './watch';
import {companySourceSnapshot,liveCompanyReads,isSnapshotCollection} from './company-directory';
declare global {
  var __youAnalystReadScopeV1: AsyncLocalStorage<boolean> | undefined;
  var __youAnalystSourceStoresV1: WeakMap<object, Set<Entry>> | undefined;
  var __youAnalystSourceOwnersV1: WeakMap<object, Map<string, object>> | undefined;
}
const scope = globalThis.__youAnalystReadScopeV1 ??= new AsyncLocalStorage<boolean>();
export const withSourceCache = <T>(work: () => Promise<T>): Promise<T> => scope.run(true, work);
type Source = { isEqual(other: any): boolean; onSnapshot(next: (snapshot: any) => void, error: (error: Error) => void): () => void };
type CacheContext = {collection:string; companyId?:string; limit?:number; afterCursor?:{id:string;publicationDate:unknown}};
type Entry = { source: Source; watch: Watch<any>; users: number; bytes: number; documentCount?:number; context?:CacheContext };
function cacheLog(action:string, entry:Entry, fields:Record<string,unknown>={}) {
  if(entry.context?.collection!=='events')return;
  try {console.info(JSON.stringify({event:'source_cache',action,...entry.context,processRunId:globalThis.__youAnalystFirestoreObserverV1?.processRunId,revision:process.env.K_REVISION,bytes:entry.bytes,documentCount:entry.documentCount,...fields}));}catch {/* Logging must not affect reads. */}
}
const stores = globalThis.__youAnalystSourceStoresV1 ??= new WeakMap<object, Set<Entry>>();
const MAX_LISTENERS = 128, MAX_BYTES = 4 * 1024 * 1024;
// Estimate retained user data without serializing SDK document references (which
// contain the Firestore client and may be cyclic). Stop at the eviction budget.
export function dataBytes(value: unknown, limit = MAX_BYTES): number {
  const pending: unknown[] = [value], seen = new WeakSet<object>(); let bytes = 0;
  while (pending.length && bytes <= limit) {
    const item = pending.pop();
    if (typeof item === 'string') {bytes += Buffer.byteLength(item); continue;}
    if (!item || typeof item !== 'object') {bytes += 8; continue;}
    if (seen.has(item)) continue; seen.add(item);
    if (Buffer.isBuffer(item)) {bytes += item.byteLength; continue;}
    const reference = item as {path?: unknown; isEqual?: unknown};
    if (typeof reference.path === 'string' && typeof reference.isEqual === 'function') {bytes += Buffer.byteLength(reference.path); continue;}
    bytes += 32;
    for (const [key, child] of Object.entries(item)) {bytes += Buffer.byteLength(key); pending.push(child);}
  }
  return bytes;
}
/** Cache the exact query/document, including its filters and authorization scope.
 * No global version document, TTL, or request-time refresh query. */
export function sourceSnapshot(owner: object, source: Source, maxListeners = MAX_LISTENERS, maxBytes = MAX_BYTES, context?:CacheContext): Promise<any> | undefined {
  if (!scope.getStore() || typeof source.onSnapshot !== 'function' || typeof source.isEqual !== 'function') return undefined;
  let entries = stores.get(owner);
  if (!entries) { entries = new Set(); stores.set(owner, entries); }
  const cache = entries;
  const evict = () => {
    let bytes = [...cache].reduce((sum, entry) => sum + entry.bytes, 0);
    if(cache.size<=maxListeners&&bytes<=maxBytes)return;
    const idle=[...cache].filter(entry=>!entry.users);
    while (idle.length && (cache.size > maxListeners || bytes > maxBytes)) {
      // Prefer cheaper empty queries within the oldest quarter, not across the
      // whole cache: recent empty queries can be hot and must still be reused.
      // Byte pressure retains ordinary LRU; neither bound increases.
      const window=idle.slice(0,Math.ceil(idle.length/4));
      const empty=cache.size>maxListeners?window.findIndex(entry=>entry.context?.collection==='events'&&entry.documentCount===0):-1;
      const retainedLruQuery=empty>0?{...idle[0].context,documentCount:idle[0].documentCount}:undefined;
      const [entry]=idle.splice(empty<0?0:empty,1);
      cacheLog('evict',entry,{reason:cache.size>maxListeners?'entry_limit':'byte_limit',policy:empty<0?'lru':'empty_event_first',retainedLruQuery,entries:cache.size,totalBytes:bytes,maxEntries:maxListeners,maxBytes});
      bytes -= entry.bytes; entry.watch.close();
    }
  };
  let entry = [...cache].find(candidate => source.isEqual(candidate.source));
  if (!entry) {
    // SDK delivers asynchronously; the microtask also supports synchronous adapters.
    entry = {source, context, users: 0, bytes: 0, watch: undefined as unknown as Watch<any>};
    const created = entry;
    created.watch = track(new Watch<any>((next, error) => source.onSnapshot(value => {
      const docs = Array.isArray(value.docs) ? value.docs : [value];
      created.documentCount=Array.isArray(value.docs)?docs.length:value.exists===false?0:1;
      created.bytes = docs.reduce((sum: number, doc: any) => sum + dataBytes(doc.data(), maxBytes), 0);
      next(value);
      // A pending reader pins this snapshot. Its finally block evicts after
      // unpinning, so shared callers do not trigger eviction while still pinned.
      if(!created.users)queueMicrotask(evict);
    }, error)));
    const close = created.watch.close.bind(created.watch);
    created.watch.close = () => {cache.delete(created); close();};
    cache.add(created);
    cacheLog('miss',created,{entries:cache.size,maxEntries:maxListeners,maxBytes});
  }else cacheLog('hit',entry,{entries:cache.size});
  entry.users++; cache.delete(entry); cache.add(entry);
  const selected = entry;
  return selected.watch.read().finally(() => {selected.users--; if(!selected.users)evict();});
}

// One partition per public source family, shared by independently bundled routes.
// Keep company browsing and large chart histories from evicting health/status
// subscriptions. Unknown/user-scoped sources retain the small default budget.
const owners = globalThis.__youAnalystSourceOwnersV1 ??= new WeakMap<object, Map<string, object>>();
const policies: Record<string, readonly [number, number]> = {
  companies: [1024, 32 * 1024 * 1024],
  instruments: [1024, 16 * 1024 * 1024],
  collectors: [512, 8 * 1024 * 1024],
  // Nov 9: 14,659 event listeners (including empty queries) preceded a 3 GiB
  // heap failure. Document bytes omit SDK streams/query state, so the independent
  // listener bound must leave room for SDK overhead and the other source caches.
  // LRU eviction closes the SDK subscription; a revisit loads current data.
  // Crawl traffic reaches the entry bound before the existing byte budget.
  events: [8192, 160 * 1024 * 1024],
};
export function collectionSourceSnapshot(owner: object, source: Source, collection: string, context?:CacheContext): Promise<any> | undefined {
 // These datasets move to Parquet. Bootstrap action reads must be one-shot:
 // a retained Firestore listener would otherwise survive the readiness switch.
 if(collection==='eod_prices'||collection==='corporate_actions')return undefined;
  if(isSnapshotCollection(collection)){
    if(liveCompanyReads())return undefined;
    const cached=companySourceSnapshot(owner as import('firebase-admin/firestore').Firestore,source);
    if(cached)return cached;
  }
  const policy = Object.hasOwn(policies, collection) ? policies[collection] : undefined;
  if (!policy) return sourceSnapshot(owner, source);
  let partitions = owners.get(owner);
  if (!partitions) { partitions = new Map(); owners.set(owner, partitions); }
  let partition = partitions.get(collection);
  if (!partition) { partition = {}; partitions.set(collection, partition); }
  return sourceSnapshot(partition, source, policy[0], policy[1], context);
}
