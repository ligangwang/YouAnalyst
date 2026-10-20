import { FieldPath, type Firestore, type QuerySnapshot } from 'firebase-admin/firestore';
import { changeCached } from '../change-cache';
import { sourceSnapshot } from '../local-cache/read-scope';

// Price subscriptions must not compete with route, feed and collector lookups.
// Retain up to 256 exact queries, still subject to the source cache's 4 MiB cap.
const owners = new WeakMap<Firestore, object>();

/** Shared across peer groups in this process. Only price writes invalidate history;
 * the date bound remains part of the query identity, with no time-based expiry. */
export function loadPeerPrices(db:Firestore, companyId:string, market:'US'|'CN_A', through:string):Promise<Record<string,unknown>[]> {
 const ticker=market==='US'?companyId.slice(3):companyId;
 const prefix=`${market}_${ticker}_`;
 return changeCached(db,`peer-prices:${companyId}:${market}:${through}`,['eod_prices'],async()=>{
  let owner=owners.get(db);
  if(!owner){owner={};owners.set(db,owner);}
  const query=db.collection('eod_prices').where(FieldPath.documentId(),'>=',prefix)
   .where(FieldPath.documentId(),'<=',prefix+through).orderBy(FieldPath.documentId(),'desc').limit(12);
  const snapshot: QuerySnapshot = await (sourceSnapshot(owner,query,256) ?? query.get());
  return snapshot.docs.map(doc=>doc.data());
 });
}
