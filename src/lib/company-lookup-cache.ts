import type { DocumentReference, DocumentSnapshot, Firestore, Query, QuerySnapshot } from 'firebase-admin/firestore';
import { sourceSnapshot, withSourceCache } from './local-cache/read-scope';

// Share exact lookups across requests, including empty results. The source cache
// bounds listener count/memory and applies pushed creations, edits and removals.
export function readCompanyLookup(db: Firestore, source: DocumentReference): Promise<DocumentSnapshot>;
export function readCompanyLookup(db: Firestore, source: Query): Promise<QuerySnapshot>;
export function readCompanyLookup(db: Firestore, source: DocumentReference | Query): Promise<DocumentSnapshot | QuerySnapshot> {
  return withSourceCache(() => sourceSnapshot(db, source) ?? source.get());
}
