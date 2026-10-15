"use client";
import { useState } from 'react';
import { useLocale } from './providers/locale-provider';
import { LocalizedLink } from './localized-link';
import { companyName } from '@/lib/knowledge-graph/model';
import { companyPageUrl } from '@/lib/market-companies/routes';
import type { ComparisonMetric, PeerComparison } from '@/lib/peer-comparison/model';
import styles from './company-peer-comparison.module.css';
const labels:Record<ComparisonMetric,[string,string]>={marketCap:['Market cap','总市值'],floatMarketCap:['Tradable A-share market cap','A股流通市值'],revenue:['Annual revenue','年度营收'],profit:['Annual net income','年度净利润'],fiveDayReturn:['5-session return','近5个交易日涨幅'],eps:['Annual diluted EPS','年度摊薄每股收益']};
export function CompanyPeerComparison({data}:{data:PeerComparison}){
 const {text,locale}=useLocale();
 const [key,setKey]=useState<ComparisonMetric>(data.panels[0]?.key??'marketCap'),[expanded,setExpanded]=useState(false);
 const panel=data.panels.find(p=>p.key===key)??data.panels[0];if(!panel)return null;
 const current=panel.rows.find(row=>row.id===data.companyId);
 const displayed=expanded?panel.rows:[...panel.rows.slice(0,3),...(current&&!panel.rows.slice(0,3).includes(current)?[current]:[])];
 const label=(metric:ComparisonMetric)=>metric==='profit'&&data.market==='CN_A'?text('Annual profit attributable to parent','年度归母净利润'):text(...labels[metric]);
 const format=(value:number)=>panel.key==='fiveDayReturn'?`${value>0?'+':''}${new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value)}%`:new Intl.NumberFormat(locale,{notation:panel.key==='eps'?'standard':'compact',maximumFractionDigits:2,minimumFractionDigits:panel.key==='eps'?2:0}).format(value);
 const signed=panel.rows.some(row=>(row.observation?.value??0)<0),maximum=Math.max(1,...panel.rows.map(row=>Math.abs(row.observation?.value??0)));
 return <section id="company-peer-comparison" className={styles.section} aria-labelledby="peer-comparison-heading">
  <h2 id="peer-comparison-heading">{text('Peer comparison','同业对比')}</h2>
  <p className={styles.scope}>{text(data.sector.en,data.sector.zh)} · {data.market==='CN_A'?text('A-shares','A股'):text('US-listed','美股上市公司')} · {data.total} {text('companies in the recorded group','家已收录公司')}</p>
  <p className={styles.note}>{text('Same-market companies with the same recorded industry role. Coverage is partial; this is not a full-industry ranking.','比较同一市场、同一已收录产业角色的公司。当前覆盖不完整，排名仅代表已有样本。')}</p>
  <div className={styles.metrics} role="group" aria-label={text('Comparison metric','对比指标')}>{data.panels.map(item=><button type="button" key={item.key} aria-pressed={panel.key===item.key} onClick={()=>{setKey(item.key);setExpanded(false);}}>{label(item.key)}</button>)}</div>
  <div className={styles.summary} aria-live="polite">
   <span>{text('Sample coverage','样本覆盖')} {panel.count}/{data.total}</span>
   <span>{current?.rank?`${text('Your company’s sample rank','当前公司样本排名')} ${current.rank}/${panel.count}`:text('Current company: data unavailable','当前公司：暂无数据')}</span>
   <span>{panel.key==='fiveDayReturn'?`${panel.start} → ${panel.date}`:`${text(panel.annual?'Report period anchor':'As of',panel.annual?'报告期基准':'数据日期')} ${panel.date}`}</span>
  </div>
  <p className={styles.note}>{panel.key==='fiveDayReturn'?text('Change across the same five stored trading sessions, using adjusted closing prices.','按同一组五个交易日的复权收盘价计算涨幅。'):text(panel.currency==='CNY'?'Values in CNY':'Values in USD',panel.currency==='CNY'?'金额单位：人民币元':'金额单位：美元')}{panel.key==='eps'?text(' per share','／股'):''}{panel.annual?text(' · Latest annual reports ending within 120 days of the anchor; not TTM. Each company’s period is shown below.',' · 采用截止日距基准不超过120天的最近年报，并非TTM。各公司报告期见下方。'):''}</p>
  {panel.key==='marketCap'&&<p className={styles.note}>{text('Market caps are estimates based on cached closing prices and disclosed share counts.','市值按已缓存收盘价与披露股数估算。')}</p>}
  {panel.key==='floatMarketCap'&&<p className={styles.note}>{text('Tradable A-share count × A-share closing price.','A股流通市值＝已披露A股流通股数 × A股收盘价。')}</p>}
  <dl className={styles.averages}><div><dt>{text('Sample mean','样本均值')}</dt><dd>{format(panel.mean)}</dd></div><div><dt>{text('Sample median','样本中位数')}</dt><dd>{format(panel.median)}</dd></div></dl>
  <ol className={styles.rows} aria-label={label(panel.key)}>{displayed.map(row=>{
   const value=row.observation?.value,negative=value!==undefined&&value<0,width=value===undefined?0:Math.abs(value)/maximum*(signed?50:100);
   return <li key={row.id} className={row.id===data.companyId?styles.current:undefined} aria-current={row.id===data.companyId?'true':undefined}>
    <span className={styles.rank}>{row.rank??'—'}</span>
    <div className={styles.company}><LocalizedLink href={companyPageUrl(row.id,data.market,row.slug)}>{companyName(row,locale)}</LocalizedLink><small>{row.symbol??row.id.split(':')[1]}{panel.annual&&row.observation?` · ${row.observation.start} → ${row.observation.date}`:''}</small></div>
    <div className={styles.plot} aria-hidden="true">{signed&&<span className={styles.zero}/>}<span className={styles.bar} data-negative={negative} style={{width:`${width}%`,left:signed?`${negative?50-width:50}%`:'0%'}}/></div>
    <span className={styles.value}>{value===undefined?text('No data','暂无数据'):row.observation?.sourceUrl?<a href={row.observation.sourceUrl} target="_blank" rel="noopener noreferrer" title={text('View source','查看来源')}>{format(value)}</a>:format(value)}</span>
   </li>;
  })}</ol>
  {panel.rows.length>3&&<button type="button" className={styles.expand} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?text('Show fewer','收起'):text(`View all ${data.total} companies`,`查看全部 ${data.total} 家公司`)}</button>}
 </section>;
}
