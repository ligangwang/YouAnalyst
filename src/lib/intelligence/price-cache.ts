import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, type Firestore, type DocumentReference, type Precondition, type Transaction } from 'firebase-admin/firestore';
import { predictionInstrument } from '../predictions/instrument';
import { completedCloseDate, priceBars, type PriceBar } from './price-performance';

const META='_graph_prices_v1';
type Entry={bars:PriceBar[];baselines:Record<string,PriceBar|null>};
type Bucket={entries:Record<string,Entry>};
export type PriceCacheView={version:string;entries:Record<string,Entry>};
const memory=new WeakMap<Firestore,{versions:Record<string,string>;buckets:Record<string,Bucket>}>();
const keyFor=(ticker:string)=>`${predictionInstrument(ticker)!.market}_${ticker}`;
const bucketFor=(key:string)=>createHash('sha256').update(key).digest('hex').slice(0,2);
const refFor=(db:Firestore,id:string)=>db.collection('collectors').doc(`${META}_${id}`);
const barFrom=(row:Record<string,unknown>,ticker:string):PriceBar|undefined=>{
 const instrument=predictionInstrument(ticker);
 if(!instrument||row.ticker!==ticker||row.market!==instrument.market||row.isFinal!==true||typeof row.tradingDate!=='string'||typeof row.rawClose!=='number')return;
 return priceBars([{date:row.tradingDate,close:row.rawClose}],'9999-12-31')[0];
};

// Bounds are trading-date document IDs. Read two valid closes for graph bootstrap,
// or one exact pre-event close; never load a fixed 45-day history window.
async function queryCloses(db:Firestore,ticker:string,through:string,count:number,tx?:Transaction){
 const prefix=keyFor(ticker)+'_';
 let query=db.collection('eod_prices').where(FieldPath.documentId(),'>=',prefix)
  .where(FieldPath.documentId(),'<=',prefix+through).orderBy(FieldPath.documentId(),'desc').limit(count);
 const rows:PriceBar[]=[];
 for(;;){
  const selected=query.select('ticker','market','tradingDate','isFinal','rawClose');
  const page=await (tx?tx.get(selected):selected.get());
  for(const doc of page.docs){const bar=barFrom(doc.data(),ticker);if(bar)rows.push(bar);if(rows.length===count)break;}
  if(rows.length===count||page.size<count)break;
  query=query.startAfter(page.docs.at(-1)!);
 }
 return priceBars(rows,through);
}

export async function loadPriceCache(db:Firestore):Promise<PriceCacheView>{
 const versions=((await db.collection('collectors').doc(META).get()).get('buckets')??{}) as Record<string,string>;
 const old=memory.get(db),buckets={...old?.buckets};
 const changed=Object.keys(versions).filter(id=>old?.versions[id]!==versions[id]);
 if(changed.length){const docs=await db.getAll(...changed.map(id=>refFor(db,id)));docs.forEach((doc,i)=>{buckets[changed[i]]={entries:(doc.get('entries')??{}) as Bucket['entries']};});}
 memory.set(db,{versions,buckets});
 return {version:JSON.stringify(versions),entries:Object.assign({},...Object.values(buckets).map(bucket=>bucket.entries))};
}

export async function cachedPriceEntry(db:Firestore,view:PriceCacheView,ticker:string,now:Date):Promise<Entry>{
 const key=keyFor(ticker),id=bucketFor(key);
 if(view.entries[key])return view.entries[key];
 const result=await db.runTransaction(async tx=>{
  const ref=refFor(db,id),doc=await tx.get(ref),entries=(doc.get('entries')??{}) as Bucket['entries'];
  if(entries[key])return entries[key];
  const bars=await queryCloses(db,ticker,completedCloseDate(predictionInstrument(ticker)!.market,now),2,tx);
  const entry={bars,baselines:{}};
  tx.set(ref,{entries:{...entries,[key]:entry}});
  tx.set(db.collection('collectors').doc(META),{buckets:{[id]:randomUUID()}},{merge:true});
  return entry;
 });
 view.entries[key]=result;return result;
}

