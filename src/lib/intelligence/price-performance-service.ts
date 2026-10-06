import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { predictionInstrument } from '../predictions/instrument';
import type { KnowledgeGraph } from '../knowledge-graph/model';
import type { IntelligenceEvent } from './model';
import { completedCloseDate, dailyPrice, eventPriceReturn, priceBars, type PriceBar } from './price-performance';

const cache=new Map<string,{bars:PriceBar[];expires:number}>();
const pending=new Map<string,Promise<PriceBar[]>>();
async function loadBars(db:Firestore,ticker:string,now:Date):Promise<PriceBar[]>{
  const instrument=predictionInstrument(ticker)!;
  const through=completedCloseDate(instrument.market,now),key=`${instrument.market}_${ticker}_${through}`;
  const old=cache.get(key);if(old&&old.expires>Date.now())return old.bars;
  if(pending.has(key))return pending.get(key)!;
  const request=(async()=>{
    const rows:PriceBar[]=[];
    // Raw closes are normalized by maintenance, within the existing collection.
    // The web runtime requires no access to the worker's provider-cache bucket.
    const from=new Date(Date.parse(through)-45*86400000).toISOString().slice(0,10);
    const prefix=`${instrument.market}_${ticker}_`;
    const docs=await db.collection('eod_prices').where(FieldPath.documentId(),'>=',prefix+from).where(FieldPath.documentId(),'<=',prefix+through).select('ticker','market','tradingDate','isFinal','rawClose').get();
    for(const doc of docs.docs){const row=doc.data();if(row.ticker===ticker&&row.market===instrument.market&&row.isFinal===true&&typeof row.tradingDate==='string'&&typeof row.rawClose==='number')rows.push({date:row.tradingDate,close:row.rawClose});}
    const bars=priceBars(rows,through);
    cache.set(key,{bars,expires:Date.now()+300_000});
    // Do not retain one cache entry per historical request day forever.
    for(const [id,value]of cache)if(value.expires<Date.now())cache.delete(id);
    return bars;
  })();
  pending.set(key,request);try{return await request;}finally{pending.delete(key);}
}

/** Viewing the graph reads stored prices only; no market-data API calls. */
export async function attachPricePerformance(db:Firestore,graph:KnowledgeGraph,events:IntelligenceEvent[],now:Date){
  const returns:Record<string,NonNullable<ReturnType<typeof eventPriceReturn>>[]>={};
  const nodes=graph.nodes.map(node=>({...node}));
  const companies=nodes.filter(node=>node.kind==='COMPANY'&&/^(US:|XSHG:|XSHE:)/.test(node.id));
  for(let i=0;i<companies.length;i+=12)await Promise.all(companies.slice(i,i+12).map(async node=>{
    const ticker=node.id.startsWith('US:')?node.id.slice(3):node.id,instrument=predictionInstrument(ticker);
    if(!instrument)return;
    try{
      const bars=await loadBars(db,ticker,now);node.dailyPrice=dailyPrice(bars,instrument.market);
      for(const event of events){const value=eventPriceReturn(event,node.id,bars,instrument.market,now);if(value)(returns[event.id]??=[]).push(value);}
    }catch(error){console.warn('Graph daily prices unavailable',node.id,(error as {code?:unknown}).code);}
  }));
  return {graph:{...graph,nodes},eventReturns:returns};
}
