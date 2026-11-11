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
    && previous.ticker === next.ticker && next.tradingDate >= previous.tradingDate
    && (previous.tradingDate !== next.tradingDate || previous.close !== next.close
      || previous.currency !== next.currency || previous.source !== next.source || previous.loadedAt !== next.loadedAt)));
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
  for (const ref of refs) {
    for (let attempt = 0; ; attempt++) {
      try {
        // Query snapshots carry the same update-time precondition as get(). Only
        // reread after a conflict, so a concurrent newer price still wins.
        const doc = (attempt === 0 ? matching.find(d => d.ref.path === ref.path) : undefined) ?? await ref.get();
        if (!shouldReplaceLatest(doc.data()?.latestEodPrice, price)) break;
        if (doc.exists) await ref.update({latestEodPrice:price}, {lastUpdateTime:doc.updateTime!});
        else await ref.create({latestEodPrice:price,symbol,market:price.market,
          assetType:price.market === "FX" ? "fx" : "equity",currency:price.currency,
          active:false,predictionSupported:false});
        break;
      } catch (error) {
        const code = Number((error as {code?:number}).code);
        const retry = [6,9,10].includes(code) && attempt < 4;
        console.warn(JSON.stringify({event:"latest_eod_write_failed",ticker:price.ticker,
          document:ref.id,code,attempt,retry}));
        if (!retry) throw error;
        await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
      }
    }
  }
}

export async function readLatestUsPrices(db: Firestore, tickers: string[]) {
  const prices = new Map<string, LatestEodPrice>();
  const unique = [...new Set(tickers)], requested = new Set(unique);
  for (let i = 0; i < unique.length; i += 30) {
    const page = await db.collection("tickers").where("symbol", "in", unique.slice(i, i + 30)).select("latestEodPrice").get();
    for (const doc of page.docs) {
      const p = doc.data().latestEodPrice;
      if (validLatestPrice(p) && p.market === "US" && requested.has(p.ticker)
        && (!prices.has(p.ticker) || p.tradingDate > prices.get(p.ticker)!.tradingDate)) prices.set(p.ticker, p);
    }
  }
  return prices;
}

/** Resolve catalog listings in groups, then atomically compare and update latest
 * prices. A concurrent newer close is never overwritten by a replay. */
export async function saveLatestEodPrices(db:Firestore,prices:LatestEodPrice[]) {
  if(prices.some(p=>!validLatestPrice(p)||p.market==='FX'))throw Error('Invalid equity price batch');
  const symbols=[...new Set(prices.map(p=>p.ticker.split(':').at(-1)!))];
  const listings:FirebaseFirestore.QueryDocumentSnapshot[]=[];
  for(let i=0;i<symbols.length;i+=30){
    const page=await db.collection('tickers').where('symbol','in',symbols.slice(i,i+30)).get();
    listings.push(...page.docs);
  }
  const listingByPath = new Map(listings.map(doc => [doc.ref.path, doc]));
  const writes=prices.flatMap(price=>{
    const symbol=price.ticker.split(':').at(-1)!;
    const matches=listings.filter(doc=>doc.get('symbol')===symbol&&(price.market==='US'
      ?doc.get('currency')==='USD'&&doc.get('country')==='United States':doc.get('micCode')===price.ticker.split(':')[0]));
    const refs = matches.length ? matches.map(doc => doc.ref) : [db.collection('tickers').doc(`${price.market}_${price.ticker}`)];
    return refs.map(ref => ({ref, price, symbol, snapshot: listingByPath.get(ref.path)}));
  });
  for(let i=0;i<writes.length;i+=400){
    const page=writes.slice(i,i+400);
    // Keep each page atomic. Catalog results can guard the write directly.
    // Unknown fallback documents and conflicting versions need a fresh comparison.
    if (page.every(write => write.snapshot?.updateTime) && new Set(page.map(write => write.ref.path)).size === page.length) {
      const changes = page.filter(({snapshot, price}) => shouldReplaceLatest(snapshot!.get('latestEodPrice'), price));
      if (!changes.length) continue;
      const batch = db.batch();
      for (const {ref, snapshot, price} of changes) {
        batch.update(ref, {latestEodPrice: price}, {lastUpdateTime: snapshot!.updateTime});
      }
      try {
        await batch.commit();
        continue;
      } catch (error) {
        if (![5, 6, 9, 10].includes(Number((error as {code?: number}).code))) throw error;
      }
    }
    await db.runTransaction(async tx=>{
      const saved=await tx.getAll(...page.map(w=>w.ref));
      page.forEach(({ref,price,symbol},index)=>{
        if(!shouldReplaceLatest(saved[index].get('latestEodPrice'),price))return;
        if(saved[index].exists)tx.update(ref,{latestEodPrice:price});
        else tx.create(ref,{latestEodPrice:price,symbol,market:price.market,assetType:'equity',currency:price.currency,active:false,predictionSupported:false});
      });
    });
  }
}
