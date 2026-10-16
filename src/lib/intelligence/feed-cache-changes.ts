import { FieldValue, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';

// Reuse the existing, server-only collector state collection. The marker and
// source change commit together, so retries/crashes cannot lose a notification.
export const FEED_REVISION_DOCUMENT = '_feed_revision_v1';
export const FEED_CHANGE_FIELD = 'feedCacheChangedAt';
export function markFeedChanged(db: Firestore, tx: Transaction, ref: DocumentReference) {
  tx.set(ref, { [FEED_CHANGE_FIELD]: FieldValue.serverTimestamp() }, { merge: true });
  tx.set(db.collection('collectors').doc(FEED_REVISION_DOCUMENT), {
    changedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}
