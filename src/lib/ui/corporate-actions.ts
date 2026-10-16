import type { Firestore } from 'firebase-admin/firestore';
import { timelineSplits } from './company-timeline';

/** A single-field ticker query needs no composite index; validate market locally. */
export async function loadTimelineSplits(db:Pick<Firestore,'collection'>,ticker:string,market:string,asOf:string){
  const snapshot=await db.collection('corporate_actions').where('ticker','==',ticker).get();
  const splits=timelineSplits(snapshot.docs.map(doc=>doc.data()),ticker,market,asOf);
  return {splits,revision:JSON.stringify(splits)};
}
