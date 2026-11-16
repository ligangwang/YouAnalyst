import type { Firestore, QueryDocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore';
import { collectionSourceSnapshot, withSourceCache } from '../local-cache/read-scope';
import { EVENTS_COLLECTION } from './model';

// Announcement cards and publisher validation need no captured article body,
// model analysis, or ingestion metadata. Keep the pagination field included.
export const ANNOUNCEMENT_EVENT_FIELDS = ['version','companyId','id','title','url','published_at','publication_date',
  'type','sourceType','sourceId','category','form'] as const;

// Shared with other cached event reads across server bundles.
export function loadCompanyEventSnapshot(db: Firestore, companyId: string, limit: number, after?: QueryDocumentSnapshot): Promise<QuerySnapshot> {
  const base = db.collection(EVENTS_COLLECTION).where('companyId', '==', companyId)
    .orderBy('publication_date', 'desc').select(...ANNOUNCEMENT_EVENT_FIELDS);
  const query = (after ? base.startAfter(after) : base).limit(limit);
  const afterCursor=after?{id:after.id,publicationDate:typeof after.get==='function'?after.get('publication_date'):after.data()?.publication_date}:undefined;
  return withSourceCache(() => collectionSourceSnapshot(db, query, EVENTS_COLLECTION, {collection:EVENTS_COLLECTION,companyId,limit,afterCursor}) ?? query.get());
}
