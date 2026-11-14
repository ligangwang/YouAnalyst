import { localDocuments } from './local-cache/entities';
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import type { IndexedCollection } from './company-change-index';
import { withCacheReadScope } from './change-cache';
import { readCompanyLookup } from './company-lookup-cache';
import { enableCompanyDirectoryForReader } from './local-cache/company-directory';
export function loadCompanyDocuments(db: Firestore, collection: IndexedCollection, ids: string[], projection: 'full' | 'marketCap' | 'peerFinancials' = 'full'): Promise<DocumentSnapshot[]> {
  return withCacheReadScope(async () => {
    if (!ids.length) return [];
    if (collection === 'companies' && ids.length === 1) {
      enableCompanyDirectoryForReader(db);
      const source = db.collection('companies').doc(ids[0]);
      // Identity resolution and page details must share the same live document.
      // A separate one-ID query reloaded it immediately after the route lookup.
      if (typeof source.onSnapshot === 'function' && typeof source.isEqual === 'function') {
        return [await readCompanyLookup(db, source)];
      }
    }
    const local = await localDocuments(db, collection, ids, undefined, projection === 'full' ? undefined : projection);
    if (local) return local;
    const docs: DocumentSnapshot[] = [];
    for (let i = 0; i < ids.length; i += 100) docs.push(...await db.getAll(...ids.slice(i,i+100).map(id => db.collection(collection).doc(id))));
    return docs;
  });
}
