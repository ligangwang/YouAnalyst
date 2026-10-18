import type { Firestore } from 'firebase-admin/firestore';
import { changeCached } from '../change-cache';

/** Keep relationship reads independent of graph valuation/company invalidation. */
export function loadAllRelationships(db: Firestore) {
  return changeCached(db, 'all-relationships', ['company_relationships'], () =>
    db.collection('company_relationships').get());
}

export async function loadPublishedRelationships(db: Firestore) {
  const snapshot = await loadAllRelationships(db);
  return { docs: snapshot.docs.filter(doc => doc.data().status === 'PUBLISHED') };
}
