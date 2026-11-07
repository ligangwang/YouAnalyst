import type {Firestore,Transaction} from 'firebase-admin/firestore';
import {isoDate} from '../compare';

/** Existing eod_runs fields; publish the completed run and monotonic market pointer atomically. */
export async function completeMarketEodRun(db:Firestore, market:string, runDate:string, status:string, error:string|null, eligible:boolean, transaction?:Transaction) {
  if(!['US','CN_A'].includes(market)||!isoDate(runDate))throw Error('Invalid EOD completion identity');
  const run=db.collection('eod_runs').doc(`${market}_${runDate}`),latest=db.collection('eod_runs').doc(`_latest_${market}`);
  const complete=async(tx:Transaction)=>{
    const previous=eligible&&['COMPLETED','COMPLETED_WITH_ERRORS'].includes(status)?await tx.get(latest):null;
    const record={market,runDate,status,error,completedAt:new Date().toISOString()};
    tx.set(run,record,{merge:true});
    const prior=previous?.get('runDate');
    if(previous&&(!isoDate(String(prior??''))||runDate>=prior))tx.set(latest,record);
  };
  if(transaction)await complete(transaction);else await db.runTransaction(complete);
}
