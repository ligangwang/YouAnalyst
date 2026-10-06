'use client';
import {useId} from 'react';
import {useLocale} from './providers/locale-provider';
import type {GraphNode} from '@/lib/knowledge-graph/model';
import styles from './intelligence-price-performance.module.css';

export function IntelligencePriceAsOf({nodes}:{nodes:GraphNode[]}){
  const {locale}=useLocale(),zh=locale==='zh-CN';
  const hintId=useId();
  const markets=[{prefix:'US:',label:'US'},{prefix:'X',label:'CN'}].flatMap(market=>{
    const dates=nodes.filter(node=>node.id.startsWith(market.prefix)&&node.dailyPrice).map(node=>node.dailyPrice!.tradingDate).sort();
    return dates.length?[{...market,latest:dates.at(-1)!,earliest:dates[0]}]:[];
  });
  if(!markets.length)return null;
  return <span className={`${styles.asOf} ${styles.hint} ${styles.priceHint}`}><button type="button" aria-label={zh?'股价涨跌与收盘日期说明':'Price change and closing date details'} aria-describedby={hintId}>{zh?'股价涨跌':'Price change'} <span aria-hidden="true">ⓘ</span></button><span role="tooltip" id={hintId}>{zh?'公司旁的百分比对比最近两个已完成交易日的收盘价；自动跳过周末和休市日。':'Company percentages compare the last two completed trading closes, skipping weekends and market holidays.'}<br/>{zh?'价格截至':'Prices as of'}{markets.map(market=><span className={styles.marketDate} key={market.label}>{market.label} {market.latest}{market.earliest!==market.latest?` (${zh?'部分股票截至':'some stocks as of'} ${market.earliest})`:''}</span>)}<br/>{zh?'每日收盘数据，非实时行情。不含股息与拆股调整。':'Daily closing prices, not live quotes. Excludes dividends and split adjustments.'}</span></span>;
}
