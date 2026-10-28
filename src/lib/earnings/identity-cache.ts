import { FieldPath, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { Watch, track } from '../local-cache/watch';

const stores = new WeakMap<Firestore, Watch<Map<string, DocumentData>>>();

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
