import { FieldPath, type CollectionReference, type Firestore, type Transaction } from 'firebase-admin/firestore';

/** Exact-ID queries charge for existing results (or one empty result), instead
 * of one missing-document lookup for every proposed insert. Keep all queries
 * inside the writing transaction and before its writes. */
export async function existingDocumentIds(tx: Transaction, collection: CollectionReference, ids: string[]) {
  const unique = [...new Set(ids)], existing = new Set<string>();
  // Firestore permits at most 30 disjunctions in an IN query. Exact IDs avoid
  // reading unrelated documents between sparse historical dates/event IDs.
  for (let offset = 0; offset < unique.length; offset += 30) {
    const snapshot = await tx.get(collection.where(FieldPath.documentId(), 'in', unique.slice(offset, offset + 30)).select());
    for (const doc of snapshot.docs) existing.add(doc.id);
  }
  return existing;
}

/** Queries don't point-read absent IDs. A competing create can therefore fail
 * a create precondition with ALREADY_EXISTS, which the SDK does not retry.
 * Rerun the entire transaction against fresh state; never turn creates into
 * overwrites or publish cache changes separately. Other errors propagate. */
export async function runInsertTransaction<T>(db: Firestore, work: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.runTransaction(work); }
    catch (error) {
      if ((error as {code?: number} | null)?.code !== 6 || attempt >= 2) throw error;
    }
  }
}
