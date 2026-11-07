import type {Firestore} from 'firebase-admin/firestore';
import {isoDate} from '../compare';

/** Market-wide completion dates, independent of loaded companies or prices. */
export async function readCompletedEodDates(db:Firestore):Promise<{US:string|null;CN_A:string|null}> {
  const markets=['US','CN_A'] as const;
  const docs=await db.getAll(...markets.map(market=>db.collection('eod_runs').doc(`_latest_${market}`)));
  const dates:{US:string|null;CN_A:string|null}={US:null,CN_A:null};
  markets.forEach((market,index)=>{
    const run=docs[index].data();
    if(run?.market===market&&['COMPLETED','COMPLETED_WITH_ERRORS'].includes(run.status)&&isoDate(run.runDate))dates[market]=run.runDate;
  });
  return dates;
}

