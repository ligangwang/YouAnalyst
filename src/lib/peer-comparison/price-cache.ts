import { FieldPath, type Firestore, type QuerySnapshot } from 'firebase-admin/firestore';
import { changeCached } from '../change-cache';
import { collectionSourceSnapshot } from '../local-cache/read-scope';

/** File snapshots plus live corrections are shared across peer groups.
 * The exact bounded query remains a fallback before snapshot readiness. */
export function loadPeerPrices(db:Firestore, companyId:string, market:'US'|'CN_A', through:string):Promise<Record<string,unknown>[]> {
 const ticker=market==='US'?companyId.slice(3):companyId;
 const prefix=`${market}_${ticker}_`;
 return changeCached(db,`peer-prices:${companyId}:${market}:${through}`,['eod_prices'],async()=>{
  const query=db.collection('eod_prices').where(FieldPath.documentId(),'>=',prefix)
   .where(FieldPath.documentId(),'<=',prefix+through).orderBy(FieldPath.documentId(),'desc').limit(12);
  const snapshot: QuerySnapshot = await (collectionSourceSnapshot(db,query,'eod_prices') ?? query.get());
  return snapshot.docs.map(doc=>doc.data());
 });
}
