"use client";
import { useEffect, useRef, useState } from 'react';
import { useLocale } from './providers/locale-provider';
import { LocalizedLink } from './localized-link';
import { companyName } from '@/lib/knowledge-graph/model';
import { companyPageUrl } from '@/lib/market-companies/routes';
import type { ComparisonMetric, ComparisonPanel, PeerCompany, PeerComparison } from '@/lib/peer-comparison/model';
import {PRICE_PEER_PAGE_SIZE,visiblePriceIds} from '@/lib/peer-comparison/price-demand';
import styles from './company-peer-comparison.module.css';
const labels:Record<ComparisonMetric,[string,string]>={marketCap:['Market cap','总市值'],floatMarketCap:['Tradable A-share market cap','A股流通市值'],revenue:['Annual revenue','年度营收'],profit:['Annual net income','年度净利润'],fiveDayReturn:['5-session return','近5个交易日涨幅'],eps:['Annual diluted EPS','年度摊薄每股收益']};
export function CompanyPeerComparison({data}:{data:PeerComparison}){
 const {text,locale}=useLocale();
 const [key,setKey]=useState<ComparisonMetric>(data.panels.find(panel=>panel.key!=='fiveDayReturn')?.key??'marketCap'),[expanded,setExpanded]=useState(false);
 const [priceOrder,setPriceOrder]=useState<PeerCompany[]>(data.panels[0]?.rows??data.pricePeers??[]),[pricePage,setPricePage]=useState(0);
 const [priceState,setPriceState]=useState<{request:string;panel:ComparisonPanel|null;error?:boolean}|null>(null),[retry,setRetry]=useState(0);
 const priceCache=useRef(new Map<string,ComparisonPanel|null>());
 const ids=visiblePriceIds(data.companyId,priceOrder,expanded,pricePage);
 const requestKey=JSON.stringify([data.companyId,ids]);
 useEffect(()=>{
  if(key!=='fiveDayReturn')return;
  const controller=new AbortController();let active=true;
  if(priceCache.current.has(requestKey)){
   setPriceState({request:requestKey,panel:priceCache.current.get(requestKey)!});
  }else{
   const [company,peers]=JSON.parse(requestKey) as [string,string[]];
   const params=new URLSearchParams({company});peers.forEach(id=>params.append('peer',id));
   void fetch(`/api/company-peer-prices?${params}`,{signal:controller.signal}).then(async response=>{
    if(!response.ok)throw Error('Price request failed');
    const result=await response.json() as {panel:ComparisonPanel|null};
    if(!active)return;
    // Retain a few displayed pages, never an entire sector history.
    if(priceCache.current.size>=8)priceCache.current.delete(priceCache.current.keys().next().value!);
    priceCache.current.set(requestKey,result.panel);setPriceState({request:requestKey,panel:result.panel});
   }).catch(()=>{if(active)setPriceState({request:requestKey,panel:null,error:true});});
  }
  return()=>{active=false;controller.abort();};
 },[key,requestKey,retry]);
 const emptyPanel:ComparisonPanel|undefined=data.pricePeers?.length?{key:'fiveDayReturn',currency:data.market==='US'?'USD':'CNY',date:'',annual:false,rows:data.pricePeers.map(row=>({...row,observation:null,rank:null})),count:0,mean:0,median:0}:undefined;
 const financialPanel=data.panels.find(p=>p.key===key)??data.panels[0]??emptyPanel;if(!financialPanel)return null;
 const ready=priceState?.request===requestKey?priceState:null;
 const panel=key==='fiveDayReturn'&&ready?.panel?ready.panel:financialPanel;
 const current=panel.rows.find(row=>row.id===data.companyId);
 const displayed=key==='fiveDayReturn'||expanded?panel.rows:[...panel.rows.slice(0,3),...(current&&!panel.rows.slice(0,3).includes(current)?[current]:[])];
 const metrics=[...data.panels.filter(p=>p.key!=='fiveDayReturn').map(p=>p.key),'fiveDayReturn' as const];
 const priceCount=priceOrder.filter(row=>row.id!==data.companyId).length;
 const sampleTotal=key==='fiveDayReturn'?ids.length:data.total;
 const label=(metric:ComparisonMetric)=>metric==='profit'&&data.market==='CN_A'?text('Annual profit attributable to parent','年度归母净利润'):text(...labels[metric]);
 const format=(value:number)=>panel.key==='fiveDayReturn'?`${value>0?'+':''}${new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(value)}%`:new Intl.NumberFormat(locale,{notation:panel.key==='eps'?'standard':'compact',maximumFractionDigits:2,minimumFractionDigits:panel.key==='eps'?2:0}).format(value);
 const signed=panel.rows.some(row=>(row.observation?.value??0)<0),maximum=Math.max(1,...panel.rows.map(row=>Math.abs(row.observation?.value??0)));
 return <section id="company-peer-comparison" className={styles.section} aria-labelledby="peer-comparison-heading">
  <h2 id="peer-comparison-heading">{text('Peer comparison','同业对比')}</h2>
  <p className={styles.scope}>{text(data.sector.en,data.sector.zh)} · {data.market==='CN_A'?text('A-shares','A股'):text('US-listed','美股上市公司')} · {data.total} {text('companies in the recorded group','家已收录公司')}</p>
  <p className={styles.note}>{text('Same-market companies with the same recorded industry role. Coverage is partial; this is not a full-industry ranking.','比较同一市场、同一已收录产业角色的公司。当前覆盖不完整，排名仅代表已有样本。')}</p>
  <div className={styles.metrics} role="group" aria-label={text('Comparison metric','对比指标')}>{metrics.map(metric=><button type="button" key={metric} aria-pressed={key===metric} onClick={()=>{if(metric==='fiveDayReturn'&&key!=='fiveDayReturn')setPriceOrder(financialPanel.rows);setKey(metric);setExpanded(false);setPricePage(0);}}>{label(metric)}</button>)}</div>
  {key==='fiveDayReturn'&&<p className={styles.note}>{text('Returns, ranks and averages cover only the companies displayed on this page. Peers follow the previous metric’s order.','涨幅、排名和均值仅覆盖本页显示的公司。同业公司沿用上一指标的顺序。')}</p>}
  {key!=='fiveDayReturn'&&data.panels.length===0?<p>{text('Select 5-session return to compare prices.','选择近5个交易日涨幅以比较价格。')}</p>:key==='fiveDayReturn'&&(!ready||ready.error||!ready.panel)?<p role="status">
   {!ready?text('Loading displayed companies…','正在加载本页公司…'):ready.error?<>{text('Prices could not be loaded.','价格暂时无法加载。')} <button type="button" onClick={()=>{setPriceState(null);setRetry(n=>n+1);}}>{text('Retry','重试')}</button></>:text('No comparable prices for these companies.','这些公司暂无可比价格。')}
  </p>:<>
  <div className={styles.summary} aria-live="polite">
   <span>{text('Sample coverage','样本覆盖')} {panel.count}/{sampleTotal}</span>
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
  </>}
  {key!=='fiveDayReturn'&&data.panels.length>0&&panel.rows.length>3&&<button type="button" className={styles.expand} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?text('Show fewer','收起'):text(`View all ${data.total} companies`,`查看全部 ${data.total} 家公司`)}</button>}
  {key==='fiveDayReturn'&&priceCount>3&&<div className={styles.pagination}>
   <button type="button" className={styles.expand} aria-expanded={expanded} onClick={()=>{setExpanded(value=>!value);setPricePage(0);}}>{expanded?text('Show fewer','收起'):text('View more peers','查看更多同业公司')}</button>
   {expanded&&<>
    <button type="button" className={styles.expand} disabled={pricePage===0} onClick={()=>setPricePage(p=>p-1)}>{text('Previous peers','上一页')}</button>
    <span> {pricePage+1}/{Math.ceil(priceCount/PRICE_PEER_PAGE_SIZE)} </span>
    <button type="button" className={styles.expand} disabled={(pricePage+1)*PRICE_PEER_PAGE_SIZE>=priceCount} onClick={()=>setPricePage(p=>p+1)}>{text('Next peers','下一页')}</button>
   </>}
  </div>}
 </section>;
}
