'use client';
import { useLocale } from './providers/locale-provider';
import type { DailyPrice, EventPriceReturn } from '@/lib/intelligence/price-performance';
import { signedPercent } from '@/lib/intelligence/price-performance';
import styles from './intelligence-price-performance.module.css';

export function IntelligencePricePerformance({price,returns=[],symbol,compact=false}:{price?:DailyPrice;returns?:EventPriceReturn[];symbol?:(id:string)=>string;compact?:boolean}){
  const {locale}=useLocale(),zh=locale==='zh-CN';
  if(!price&&!returns.length)return null;
  const direction=(change:number)=>change>0?'up':change<0?'down':'flat';
  const explanation=(returns.length?(zh?'使用公告前最后一个完整交易日的收盘价。':'Uses the last completed close before publication. '):'')+(zh?'不含股息与拆股调整。每日收盘数据，非实时行情。':'Excludes dividend and split adjustments. Daily closes, not live quotes.');
  return <section className={styles.performance} title={explanation} aria-label={zh?'股价表现':'Price performance'}>
    {price&&<div><span>{zh?'最新收盘':'Latest close'} · {price.tradingDate}</span><strong>{new Intl.NumberFormat(locale,{style:'currency',currency:price.currency}).format(price.close)} {price.change!==null&&<b data-direction={direction(price.change)}>{signedPercent(price.change)} <small>{zh?'日涨跌':'daily'}</small></b>}</strong>{price.previousTradingDate&&<small>{zh?'对比':'Compared with'} {price.previousTradingDate}</small>}</div>}
    {returns.map(value=><div key={value.companyId}><span>{symbol?.(value.companyId)??value.companyId} · {zh?'公告以来价格变动':'Price change since announcement'}</span><strong data-direction={direction(value.change)}>{signedPercent(value.change)}</strong><small>{value.baselineDate} → {value.latestDate} · {zh?'收盘价':'closing prices'}{value.dateOnly?(zh?' · 公告仅提供日期':' · announcement date only'):''}</small></div>)}
    {!compact&&<small>{explanation}</small>}
  </section>;
}
