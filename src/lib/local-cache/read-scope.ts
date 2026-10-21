/* eslint-disable @typescript-eslint/no-explicit-any -- SDK snapshots retain their public shape. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { Watch, track } from './watch';
declare global {
  var __youAnalystReadScopeV1: AsyncLocalStorage<boolean> | undefined;
  var __youAnalystSourceStoresV1: WeakMap<object, Set<Entry>> | undefined;
  var __youAnalystSourceOwnersV1: WeakMap<object, Map<string, object>> | undefined;
}
const scope = globalThis.__youAnalystReadScopeV1 ??= new AsyncLocalStorage<boolean>();
export const withSourceCache = <T>(work: () => Promise<T>): Promise<T> => scope.run(true, work);
type Source = { isEqual(other: any): boolean; onSnapshot(next: (snapshot: any) => void, error: (error: Error) => void): () => void };
type Entry = { source: Source; watch: Watch<any>; users: number; bytes: number };
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
export function sourceSnapshot(owner: object, source: Source, maxListeners = MAX_LISTENERS, maxBytes = MAX_BYTES): Promise<any> | undefined {
  if (!scope.getStore() || typeof source.onSnapshot !== 'function' || typeof source.isEqual !== 'function') return undefined;
  let entries = stores.get(owner);
  if (!entries) { entries = new Set(); stores.set(owner, entries); }
  const cache = entries;
  const evict = () => {
    let bytes = [...cache].reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of cache) {
      if (cache.size <= maxListeners && bytes <= maxBytes) break;
      if (entry.users) continue;
      bytes -= entry.bytes; entry.watch.close();
    }
  };
  let entry = [...cache].find(candidate => source.isEqual(candidate.source));
  if (!entry) {
    // SDK delivers asynchronously; the microtask also supports synchronous adapters.
    entry = {source, users: 0, bytes: 0, watch: undefined as unknown as Watch<any>};
    const created = entry;
    created.watch = track(new Watch<any>((next, error) => source.onSnapshot(value => {
      const docs = Array.isArray(value.docs) ? value.docs : [value];
      created.bytes = docs.reduce((sum: number, doc: any) => sum + dataBytes(doc.data(), maxBytes), 0);
      next(value); queueMicrotask(evict);
    }, error)));
    const close = created.watch.close.bind(created.watch);
    created.watch.close = () => {cache.delete(created); close();};
    cache.add(created);
  }
  entry.users++; cache.delete(entry); cache.add(entry);
  const selected = entry;
  return selected.watch.read().finally(() => {selected.users--; evict();});
}

// One partition per public source family, shared by independently bundled routes.
// Keep company browsing and large chart histories from evicting health/status
// subscriptions. Unknown/user-scoped sources retain the small default budget.
const owners = globalThis.__youAnalystSourceOwnersV1 ??= new WeakMap<object, Map<string, object>>();
const policies: Record<string, readonly [number, number]> = {
  companies: [1024, 32 * 1024 * 1024],
  instruments: [1024, 16 * 1024 * 1024],
  collectors: [512, 8 * 1024 * 1024],
  eod_prices: [256, 32 * 1024 * 1024],
  events: [256, 16 * 1024 * 1024],
};
export function collectionSourceSnapshot(owner: object, source: Source, collection: string): Promise<any> | undefined {
  const policy = Object.hasOwn(policies, collection) ? policies[collection] : undefined;
  if (!policy) return sourceSnapshot(owner, source);
  let partitions = owners.get(owner);
  if (!partitions) { partitions = new Map(); owners.set(owner, partitions); }
  let partition = partitions.get(collection);
  if (!partition) { partition = {}; partitions.set(collection, partition); }
  return sourceSnapshot(partition, source, policy[0], policy[1]);
}
