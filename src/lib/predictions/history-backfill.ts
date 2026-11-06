import {createCachedPriceBatch} from '../intelligence/price-cache';
import type { Firestore } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
import { predictionInstrument } from './instrument';
import {OnboardingCapacityDeferred} from '../instrument-onboarding/capacity-control';
export {historyThrough} from './history-range';
import {historyBars} from './history-bars';
export {historyBars} from './history-bars';

export const HISTORY_START = '2025-12-31';
export function historyProviderSymbol(ticker: string) {
  const instrument=predictionInstrument(ticker);
  if(!instrument)throw Error('Unsupported historical symbol');
  return instrument.market==='US' ? `${instrument.ticker.replaceAll('.','-')}.US` : instrument.providerSymbol;
}
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;

async function existingPriceHistory(db:Firestore,ticker:string,market:string,from:string,through:string){
  const saved=await db.collection('eod_prices').where('ticker','==',ticker).select('market','ticker','tradingDate','close','rawClose','open','high','low','adjustedClose','volume','source','isFinal').limit(10000).get();
  const rows=saved.docs.map(doc=>doc.data()).filter(row=>row.market===market&&row.ticker===ticker&&row.isFinal!==false&&typeof row.source==='string'&&row.source.startsWith('eodhd')).map(row=>({date:row.tradingDate,close:row.rawClose??row.close,open:row.open,high:row.high,low:row.low,adjusted_close:row.adjustedClose,volume:row.volume}));
  try{return historyBars(rows,from,through,true);}catch{return null;}
}

