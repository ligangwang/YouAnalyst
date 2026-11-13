import type { Firestore, QueryDocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore';
import { collectionSourceSnapshot, withSourceCache } from '../local-cache/read-scope';
import { EVENTS_COLLECTION } from './model';

// Shared with other cached event reads across server bundles.
export function loadCompanyEventSnapshot(db: Firestore, companyId: string, limit: number, after?: QueryDocumentSnapshot): Promise<QuerySnapshot> {
  const base = db.collection(EVENTS_COLLECTION).where('companyId', '==', companyId)
    .orderBy('publication_date', 'desc');
  const query = (after ? base.startAfter(after) : base).limit(limit);
  return withSourceCache(() => collectionSourceSnapshot(db, query, EVENTS_COLLECTION, {collection:EVENTS_COLLECTION,companyId}) ?? query.get());
}
