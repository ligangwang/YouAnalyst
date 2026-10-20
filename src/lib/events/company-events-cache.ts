import type { Firestore, QuerySnapshot } from 'firebase-admin/firestore';
import { sourceSnapshot, withSourceCache } from '../local-cache/read-scope';
import { EVENTS_COLLECTION } from './model';

// Isolated from company/status lookups; the shared cache implementation bounds
// this partition to 128 queries and 4 MiB of estimated document payload.
const owners = new WeakMap<Firestore, object>();
export function loadCompanyEventSnapshot(db: Firestore, companyId: string): Promise<QuerySnapshot> {
  let owner = owners.get(db);
  if (!owner) { owner = {}; owners.set(db, owner); }
  const cacheOwner = owner;
  const query = db.collection(EVENTS_COLLECTION).where('companyId', '==', companyId)
    .orderBy('publication_date', 'desc').limit(30);
  return withSourceCache(() => sourceSnapshot(cacheOwner, query) ?? query.get());
}
