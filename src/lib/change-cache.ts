import type { Firestore } from 'firebase-admin/firestore';
import { withSourceCache } from './local-cache/read-scope';
export const CHANGE_CACHE_COLLECTIONS = ['companies', 'company_relationships', 'company_fundamentals',
  'eod_prices', 'corporate_actions', 'earnings_records', 'collectors', 'events', 'users', 'directory_syncs', 'predictions', 'watchlists'] as const;
export type CacheCollection = typeof CHANGE_CACHE_COLLECTIONS[number];
export function withCacheReadScope<T>(work: () => Promise<T>): Promise<T> { return withSourceCache(work); }
/** Derived values are rebuilt from their targeted live source snapshots. Keeping
 * arbitrary graph/result promises here caused unnecessary retention and fan-out. */
export function changeCached<T>(_db: Firestore, _key: string, _collections: readonly (CacheCollection | `collector:${string}`)[], load: () => Promise<T>, _cacheWhen: (value:T)=>boolean=()=>true): Promise<T> {
  void _cacheWhen;
  return withSourceCache(load);
}
/** Old in-flight deliveries may be acknowledged during a rolling migration. */
export async function applyCacheChange(_db: Firestore, headers: Headers, project: string, _body?: Uint8Array) {
  void _body;
  if (headers.get('ce-type') !== 'google.cloud.firestore.document.v1.written'
    || headers.get('ce-source') !== `//firestore.googleapis.com/projects/${project}/databases/(default)`
    || !headers.get('ce-id')) throw Error('Invalid Firestore change event');
  const path = /^documents\/([^/]+)\/([^/]+)$/.exec(headers.get('ce-subject') ?? '');
  if (!path || !CHANGE_CACHE_COLLECTIONS.includes(path[1] as CacheCollection)) throw Error('Unexpected change document');
}
