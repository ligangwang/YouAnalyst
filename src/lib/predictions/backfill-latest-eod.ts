import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { saveLatestEodPrice, validLatestPrice, type LatestEodPrice } from "./latest-eod";
export async function backfillLatestEod(db: Firestore, apply = false) {
  const latest = new Map<string, LatestEodPrice>();
  let cursor: string | undefined;
  let scanned = 0;
  // One historical scan, no per-company history queries or descending-name index.
  while (true) {
    let query = db.collection("eod_prices").orderBy(FieldPath.documentId()).limit(500);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) {
      cursor = doc.id; scanned++;
      const d = doc.data();
      const market = d.market ?? (doc.id.startsWith("US_") ? "US" : undefined);
      const price = {ticker:d.ticker,market,tradingDate:d.tradingDate,close:d.close,
        currency:d.currency ?? (market === "US" ? "USD" : "CNY"),
        source:d.source ?? "historical-cache",loadedAt:d.loadedAt ?? new Date().toISOString()} as LatestEodPrice;
      if (!validLatestPrice(price) || price.tradingDate > new Date().toISOString().slice(0,10)) continue;
      const key = `${price.market}:${price.ticker}`;
      if (!latest.has(key) || latest.get(key)!.tradingDate < price.tradingDate) latest.set(key,price);
    }
    if (page.size < 500) break;
  }
  console.info({scanned,instruments:latest.size,apply:apply});
  if (apply) {
    let written = 0;
    for (const price of latest.values()) {
      await saveLatestEodPrice(db,price);
      written++;
    }
    console.info({written});
  }
}