/** No prediction scoring or latest-price mutation: only fill missing historical documents. */
export async function backfillPriceHistory(input: {
  db: Firestore; bucket: Bucket; tickers: string[]; through: string; from?: string; limit?: number;
  writeBatchSize?: number; createFirst?: boolean; beforeBatch?: () => Promise<void>; afterBatch?: () => Promise<void>;
  token: string; apiUrl?: string; fetcher?: typeof fetch; now?: () => number;allowPartial?:boolean;
}) {
  const { db, bucket, token, through } = input;
  const from=input.from??HISTORY_START,batchSize=input.writeBatchSize??100;
  if(!validDate(from)||!Number.isInteger(batchSize)||batchSize<1||batchSize>1500)throw Error('Invalid backfill range or batch size');
  if (!validDate(through) || through < from) throw Error('Invalid backfill end date');
  if (!Number.isInteger(input.limit ?? 5) || (input.limit ?? 5) < 1 || (input.limit ?? 5) > 1000) throw Error('Invalid backfill limit');
  const tickers = [...new Set(input.tickers)].sort();
  const now = input.now ?? Date.now;
  const fetcher = input.fetcher ?? fetch;
  const result = { completed: 0, skipped: 0, requested: 0, created: 0, existing: 0, failures: [] as {ticker: string; reason: string}[] };
  for (const ticker of tickers) {
    const instrument = predictionInstrument(ticker);
    if (!instrument) { result.failures.push({ticker,reason:'unsupported_symbol'}); continue; }
    const providerSymbol=historyProviderSymbol(ticker);
    const ref = db.collection('collectors').doc(`eod-history_${instrument.market}_${ticker}${from===HISTORY_START?'':`_${from}_${through}`}`);
    const claim = await db.runTransaction(async tx => {
      const doc = await tx.get(ref); const state = doc.data();
      if (state?.status === 'completed' && state.from === from) return null;
      if (Number(state?.leaseUntil) > now() || Number(state?.retryAfter) > now()) return null;
      if (result.completed + result.failures.length >= (input.limit ?? 5)) return null;
      const end = state?.from === from && validDate(state.through) ? state.through : through;
      const lease = now() + 20 * 60_000;
      tx.set(ref, {from:from,through:end,status:'running',leaseUntil:lease,updatedAt:new Date(now()).toISOString()}, {merge:true});
      return { end, lease };
    });
    if (!claim) { result.skipped++; continue; }
    try {
      const file = bucket.file(`eod-history/${instrument.market}/${encodeURIComponent(ticker)}/${from}_${claim.end}.json`);
      let raw: unknown;
      try { raw = JSON.parse((await file.download())[0].toString('utf8')); }
      catch (error) {
        if (Number((error as {code?:number}).code) !== 404) throw Error('History cache read failed');
        if (!token) throw Error('EODHD credential unavailable');
        const url = new URL(`/api/eod/${providerSymbol}`, (input.apiUrl ?? process.env.EODHD_API_URL?.trim()) || 'https://eodhd.com');
        url.search = new URLSearchParams({api_token:token,fmt:'json',period:'d',order:'a',from:from,to:claim.end}).toString();
        result.requested++;
        try{
          let response: Response;
          try { response = await fetcher(url, {signal:AbortSignal.timeout(30000),redirect:'error'}); }
          catch { throw Error('Historical provider request failed'); }
          if (!response.ok) throw Error(`Historical provider HTTP ${response.status}`);
          raw = await response.json();
          historyBars(raw,from,claim.end,input.allowPartial);
        }catch(error){
          const stored=input.allowPartial?await existingPriceHistory(db,ticker,instrument.market,from,claim.end):null;
          if(!stored)throw error;raw=stored;
        }
        await file.save(JSON.stringify(input.allowPartial?historyBars(raw,from,claim.end,true):raw), {resumable:false,contentType:'application/json',preconditionOpts:{ifGenerationMatch:0}});
      }
      const bars = historyBars(raw,from,claim.end,input.allowPartial);
      const loadedAt = new Date(now()).toISOString();
      for (let offset=0;offset<bars.length;offset+=batchSize) {
        await input.beforeBatch?.();
        const slice=bars.slice(offset,offset+batchSize);
        const refs=slice.map(row=>db.collection('eod_prices').doc(`${instrument.market}_${ticker}_${row.date}`));
        const rows=slice.map((row,i) => {
          const previous=bars[offset+i-1];
          return {ref:refs[i],patch:{market:instrument.market,ticker,requestedDate:row.date,tradingDate:row.date,
              open:row.open,high:row.high,low:row.low,close:row.close,rawClose:row.close,adjustedClose:row.adjusted_close,volume:row.volume,
              source:'eodhd-eod',providerSymbol,exchange:instrument.exchange,
              exchangeTimezone:instrument.timeZone,micCode:instrument.exchange,loadedAt,isFinal:true,
              previousClose:previous?.close ?? null,previousTradingDate:previous?.date ?? null,
              dailyReturn:previous&&!input.allowPartial ? (row.close-previous.close)/previous.close : null}};
        });
        let written:{created:number;existing:number};
        try { written=await createCachedPriceBatch(db,rows,{createFirst:input.createFirst}); }
        catch { throw Error('History document write failed'); }
        result.created+=written.created;result.existing+=written.existing;
        await input.afterBatch?.();
      }
      await input.beforeBatch?.();
      await db.runTransaction(async tx => {
        const current=await tx.get(ref);
        if (current.data()?.leaseUntil !== claim.lease) throw Error('History lease lost');
        tx.set(ref,{status:'completed',leaseUntil:0,retryAfter:0,lastError:null,firstTradingDate:bars[0].date,
          lastTradingDate:bars.at(-1)!.date,bars:bars.length,cachePath:file.name,updatedAt:loadedAt},{merge:true});
      });
      result.completed++;
    } catch(error) {
      if(error instanceof OnboardingCapacityDeferred){
        await db.runTransaction(async tx=>{const current=await tx.get(ref);if(current.data()?.leaseUntil===claim.lease)tx.set(ref,{status:'pending',leaseUntil:0,retryAfter:0},{merge:true});});
        throw error;
      }
      const reason = error instanceof Error && /^(Empty or invalid historical response|Invalid historical bar|History cache read failed|EODHD credential unavailable|Historical provider request failed|Historical provider HTTP \d+|History document write failed|History lease lost)$/.test(error.message) ? error.message : 'Historical backfill failed';
      result.failures.push({ticker,reason});
      await db.runTransaction(async tx=>{const current=await tx.get(ref);if(current.data()?.leaseUntil===claim.lease)tx.set(ref,{status:'failed',leaseUntil:0,retryAfter:now()+86400000,lastError:reason},{merge:true});});
    }
  }
  return result;
}
