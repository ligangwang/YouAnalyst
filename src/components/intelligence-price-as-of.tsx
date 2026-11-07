'use client';
import {useEffect,useId,useState} from 'react';
import {useLocale} from './providers/locale-provider';
import styles from './intelligence-price-performance.module.css';

export function IntelligencePriceAsOf(){
  const {locale}=useLocale(),zh=locale==='zh-CN';
  const hintId=useId();
  const [dates,setDates]=useState<{US:string|null;CN_A:string|null}|null>(null);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    const refresh=async()=>{
      try{
        const response=await fetch('/api/eod/completed',{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw Error('EOD dates unavailable');
        const value=await response.json();
        if(!controller.signal.aborted){setDates(value);setFailed(false);}
      }catch{if(!controller.signal.aborted)setFailed(true);}
    };
    void refresh();
    const timer=setInterval(()=>{void refresh();},60_000);
    return ()=>{controller.abort();clearInterval(timer);};
  },[]);
  const markets=[{key:'US' as const,label:'US'},{key:'CN_A' as const,label:'CN'}];
  return <span className={`${styles.asOf} ${styles.hint} ${styles.priceHint}`}><button type="button" aria-label={zh?'股价涨跌与收盘日期说明':'Price change and closing date details'} aria-describedby={hintId}><span aria-hidden="true">ⓘ</span></button><span role="tooltip" id={hintId}>{zh?'公司旁的百分比对比最近两个已完成交易日的收盘价；自动跳过周末和休市日。':'Company percentages compare the last two completed trading closes, skipping weekends and market holidays.'}<br/>{zh?'最近完成的收盘数据日期':'Latest completed EOD dates'}{markets.map(market=><span className={styles.marketDate} key={market.key}>{market.label} {failed?(zh?'暂不可用':'Unavailable'):dates?(dates[market.key]??(zh?'暂无已完成数据':'No completed data')):(zh?'加载中…':'Loading…')}</span>)}<br/>{zh?'个别股票可能缺少当日收盘价。':'Individual stocks may lack a closing price for that date.'}<br/>{zh?'每日收盘数据，非实时行情。不含股息与拆股调整。':'Daily closing prices, not live quotes. Excludes dividends and split adjustments.'}</span></span>;
}
