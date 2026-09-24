import type { Firestore } from "firebase-admin/firestore";
import { validLatestPrice, type LatestEodPrice } from "../predictions/latest-eod";
import { addDays, CN_FX_LOOKBACK_DAYS, selectFx, type CnFx } from "./cn-market-cap";

// Latest stored China EOD close per company (written by the China EOD job).
// A suspended stock keeps its last close, with that close's own date.
export async function readLatestCnPrices(db: Firestore, ids: string[]) {
  const prices = new Map<string, LatestEodPrice>();
  const codes = [...new Set(ids.map(id => id.split(":")[1]))];
  for (let i = 0; i < codes.length; i += 30) {
    const page = await db.collection("tickers").where("symbol", "in", codes.slice(i, i + 30)).select("latestEodPrice").get();
    for (const doc of page.docs) {
      const p = doc.data().latestEodPrice;
      if (validLatestPrice(p) && p.market === "CN_A" && ids.includes(p.ticker)
        && (!prices.has(p.ticker) || p.tradingDate > prices.get(p.ticker)!.tradingDate)) prices.set(p.ticker, p);
    }
  }
  // The newest session across the map separates suspended stocks from a market holiday.
  const latestSession = [...prices.values()].map(p => p.tradingDate).sort().at(-1) ?? null;
  return { prices, latestSession };
}

// USD/CNY closes are stored by the US EOD job as eod_prices/FX_USD_CNY_{date}.
// Use the latest rate on or before the price date, within a one-week lookback.
export function createFxReader(db: Firestore) {
  const cache = new Map<string, Promise<CnFx>>();
  return (priceDate: string) => {
    if (!cache.has(priceDate)) {
      const dates = Array.from({ length: CN_FX_LOOKBACK_DAYS + 1 }, (_, i) => addDays(priceDate, -i));
      cache.set(priceDate, db.getAll(...dates.map(d => db.collection("eod_prices").doc(`FX_USD_CNY_${d}`))).then(docs => selectFx(docs.flatMap(doc => {
        const d = doc.data();
        return d && d.market === "FX" && d.ticker === "USD_CNY" && typeof d.tradingDate === "string" && typeof d.close === "number"
          ? [{ date: d.tradingDate, close: d.close, source: `eod_prices/${doc.id}` }] : [];
      }), priceDate)));
    }
    return cache.get(priceDate)!;
  };
}
