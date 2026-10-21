import type { Firestore, QuerySnapshot } from 'firebase-admin/firestore';
import { collectionSourceSnapshot, withSourceCache } from '../local-cache/read-scope';
import { EVENTS_COLLECTION } from './model';

// Shared with other cached event reads across server bundles.
export function loadCompanyEventSnapshot(db: Firestore, companyId: string): Promise<QuerySnapshot> {
  const query = db.collection(EVENTS_COLLECTION).where('companyId', '==', companyId)
    .orderBy('publication_date', 'desc').limit(30);
  return withSourceCache(() => collectionSourceSnapshot(db, query, EVENTS_COLLECTION) ?? query.get());
}
