import { FieldPath, type DocumentData, type Firestore, type QuerySnapshot } from 'firebase-admin/firestore';
import { Watch, track } from '../local-cache/watch';
import { sourceSnapshot, withSourceCache } from '../local-cache/read-scope';

const stores = new WeakMap<Firestore, Watch<Map<string, DocumentData>>>();
const targetedOwners = new WeakMap<Firestore, object>();

/** Subscribe only to eligible issuers, including currently missing identities so
 * later verification is delivered live. Stable batches share bounded listeners;
 * removed/outside issuers never enter the returned map. */
export async function supportedSecIdentitySnapshot(db: Firestore, companyIds: readonly string[]): Promise<Map<string, DocumentData>> {
  const ids = [...new Set(companyIds)].sort().map(id => `sec-identity-${id}`);
  if (!ids.length) return new Map();
  let owner = targetedOwners.get(db);
  if (!owner) { owner = {}; targetedOwners.set(db, owner); }
  const rows = new Map<string, DocumentData>();
  for (let start = 0; start < ids.length; start += 30) {
    const query = db.collection('collectors').where(FieldPath.documentId(), 'in', ids.slice(start, start + 30));
    const snapshot: QuerySnapshot = await withSourceCache(() =>
      sourceSnapshot(owner!, query, 128, 8 * 1024 * 1024) ?? query.get());
    for (const doc of snapshot.docs) rows.set(doc.id, doc.data());
  }
  return rows;
}

/** One subscription to the existing identity namespace, independent of the
 * bounded cache for individual collector documents. New identities, corrections
 * and deletions arrive through the same listener without rereading the directory.
 */
export async function secIdentitySnapshot(db: Firestore): Promise<Map<string, DocumentData>> {
  let watch = stores.get(db);
  if (!watch) {
    const query = db.collection('collectors')
      .where(FieldPath.documentId(), '>=', 'sec-identity-')
      .where(FieldPath.documentId(), '<', 'sec-identity.');
    const rows = (snapshot: { docs: Array<{ id: string; data(): DocumentData }> }) =>
      new Map(snapshot.docs.map(doc => [doc.id, doc.data()]));
    // Non-listening adapters still perform a fresh read; production uses the
    // Firestore listener and never polls or falls back after a listener error.
    if (typeof query.onSnapshot !== 'function') return rows(await query.get());
    watch = track(new Watch<Map<string, DocumentData>>((next, error) =>
      query.onSnapshot(snapshot => next(rows(snapshot)), error)));
    const created = watch, close = created.close.bind(created);
    created.close = () => { stores.delete(db); close(); };
    stores.set(db, watch);
  }
  return watch.read();
}
