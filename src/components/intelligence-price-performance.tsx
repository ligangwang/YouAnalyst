'use client';
import { useId } from 'react';
import { useLocale } from './providers/locale-provider';
import type { DailyPrice, EventPriceReturn } from '@/lib/intelligence/price-performance';
import { signedPercent } from '@/lib/intelligence/price-performance';
import styles from './intelligence-price-performance.module.css';

export function IntelligencePricePerformance({price,returns=[],symbol,compact=false}:{price?:DailyPrice;returns?:EventPriceReturn[];symbol?:(id:string)=>string;compact?:boolean}){
  const {locale}=useLocale(),zh=locale==='zh-CN';
  const hintId=useId();
  if(!price&&!returns.length)return null;
  const direction=(change:number)=>change>0?'up':change<0?'down':'flat';
  const explanation=(returns.length?(zh?'使用公告前最后一个完整交易日的收盘价。':'Uses the last completed close before publication. '):'')+(zh?'不含股息与拆股调整。每日收盘数据，非实时行情。':'Excludes dividend and split adjustments. Daily closes, not live quotes.');
  return <section className={styles.performance} aria-label={zh?'股价表现':'Price performance'}>
    {price&&<div><span>{zh?'最新收盘':'Latest close'} · {price.tradingDate}</span><strong>{new Intl.NumberFormat(locale,{style:'currency',currency:price.currency}).format(price.close)} {price.change!==null&&<b data-direction={direction(price.change)}>{signedPercent(price.change)}</b>}</strong>{price.previousTradingDate&&<small>{zh?'对比':'Compared with'} {price.previousTradingDate}</small>}</div>}
    {returns.map((value,index)=>{
      const days=Math.round((Date.parse(value.latestDate)-Date.parse(value.baselineDate))/86400000);
      const descriptionId=`${hintId}-${index}`;
      return <div key={value.companyId}><span>{symbol?.(value.companyId)??value.companyId} · {zh?'公告以来价格变动':'Price change since announcement'}</span><div className={styles.returnLine}><strong data-direction={direction(value.change)}>{signedPercent(value.change)}</strong><small>({days}{zh?'天':'d'})</small><span className={styles.hint}><button type="button" aria-label={zh?'价格变动计算详情':'Price change calculation details'} aria-describedby={descriptionId}>?</button><span role="tooltip" id={descriptionId}>{value.baselineDate} → {value.latestDate} · {zh?'收盘价':'closing prices'}<br/>{days} {zh?'个自然日':'calendar days'}{value.dateOnly?(zh?' · 公告仅提供日期':' · announcement date only'):''}<br/>{explanation}</span></span></div></div>;
    })}
    {!compact&&!returns.length&&<small>{explanation}</small>}
  </section>;
}
