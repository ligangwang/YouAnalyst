import type { Firestore } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
import { marketDate, predictionInstrument, type PredictionMarket } from './instrument';

export const HISTORY_START = '2025-12-31';
export function historyProviderSymbol(ticker: string) {
  const instrument=predictionInstrument(ticker);
  if(!instrument)throw Error('Unsupported historical symbol');
  return instrument.market==='US' ? `${instrument.ticker.replaceAll('.','-')}.US` : instrument.providerSymbol;
}
type Bar = { date: string; open: number; high: number; low: number; close: number; adjusted_close: number; volume: number };
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;

export function historyThrough(market: PredictionMarket, now = new Date()) {
  const today = marketDate(market,now);
  const hour = Number(new Intl.DateTimeFormat('en-GB',{timeZone:market==='US'?'America/New_York':'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(now));
  // Leave time for the provider to publish a final bar; closed days have no rows.
  return hour >= 18 ? today : new Date(Date.parse(today)-86400000).toISOString().slice(0,10);
}

export function historyBars(value: unknown, from: string, through: string): Bar[] {
  if (!validDate(from) || !validDate(through) || through < from) throw Error('Invalid history range');
  if (!Array.isArray(value) || !value.length || value.length > 10000) throw Error('Empty or invalid historical response');
  const dates = new Set<string>();
  for (const row of value) {
    if (!row || !validDate(row.date) || row.date < from || row.date > through || dates.has(row.date)
      || !['open','high','low','close','adjusted_close'].every(key => Number.isFinite(row[key]) && row[key] > 0)
      || !Number.isFinite(row.volume) || row.volume < 0 || row.high < Math.max(row.open,row.close,row.low)
      || row.low > Math.min(row.open,row.close)) throw Error('Invalid historical bar');
    dates.add(row.date);
  }
  return [...value].sort((a,b) => a.date.localeCompare(b.date));
}

/** No prediction scoring or latest-price mutation: only fill missing historical documents. */
export async function backfillPriceHistory(input: {
  db: Firestore; bucket: Bucket; tickers: string[]; through: string; limit?: number;
  token: string; apiUrl?: string; fetcher?: typeof fetch; now?: () => number;
}) {
  const { db, bucket, token, through } = input;
  if (!validDate(through) || through < HISTORY_START) throw Error('Invalid backfill end date');
  if (!Number.isInteger(input.limit ?? 5) || (input.limit ?? 5) < 1 || (input.limit ?? 5) > 1000) throw Error('Invalid backfill limit');
  const tickers = [...new Set(input.tickers)].sort();
  const now = input.now ?? Date.now;
  const fetcher = input.fetcher ?? fetch;
  const result = { completed: 0, skipped: 0, requested: 0, created: 0, existing: 0, failures: [] as {ticker: string; reason: string}[] };
  for (const ticker of tickers) {
    const instrument = predictionInstrument(ticker);
    if (!instrument) { result.failures.push({ticker,reason:'unsupported_symbol'}); continue; }
    const providerSymbol=historyProviderSymbol(ticker);
    const ref = db.collection('collectors').doc(`eod-history_${instrument.market}_${ticker}`);
    const claim = await db.runTransaction(async tx => {
      const doc = await tx.get(ref); const state = doc.data();
      if (state?.status === 'completed' && state.from === HISTORY_START) return null;
      if (Number(state?.leaseUntil) > now() || Number(state?.retryAfter) > now()) return null;
      if (result.completed + result.failures.length >= (input.limit ?? 5)) return null;
      const end = state?.from === HISTORY_START && validDate(state.through) ? state.through : through;
      const lease = now() + 20 * 60_000;
      tx.set(ref, {from:HISTORY_START,through:end,status:'running',leaseUntil:lease,updatedAt:new Date(now()).toISOString()}, {merge:true});
      return { end, lease };
    });
    if (!claim) { result.skipped++; continue; }
    try {
      const file = bucket.file(`eod-history/${instrument.market}/${encodeURIComponent(ticker)}/${HISTORY_START}_${claim.end}.json`);
      let raw: unknown;
      try { raw = JSON.parse((await file.download())[0].toString('utf8')); }
      catch (error) {
        if (Number((error as {code?:number}).code) !== 404) throw Error('History cache read failed');
        if (!token) throw Error('EODHD credential unavailable');
        const url = new URL(`/api/eod/${providerSymbol}`, (input.apiUrl ?? process.env.EODHD_API_URL?.trim()) || 'https://eodhd.com');
        url.search = new URLSearchParams({api_token:token,fmt:'json',period:'d',order:'a',from:HISTORY_START,to:claim.end}).toString();
        result.requested++;
        let response: Response;
        try { response = await fetcher(url, {signal:AbortSignal.timeout(30000),redirect:'error'}); }
        catch { throw Error('Historical provider request failed'); }
        if (!response.ok) throw Error(`Historical provider HTTP ${response.status}`);
        raw = await response.json();
        historyBars(raw,HISTORY_START,claim.end);
        await file.save(JSON.stringify(raw), {resumable:false,contentType:'application/json',preconditionOpts:{ifGenerationMatch:0}});
      }
      const bars = historyBars(raw,HISTORY_START,claim.end);
      const loadedAt = new Date(now()).toISOString();
      for (let offset=0;offset<bars.length;offset+=100) {
        const slice=bars.slice(offset,offset+100);
        const refs=slice.map(row=>db.collection('eod_prices').doc(`${instrument.market}_${ticker}_${row.date}`));
        const stored=await db.getAll(...refs);
        await Promise.all(slice.map(async (row,i) => {
          if (stored[i].exists) { result.existing++; return; }
          const previous=bars[offset+i-1];
          try {
            await refs[i].create({market:instrument.market,ticker,requestedDate:row.date,tradingDate:row.date,
              open:row.open,high:row.high,low:row.low,close:row.close,rawClose:row.close,adjustedClose:row.adjusted_close,volume:row.volume,
              source:'eodhd-eod',providerSymbol,exchange:instrument.exchange,
              exchangeTimezone:instrument.timeZone,micCode:instrument.exchange,loadedAt,isFinal:true,
              previousClose:previous?.close ?? null,previousTradingDate:previous?.date ?? null,
              dailyReturn:previous ? (row.close-previous.close)/previous.close : null});
            result.created++;
          } catch(error) { if (Number((error as {code?:number}).code) === 6) result.existing++; else throw Error('History document write failed'); }
        }));
      }
      await db.runTransaction(async tx => {
        const current=await tx.get(ref);
        if (current.data()?.leaseUntil !== claim.lease) throw Error('History lease lost');
        tx.set(ref,{status:'completed',leaseUntil:0,retryAfter:0,firstTradingDate:bars[0].date,
          lastTradingDate:bars.at(-1)!.date,bars:bars.length,cachePath:file.name,updatedAt:loadedAt},{merge:true});
      });
      result.completed++;
    } catch(error) {
      const reason = error instanceof Error && /^(Empty or invalid historical response|Invalid historical bar|History cache read failed|EODHD credential unavailable|Historical provider request failed|Historical provider HTTP \d+|History document write failed|History lease lost)$/.test(error.message) ? error.message : 'Historical backfill failed';
      result.failures.push({ticker,reason});
      await db.runTransaction(async tx=>{const current=await tx.get(ref);if(current.data()?.leaseUntil===claim.lease)tx.set(ref,{status:'failed',leaseUntil:0,retryAfter:now()+86400000,lastError:reason},{merge:true});});
    }
  }
  return result;
}
