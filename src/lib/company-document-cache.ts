import { localDocuments } from './local-cache/entities';
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import type { IndexedCollection } from './company-change-index';
import { withCacheReadScope } from './change-cache';
export function loadCompanyDocuments(db: Firestore, collection: IndexedCollection, ids: string[], projection: 'full' | 'marketCap' = 'full'): Promise<DocumentSnapshot[]> {
  return withCacheReadScope(async () => {
    if (!ids.length) return [];
    const local = await localDocuments(db, collection, ids, undefined, projection === 'marketCap' ? 'marketCap' : undefined);
    if (local) return local;
    const docs: DocumentSnapshot[] = [];
    for (let i = 0; i < ids.length; i += 100) docs.push(...await db.getAll(...ids.slice(i,i+100).map(id => db.collection(collection).doc(id))));
    return docs;
  });
}
