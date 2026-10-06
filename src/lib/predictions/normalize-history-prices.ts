import type {Firestore} from 'firebase-admin/firestore';
import type {Bucket} from '@google-cloud/storage';
import {historyBars,HISTORY_START} from './history-backfill';
import {predictionInstrument} from './instrument';

/** Add raw-close metadata from already downloaded history; never change scoring prices. */
export async function normalizeHistoryPrices({db,bucket,tickers,write=false,onProgress}:{db:Firestore;bucket:Bucket;tickers:string[];write?:boolean;onProgress?:(result:{stocks:number;updated:number;existing:number;missing:number})=>void}){
  const result={stocks:0,updated:0,existing:0,missing:0};
  for(const ticker of [...new Set(tickers)].sort()){
    const instrument=predictionInstrument(ticker);if(!instrument)throw Error('Unsupported history symbol');
    const state=(await db.collection('collectors').doc(`eod-history_${instrument.market}_${ticker}`).get()).data();
    if(state?.status!=='completed'||state.from!==HISTORY_START||typeof state.through!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(state.through))throw Error('Completed historical cache required');
    const [raw]=await bucket.file(`eod-history/${instrument.market}/${encodeURIComponent(ticker)}/${HISTORY_START}_${state.through}.json`).download();
    const bars=historyBars(JSON.parse(raw.toString('utf8')),HISTORY_START,state.through);
    for(let offset=0;offset<bars.length;offset+=100){
      const rows=bars.slice(offset,offset+100),refs=rows.map(row=>db.collection('eod_prices').doc(`${instrument.market}_${ticker}_${row.date}`));
      const docs=await db.getAll(...refs);
      await Promise.all(rows.map(async(row,index)=>{
        const doc=docs[index],price=doc.data();
        if(!doc.exists){result.missing++;return;}
        if(price?.ticker!==ticker||price.market!==instrument.market||price.tradingDate!==row.date||price.isFinal!==true)throw Error('Historical price identity mismatch');
        if(typeof price.rawClose==='number'&&Number.isFinite(price.rawClose)&&price.rawClose>0){result.existing++;return;}
        if(write)await refs[index].update({rawClose:row.close},{lastUpdateTime:doc.updateTime!});
        result.updated++;
      }));
    }
    result.stocks++;onProgress?.({...result});
  }
  return result;
}
