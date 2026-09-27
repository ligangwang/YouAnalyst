"use client";

import { PrivateValuationDisplay } from './private-valuation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CompanyFundamentals } from '@/lib/fundamentals/model';
import { companyName, type GraphNode } from '@/lib/knowledge-graph/model';
import { marketCapDescription } from '@/lib/knowledge-graph/market-cap';
import { companyPageUrl } from '@/lib/market-companies/routes';
import { CompanyCountryFlag } from './company-country-flag';
import { CompanyFollowButton } from './company-follow-button';
import { useLocale } from './providers/locale-provider';
import styles from './industry-tree.module.css';
import { useNodeCardPosition } from './use-node-card-position';

type Snapshot = Pick<CompanyFundamentals,'metrics'|'marketCap'|'report'|'stale'>;
export function TreeCompanyCard({company,color,onClose,reveal=false}:{company:GraphNode;color:string;onClose:()=>void;reveal?:boolean}) {
  const {locale,text}=useLocale();
  const [result,setResult]=useState<{data:Snapshot|null;error?:boolean}|null>(null);
  const close=useRef<HTMLButtonElement>(null);
  const card=useNodeCardPosition(company.id,'tree');
  // A card opened from outside the tree (list, graph, links) may sit below the fold; bring it into view.
  useEffect(()=>{if(reveal)card.current?.scrollIntoView({block:'nearest'});},[reveal,company.id,card]);
  useEffect(()=>{
    close.current?.focus({preventScroll:true});
    if(!company.id.startsWith('US:')) return;
    const controller=new AbortController();
    fetch(`/api/company-fundamentals?ticker=${encodeURIComponent(company.id.slice(3))}`,{signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error('unavailable');return response.json();})
      .then(value=>setResult(value)).catch(()=>{if(!controller.signal.aborted)setResult({data:null,error:true});});
    return ()=>controller.abort();
  },[company.id]);
  const data=result?.data;
  const cap=data?.marketCap?.status==='estimated'&&data.marketCap.value&&data.marketCap.priceDate?{value:data.marketCap.value,currency:data.marketCap.currency,priceDate:data.marketCap.priceDate}:company.marketCap;
  const number=(value:number|null|undefined,unit?:string|null)=>typeof value==='number'&&Number.isFinite(value)
    ? `${new Intl.NumberFormat(locale,{notation:'compact',maximumFractionDigits:2}).format(value)} ${unit??''}`
    : text('Unavailable','暂无');
  return <aside ref={card} role="dialog" aria-modal="false" aria-label={text('Company details','公司详情')} className={styles.companyCard}
    style={{'--card-accent':color} as CSSProperties} onPointerDown={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()}
    onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')onClose();}}>
    <header className={styles.cardHeader}><span>{text('Company snapshot','公司基本面')}</span><button ref={close} aria-label={text('Close company details','关闭公司详情')} onClick={onClose}>×</button></header>
    <div className={styles.cardBody}>
      <h3><CompanyCountryFlag country={company.country} locale={locale}/>{companyName(company,locale)}</h3>
      <p className={styles.cardTicker}>{company.symbol??text('Private / unlisted','非上市')}</p>
      <div className={styles.cardCap}>{company.privateValuation ? <PrivateValuationDisplay valuation={company.privateValuation}/> : <><small>{text('Estimated market cap','估算市值')}</small><p>{cap?marketCapDescription(cap,locale):text('Unavailable','暂无')}</p></>}</div>
      {company.id.startsWith('US:')&&!result&&<p role="status">{text('Loading cached financials…','正在读取已缓存财务数据…')}</p>}
      <dl className={styles.cardMetrics}>
        <div><dt>{text('Cached close','已缓存收盘价')}</dt><dd>{number(data?.marketCap?.close,data?.marketCap?.currency)}</dd><small>{data?.marketCap?.priceDate}</small></div>
        {([['Revenue','Annual revenue','年度营收'],['Net income','Annual net income','年度净利润']] as const).map(([label,en,zh])=>{
          const metric=data?.metrics.find(m=>m.label===label);
          return <div key={label}><dt>{text(en,zh)}</dt><dd>{number(metric?.value,metric?.unit)}</dd><small>{metric?.start&&`${metric.start} → `}{metric?.end}</small></div>;
        })}
      </dl>
      {result?.error&&<p role="status">{text('Financial data could not be loaded. Reopen this card to retry.','财务数据暂时无法加载，可重新打开卡片重试。')}</p>}
      {data?.stale&&<p>{text('Showing an older cached snapshot.','当前显示较早的缓存快照。')}</p>}
      {data&&<small>{text('Source: SEC annual filings; annual figures, not TTM.','来源：SEC 年报；年度数据，非滚动十二个月。')}</small>}
      {company.summary&&<p className={styles.cardSummary}>{company.summary}</p>}
      <div className={styles.cardActions}><CompanyFollowButton companyId={company.id}/><a href={companyPageUrl(company.id.startsWith('US:')?company.id.slice(3):company.id,company.market)}>{text('Company profile','公司详情')} ↗</a></div>
    </div>
  </aside>;
}
