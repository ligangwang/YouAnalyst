import type {DailyPrice} from '@/lib/intelligence/price-performance';
import {signedPercent} from '@/lib/intelligence/price-performance';
import styles from './intelligence-price-performance.module.css';

/** Shared compact quote for every company view; dates and basis stay in the hint. */
export function CompanyPriceChange({price,locale}:{price?:DailyPrice;locale:string}){
  if(price?.change==null)return null;
  const zh=locale==='zh-CN';
  return <span className={styles.quoteChange} style={{color:price.change>0?'#6ae0bc':price.change<0?'#ffa0b1':'#a8bfce'}} title={`${zh?'日涨跌':'Daily price change'}: ${price.previousTradingDate} → ${price.tradingDate} · ${zh?'未调整收盘价':'unadjusted closing prices'}`}>{signedPercent(price.change)}</span>;
}
