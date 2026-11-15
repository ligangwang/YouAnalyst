import {priceSnapshot,priceStore} from '../price-store/runtime';
import {readHead} from '../price-store/storage';
import type {Step} from '../price-store/query';
import type {Firestore,DocumentReference,Precondition} from 'firebase-admin/firestore';
import {predictionInstrument} from '../predictions/instrument';
import {completedCloseDate,priceBars,type PriceBar} from './price-performance';

type Entry={bars:PriceBar[];baselines:Record<string,PriceBar|null>};
export type PriceCacheView={version:string;entries:Record<string,Entry>};
const keyFor=(ticker:string)=>`${predictionInstrument(ticker)!.market}_${ticker}`;
const barFrom=(row:Record<string,unknown>,ticker:string):PriceBar|undefined=>{
 const instrument=predictionInstrument(ticker);
 if(!instrument||row.ticker!==ticker||row.market!==instrument.market||row.isFinal!==true||typeof row.tradingDate!=='string'||typeof row.rawClose!=='number')return;
 return priceBars([{date:row.tradingDate,close:row.rawClose}],'9999-12-31')[0];
};
async function queryCloses(db:Firestore,ticker:string,through:string,count:number){
 const prefix=keyFor(ticker)+'_';
 const steps:Step[]=[{method:'where',args:['id','>=',prefix]},{method:'where',args:['id','<=',prefix+through]},
  {method:'orderBy',args:['id','desc']},{method:'limit',args:[count]}];
 const rows:PriceBar[]=[];let cursor:string|undefined;
 for(;;){
  const selected=[...steps,...(cursor?[{method:'startAfter',args:[cursor]}]:[])];
  const page=await priceSnapshot(db,selected) as {docs:Array<{id:string;data:()=>Record<string,unknown>}>;size:number};
  for(const doc of page.docs){const bar=barFrom(doc.data(),ticker);if(bar)rows.push(bar);if(rows.length===count)break;}
  if(rows.length===count||page.size<count)break;
  cursor=page.docs.at(-1)!.id;
 }
 return priceBars(rows,through);
}
export async function loadPriceCache(_db:Firestore,tickers?:string[]):Promise<PriceCacheView>{
 if(tickers&&!tickers.length)return {version:'',entries:{}};
 const store=await priceStore();return {version:(await readHead(store.bucket)).generation,entries:{}};
}
export async function cachedPriceEntry(db:Firestore,view:PriceCacheView,ticker:string,now:Date):Promise<Entry>{
 const key=keyFor(ticker);
 return view.entries[key]??= {bars:await queryCloses(db,ticker,completedCloseDate(predictionInstrument(ticker)!.market,now),2),baselines:{}};
}
export async function cachedBaseline(db:Firestore,view:PriceCacheView,ticker:string,through:string):Promise<PriceBar|undefined>{
 const local=view.entries[keyFor(ticker)];
 if(local&&Object.hasOwn(local.baselines,through))return local.baselines[through]??undefined;
 const bar=(await queryCloses(db,ticker,through,1)).at(-1);
 if(local)local.baselines[through]=bar??null;return bar;
}
/** Publish immutable Parquet data and atomically advance the GCS manifest. */
export async function writeCachedPrice(_db:Firestore,ref:DocumentReference,patch:Record<string,unknown>,options:{create?:boolean;precondition?:Precondition}={}){
 await (await priceStore()).mutate([{id:ref.id,data:patch,mode:options.create?'create':'merge',updateTime:options.precondition?.lastUpdateTime,exists:options.precondition?.exists}]);
}
export async function writeCachedPrices(_db:Firestore,rows:Array<{ref:DocumentReference;patch:Record<string,unknown>}>) {
 for(let i=0;i<rows.length;i+=1000)await (await priceStore()).mutate(rows.slice(i,i+1000).map(row=>({id:row.ref.id,data:row.patch})));
}
export async function createCachedPriceBatch(_db:Firestore,rows:Array<{ref:DocumentReference;patch:Record<string,unknown>}>,_options:{createFirst?:boolean}={}){
 void _options;
 if(!rows.length)return {created:0,existing:0};
 const ticker=String(rows[0].patch.ticker??''),instrument=predictionInstrument(ticker);
 if(!instrument||rows.some(row=>row.patch.ticker!==ticker||row.patch.market!==instrument.market))throw Error('Price batch must contain one instrument');
 const total={created:0,existing:0},store=await priceStore();
 for(let i=0;i<rows.length;i+=1000){const result=await store.mutate(rows.slice(i,i+1000).map(row=>({id:row.ref.id,data:row.patch,mode:'missing'})));total.created+=result.created;total.existing+=result.existing;}
 return total;
}
