import type { Firestore } from 'firebase-admin/firestore';
import { withCacheReadScope } from '../../change-cache';
/** Subscribe only to source-status documents used by this view. */
export function loadNewsCollectorStatuses(db: Firestore, ids: string[]) {
  return withCacheReadScope(() => ids.length ? db.getAll(...ids.map(id => db.collection('collectors').doc(`news-health-${id}`))) : Promise.resolve([]));
}
