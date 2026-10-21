import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { COMPANY_SITEMAP_BUCKETS, companyBucketPrefix, companySitemapPath } from '../ui/i18n/company-sitemaps';
import { Watch, track } from './watch';

// A fixed, validated set of 40 buckets bounds subscriptions. Retain compact paths
// in application memory; Firestore's listener still retains its SDK snapshots.
const prefixes = new Set(COMPANY_SITEMAP_BUCKETS.map(companyBucketPrefix));
declare global { var __youAnalystSitemapStoresV1: WeakMap<Firestore, Map<string, Watch<readonly string[]>>> | undefined; }
const stores = globalThis.__youAnalystSitemapStoresV1 ??= new WeakMap<Firestore, Map<string, Watch<readonly string[]>>>();
export async function loadSitemapPaths(db: Firestore, prefix: string): Promise<readonly string[]> {
  if (!prefixes.has(prefix)) throw new Error('Invalid sitemap prefix');
  let cache = stores.get(db);
  if (!cache) { cache = new Map(); stores.set(db, cache); }
  let watch = cache.get(prefix);
  if (!watch) {
    const query = db.collection('companies').orderBy(FieldPath.documentId()).startAt(prefix).endBefore(prefix + '\uf8ff');
    watch = track(new Watch<readonly string[]>((next, error) => query.onSnapshot(snapshot => {
      const paths = snapshot.docs.flatMap(doc => {
        const path = companySitemapPath(doc.id, doc.data());
        return path ? [path] : [];
      });
      next(Object.freeze(paths));
    }, error)));
    const current = watch;
    const close = current.close.bind(current);
    current.close = () => { cache!.delete(prefix); close(); };
    cache.set(prefix, current);
  }
  return watch.read();
}
