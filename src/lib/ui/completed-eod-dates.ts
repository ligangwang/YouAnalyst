import {FieldPath,type Firestore} from 'firebase-admin/firestore';
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
  // Older daily workers wrote MARKET_YYYY-MM-DD completion records before
  // market pointers were introduced. Document-ID ranges use the built-in index.
  await Promise.all(markets.filter(market=>!dates[market]).map(async market=>{
    const query=db.collection('eod_runs').where(FieldPath.documentId(),'>=',`${market}_0000-00-00`)
      .where(FieldPath.documentId(),'<=',`${market}_9999-99-99`).orderBy(FieldPath.documentId(),'desc').limit(25);
    let cursor:string|undefined;
    while(true){
      const page=await (cursor?query.startAfter(cursor):query).get();
      for(const doc of page.docs){
        const run=doc.data();
        if(run.market===market&&['COMPLETED','COMPLETED_WITH_ERRORS'].includes(run.status)&&isoDate(run.runDate)&&doc.id===`${market}_${run.runDate}`){dates[market]=run.runDate;return;}
      }
      if(page.size<25)return;
      cursor=page.docs.at(-1)!.id;
    }
  }));
  return dates;
}

