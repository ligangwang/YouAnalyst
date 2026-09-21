import type { Firestore } from "firebase-admin/firestore";

export type LatestEodPrice = { ticker: string; market: string; tradingDate: string; close: number; currency: string; source: string; loadedAt: string };
export function validLatestPrice(value: unknown): value is LatestEodPrice {
  const p = value as LatestEodPrice | undefined;
  return Boolean(p && typeof p.ticker === "string" && ["US", "CN_A", "FX"].includes(p.market)
    && /^\d{4}-\d{2}-\d{2}$/.test(p.tradingDate) && Number.isFinite(Date.parse(p.tradingDate))
    && new Date(p.tradingDate).toISOString().slice(0,10) === p.tradingDate
    && Number.isFinite(p.close) && p.close > 0);
}
export function shouldReplaceLatest(previous: unknown, next: LatestEodPrice) {
  return validLatestPrice(next) && (!validLatestPrice(previous) || (previous.market === next.market
    && previous.ticker === next.ticker && next.tradingDate >= previous.tradingDate));
}

// Preserve exchange-specific catalog IDs. Missing listings get a price-only record
// excluded from search/prediction eligibility until catalog synchronization fills it.
export async function saveLatestEodPrice(db: Firestore, price: LatestEodPrice) {
  if (!validLatestPrice(price)) throw new Error("Invalid latest EOD price");
  const symbol = price.ticker.includes(":") ? price.ticker.split(":")[1] : price.ticker;
  const listings = price.market === "FX" ? null : await db.collection("tickers").where("symbol", "==", symbol).get();
  const matching = listings?.docs.filter(doc => {
    const d = doc.data();
    return price.market === "US" ? d.currency === "USD" && d.country === "United States"
      : d.micCode === price.ticker.split(":")[0];
  }) ?? [];
  const refs = matching.length ? matching.map(d => d.ref) : [db.collection("tickers").doc(price.market === "FX" ? "FX_USD_CNY" : `${price.market}_${price.ticker}`)];
  await db.runTransaction(async tx => {
    const current = await tx.getAll(...refs);
    current.forEach((doc, i) => {
      if (!shouldReplaceLatest(doc.data()?.latestEodPrice, price)) return;
      tx.set(refs[i], { latestEodPrice: price, ...(!doc.exists ? {symbol, market: price.market,
        assetType: price.market === "FX" ? "fx" : "equity", currency: price.currency,
        active: false, predictionSupported: false} : {}) }, {merge:true});
    });
  });
}

export async function readLatestUsPrices(db: Firestore, tickers: string[]) {
  const prices = new Map<string, LatestEodPrice>();
  for (let i = 0; i < tickers.length; i += 30) {
    const page = await db.collection("tickers").where("symbol", "in", tickers.slice(i, i + 30)).select("latestEodPrice").get();
    for (const doc of page.docs) {
      const p = doc.data().latestEodPrice;
      if (validLatestPrice(p) && p.market === "US" && tickers.includes(p.ticker)
        && (!prices.has(p.ticker) || p.tradingDate > prices.get(p.ticker)!.tradingDate)) prices.set(p.ticker, p);
    }
  }
  return prices;
}