export async function cachedBaseline(db:Firestore,view:PriceCacheView,ticker:string,through:string):Promise<PriceBar|undefined>{
 const key=keyFor(ticker),id=bucketFor(key),ref=refFor(db,id);
 const local=view.entries[key];
 if(local&&Object.hasOwn(local.baselines,through))return local.baselines[through]??undefined;
 const result=await db.runTransaction(async tx=>{
  const doc=await tx.get(ref),entries=(doc.get('entries')??{}) as Bucket['entries'];
  const entry=entries[key];if(!entry)throw Error('Graph price entry must be initialized');
  if(Object.hasOwn(entry.baselines,through))return entry.baselines[through]??undefined;
  const bar=(await queryCloses(db,ticker,through,1,tx)).at(-1);
  const baselines={...entry.baselines,[through]:bar??null};
  // Bounded history for active event dates; graph prices always retain two closes.
  for(const date of Object.keys(baselines).sort().slice(0,-16))delete baselines[date];
  tx.set(ref,{entries:{...entries,[key]:{...entry,baselines}}});
  tx.set(db.collection('collectors').doc(META),{buckets:{[id]:randomUUID()}},{merge:true});
  return bar;
 });
 if(local)local.baselines[through]=result??null;
 return result;
}

/** Atomically publish source data and update any initialized graph cache.
 * EOD imports, history backfills and raw-close corrections share this path.
 */
export async function writeCachedPrice(db:Firestore,ref:DocumentReference,patch:Record<string,unknown>,options:{create?:boolean;precondition?:Precondition}={}){
 await db.runTransaction(async tx=>{
  const source=await tx.get(ref),previous=source.data()??{},next={...previous,...patch};
  const ticker=String(next.ticker??''),instrument=predictionInstrument(ticker);
  const key=instrument?keyFor(ticker):'',id=instrument?bucketFor(key):'';
  const bucket=instrument?await tx.get(refFor(db,id)):undefined;
  const entries=(bucket?.get('entries')??{}) as Bucket['entries'],entry=entries[key];
  if(options.create)tx.create(ref,patch);
  else if(options.precondition)tx.update(ref,patch,options.precondition);
  else tx.set(ref,patch,{merge:true});
  if(!entry||JSON.stringify(barFrom(previous,ticker))===JSON.stringify(barFrom(next,ticker)))return;
  const bar=barFrom(next,ticker),oldBar=barFrom(previous,ticker);
  if(!bar&&entry.bars.some(item=>item.date===oldBar?.date))delete entries[key];
  else {
   const bars=bar?priceBars([...entry.bars,bar],'9999-12-31').slice(-2):entry.bars;
   const changedDate=bar?.date??oldBar?.date;
   const baselines=Object.fromEntries(Object.entries(entry.baselines).filter(([through])=>!changedDate||through<changedDate));
   const updated={bars,baselines};
   if(JSON.stringify(updated)===JSON.stringify(entry))return;
   entries[key]=updated;
  }
  tx.set(refFor(db,id),{entries});
  tx.set(db.collection('collectors').doc(META),{buckets:{[id]:randomUUID()}},{merge:true});
 });
}

/** Create missing history for one instrument in one transaction. The source
 * rows and the graph cache revision commit together, at most once per batch. */
export async function createCachedPriceBatch(db:Firestore,rows:Array<{ref:DocumentReference;patch:Record<string,unknown>}>){
 if(!rows.length)return {created:0,existing:0};
 const ticker=String(rows[0].patch.ticker??''),instrument=predictionInstrument(ticker);
 if(!instrument||rows.some(row=>row.patch.ticker!==ticker||row.patch.market!==instrument.market))throw Error('Price batch must contain one instrument');
 const key=keyFor(ticker),id=bucketFor(key);
 return db.runTransaction(async tx=>{
  // All reads precede writes, including the cache bucket. A transaction retry
  // sees prices created concurrently and keeps their authoritative values.
  const [bucket,...sources]=await tx.getAll(refFor(db,id),...rows.map(row=>row.ref));
  const entries=(bucket.get('entries')??{}) as Bucket['entries'];
  const original=entries[key];let entry=original,created=0,existing=0;
  for(let i=0;i<rows.length;i++){
   if(sources[i].exists){existing++;continue;}
   const {ref,patch}=rows[i];tx.create(ref,patch);created++;
   if(!entry)continue;
   const bar=barFrom(patch,ticker);if(!bar)continue;
   entry={bars:priceBars([...entry.bars,bar],'9999-12-31').slice(-2),
    baselines:Object.fromEntries(Object.entries(entry.baselines).filter(([through])=>through<bar.date))};
  }
  if(original&&entry&&JSON.stringify(entry)!==JSON.stringify(original)){
   entries[key]=entry;tx.set(refFor(db,id),{entries});
   tx.set(db.collection('collectors').doc(META),{buckets:{[id]:randomUUID()}},{merge:true});
  }
  return {created,existing};
 });
}
