import {actionRepository} from '../action-store/runtime';
import type { Firestore } from 'firebase-admin/firestore';
import { timelineSplits } from './company-timeline';

/** A single-field ticker query needs no composite index; validate market locally. */
export async function loadTimelineSplits(db:Pick<Firestore,'collection'>,ticker:string,market:string,asOf:string){
  const rows=await (await actionRepository(db)).readTicker(ticker);
  const splits=timelineSplits(rows.map(row=>row.data),ticker,market,asOf);
  return {splits,revision:JSON.stringify(splits)};
}
