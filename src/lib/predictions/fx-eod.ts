import type { Firestore } from "firebase-admin/firestore";
import { saveLatestEodPrice, validLatestPrice, type LatestEodPrice } from "./latest-eod";

export async function loadUsdCnyEod(db: Firestore, date: string) {
  const ref = db.collection("eod_prices").doc(`FX_USD_CNY_${date}`);
  const cached = (await ref.get()).data();
  let price: LatestEodPrice;
  if (validLatestPrice(cached) && cached.market === "FX" && cached.ticker === "USD_CNY" && cached.tradingDate === date) price = cached;
  else {
    const token = process.env.EODHD_API_TOKEN?.trim();
    if (!token) throw new Error("EODHD is not configured for FX");
    const url = new URL("https://eodhd.com/api/eod/USDCNY.FOREX");
    url.search = new URLSearchParams({api_token:token,fmt:"json",period:"d",from:date,to:date}).toString();
    let response: Response;
    try { response = await fetch(url, {signal:AbortSignal.timeout(20_000),cache:"no-store"}); }
    catch { throw new Error("USD/CNY provider request failed"); }
    if (!response.ok) throw new Error(`USD/CNY provider HTTP ${response.status}`);
    const rows: unknown = await response.json();
    const row = Array.isArray(rows) ? rows.find(r => r?.date === date) : undefined;
    if (!row || typeof row.close !== "number" || !Number.isFinite(row.close) || row.close <= 0) throw new Error("USD/CNY daily close unavailable for requested date");
    price = {ticker:"USD_CNY",market:"FX",tradingDate:date,close:row.close,currency:"CNY",source:"eodhd-eod",loadedAt:new Date().toISOString()};
    await ref.set({...price,assetType:"fx",baseCurrency:"USD",quoteCurrency:"CNY",isFinal:true});
  }
  await saveLatestEodPrice(db,price);
  return {processed:1,failed:0,tradingDate:price.tradingDate,close:price.close};
}
