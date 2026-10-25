import { FieldPath, type Firestore, type QuerySnapshot } from 'firebase-admin/firestore';
import {peerPriceBar} from './model';
import { changeCached } from '../change-cache';
import { collectionSourceSnapshot } from '../local-cache/read-scope';

/** Shared across peer groups in this process. Only price writes invalidate history;
 * the date bound remains part of the query identity, with no time-based expiry. */
export function loadPeerPrices(db:Firestore, companyId:string, market:'US'|'CN_A', through:string):Promise<Record<string,unknown>[]> {
 const ticker=market==='US'?companyId.slice(3):companyId;
 const prefix=`${market}_${ticker}_`;
 return changeCached(db,`peer-prices:${companyId}:${market}:${through}`,['eod_prices'],async()=>{
  const query=db.collection('eod_prices').where(FieldPath.documentId(),'>=',prefix)
   .where(FieldPath.documentId(),'<=',prefix+through).orderBy(FieldPath.documentId(),'desc');
  const read=async(limit:number):Promise<QuerySnapshot>=>{
   const bounded=query.limit(limit);
   return await (collectionSourceSnapshot(db,bounded,'eod_prices') ?? bounded.get());
  };
  const first=await read(6);
  // Six valid, canonically ordered sessions cover the global latest-six union.
  // Older rows cannot affect it. Preserve the old twelve-row behavior when a
  // correction, missing adjusted close, or malformed identity breaks that proof.
  const complete=first.docs.every(doc=>{
   const bar=peerPriceBar(doc.data(),ticker,market,through);
   return bar!==null&&doc.id===prefix+bar.date;
  });
  const snapshot=first.docs.length<6||complete?first:await read(12);
  return snapshot.docs.map(doc=>doc.data());
 });
}
