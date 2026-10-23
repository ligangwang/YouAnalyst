/** IDs already encode the market, ticker and date. No new Firestore fields. */
export type PricePartition={market:string;ticker:string;year:number;prefix:string;object:string};
export function pricePartition(id:string):PricePartition|undefined {
 const match=/^(CN_A|US|FX)_(.+)_(\d{4})-\d{2}-\d{2}$/.exec(id);
 if(!match||match[2].includes('/'))return undefined;
 const [,market,ticker,year]=match;
 return {market,ticker,year:Number(year),prefix:`${market}_${ticker}_${year}-`,object:`price-snapshots/${market}/${encodeURIComponent(ticker)}/${year}.sqlite`};
}
export function partitionFor(prefix:string,year:number){
 const value=pricePartition(`${prefix}${year}-01-01`);if(!value)throw Error('Invalid price partition');return value;
}
