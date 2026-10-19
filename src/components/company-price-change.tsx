import type {DailyPrice} from '@/lib/intelligence/price-performance';
import {signedPercent} from '@/lib/intelligence/price-performance';
import styles from './intelligence-price-performance.module.css';

/** Shared compact quote for every company view; dates and basis stay in the hint. */
export function CompanyPriceChange({price,locale,nativeHint=true}:{price?:DailyPrice;locale:string;nativeHint?:boolean}){
  if(price?.change==null)return null;
  const zh=locale==='zh-CN';
  return <span className={styles.quoteChange} style={{color:price.change>0?'var(--price-up,#6ae0bc)':price.change<0?'var(--price-down,#ffa0b1)':'var(--price-flat,#a8bfce)'}} title={nativeHint?`${zh?'日涨跌':'Daily price change'}: ${price.previousTradingDate} → ${price.tradingDate} · ${zh?'未调整收盘价':'unadjusted closing prices'}`:undefined}><span aria-hidden="true" style={{color:"inherit"}}>{price.change>0?'▲ ':price.change<0?'▼ ':'— '}</span>{signedPercent(price.change)}</span>;
}
