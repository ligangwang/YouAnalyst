import type { Firestore, QueryDocumentSnapshot, QuerySnapshot } from 'firebase-admin/firestore';
import { collectionSourceSnapshot, withSourceCache } from '../local-cache/read-scope';
import { EVENTS_COLLECTION } from './model';
import {marketStoreReady} from '../market-store/runtime';

// Announcement cards and publisher validation need no captured article body,
// model analysis, or ingestion metadata. Keep the pagination field included.
export const ANNOUNCEMENT_EVENT_FIELDS = ['version','companyId','id','title','url','published_at','publication_date',
  'type','sourceType','sourceId','category','form'] as const;

// Shared with other cached event reads across server bundles.
export function loadCompanyEventSnapshot(db: Firestore, companyId: string, limit: number, after?: QueryDocumentSnapshot): Promise<QuerySnapshot> {
  const base = db.collection(EVENTS_COLLECTION).where('companyId', '==', companyId)
    .orderBy('publication_date', 'desc');
  // Native Firestore listeners cannot use a field mask. Parquet uses projected
  // one-shot reads here; bootstrap keeps its original live query.
  const selected=marketStoreReady()?base.select(...ANNOUNCEMENT_EVENT_FIELDS):base;
  const query = (after ? selected.startAfter(after) : selected).limit(limit);
  const afterCursor=after?{id:after.id,publicationDate:typeof after.get==='function'?after.get('publication_date'):after.data()?.publication_date}:undefined;
  return withSourceCache(() => collectionSourceSnapshot(db, query, EVENTS_COLLECTION, {collection:EVENTS_COLLECTION,companyId,limit,afterCursor}) ?? query.get());
}
