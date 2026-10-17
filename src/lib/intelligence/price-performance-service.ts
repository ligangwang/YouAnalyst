import { type Firestore } from 'firebase-admin/firestore';
import { predictionInstrument } from '../predictions/instrument';
import type { KnowledgeGraph } from '../knowledge-graph/model';
import type { IntelligenceEvent } from './model';
import {cachedPriceEntry,cachedBaseline,loadPriceCache,type PriceCacheView} from './price-cache';
import { eventBaselineThrough, completedCloseDate, dailyPrice, eventPriceReturn, priceBars } from './price-performance';

/** Viewing the graph reads stored prices only; no market-data API calls. */
export async function attachPricePerformance(db:Firestore,graph:KnowledgeGraph,events:IntelligenceEvent[],now:Date,cacheView?:PriceCacheView){
  const view=cacheView??await loadPriceCache(db);
  const returns:Record<string,NonNullable<ReturnType<typeof eventPriceReturn>>[]>={};
  const nodes=graph.nodes.map(node=>({...node}));
  const companies=nodes.filter(node=>node.kind==='COMPANY'&&/^(US:|XSHG:|XSHE:)/.test(node.id));
  for(let i=0;i<companies.length;i+=12)await Promise.all(companies.slice(i,i+12).map(async node=>{
    const ticker=node.id.startsWith('US:')?node.id.slice(3):node.id,instrument=predictionInstrument(ticker);
    if(!instrument)return;
    try{
      const entry=await cachedPriceEntry(db,view,ticker,now);
      const bars=priceBars(entry.bars,completedCloseDate(instrument.market,now));
      node.dailyPrice=dailyPrice(bars,instrument.market);
      for(const event of events){
        if(!event.companyIds.includes(node.id))continue;
        const through=eventBaselineThrough(event,instrument.market,now);
        if(!through||!bars.length)continue;
        const baseline=bars.findLast(bar=>bar.date<=through)??await cachedBaseline(db,view,ticker,through);
        const eventBars=priceBars([...(baseline?[baseline]:[]),...bars],completedCloseDate(instrument.market,now));
        const value=eventPriceReturn(event,node.id,eventBars,instrument.market,now);
        if(value)(returns[event.id]??=[]).push(value);
      }
    }catch(error){console.warn('Graph daily prices unavailable',node.id,(error as {code?:unknown}).code);}
  }));
  return {graph:{...graph,nodes},eventReturns:returns};
}
