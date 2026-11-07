import {FieldPath,type Firestore} from 'firebase-admin/firestore';
import {isoDate} from './compare';
import {marketDate,predictionInstrument} from './predictions/instrument';

export async function latestSharedCompareDate(db:Firestore,symbols:string[]) {
  const instruments=symbols.map(symbol=>predictionInstrument(symbol)!);
  const markets=[...new Set(instruments.map(item=>item.market))];
  const ends=new Map<string,string>();
  await Promise.all(markets.map(async market=>{
    const saved=await db.collection('eod_runs').doc(`_latest_${market}`).get();
    const date=saved.get('runDate'),today=marketDate(market);
    // Existing installations remain usable until their first completed run publishes the pointer.
    ends.set(market,['COMPLETED','COMPLETED_WITH_ERRORS'].includes(saved.get('status'))&&isoDate(date)&&date<=today?date:today);
  }));
  const dates=await Promise.all(instruments.map(async item=>{
    const prefix=`${item.market}_${item.ticker}_`;
    const rows=await db.collection('eod_prices').where(FieldPath.documentId(),'>=',prefix)
      .where(FieldPath.documentId(),'<=',prefix+ends.get(item.market)).orderBy(FieldPath.documentId(),'desc').limit(60).get();
    return new Set(rows.docs.flatMap(row=>{
      const p=row.data();return p.ticker===item.ticker&&p.market===item.market&&isoDate(p.tradingDate)&&typeof p.close==='number'&&Number.isFinite(p.close)&&p.close>0?[p.tradingDate as string]:[];
    }));
  }));
  const latest=[...(dates[0]??[])].filter(date=>dates.every(set=>set.has(date))).sort().at(-1);
  if(!latest)throw Error('No recent shared close');
  return latest;
}
