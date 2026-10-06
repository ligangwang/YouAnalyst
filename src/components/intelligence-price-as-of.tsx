'use client';
import {useLocale} from './providers/locale-provider';
import type {GraphNode} from '@/lib/knowledge-graph/model';
import styles from './intelligence-price-performance.module.css';

export function IntelligencePriceAsOf({nodes}:{nodes:GraphNode[]}){
  const {locale}=useLocale(),zh=locale==='zh-CN';
  const markets=[{prefix:'US:',label:'US'},{prefix:'X',label:'CN'}].flatMap(market=>{
    const dates=nodes.filter(node=>node.id.startsWith(market.prefix)&&node.dailyPrice).map(node=>node.dailyPrice!.tradingDate).sort();
    return dates.length?[{...market,latest:dates.at(-1)!,earliest:dates[0]}]:[];
  });
  if(!markets.length)return null;
  return <span className={styles.asOf} aria-label={zh?'收盘价日期':'Closing price dates'}><span>{zh?'价格截至':'Prices as of'}</span>{markets.map(market=><span key={market.label} title={`${market.label}: ${market.latest}${market.earliest!==market.latest?` (${zh?'部分股票数据截至':'some stocks as of'} ${market.earliest})`:''}`}>{market.label} {market.latest}</span>)}</span>;
}
