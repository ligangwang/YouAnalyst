"use client";

import {useRef,useState} from 'react';
import {companyName,type GraphNode,type KnowledgeGraph} from '@/lib/knowledge-graph/model';
import {STOCK_SECTOR_GROUPS,stockSectors,stockSectorPeers} from '@/lib/knowledge-graph/stock-sectors';
import {signedPercent} from '@/lib/intelligence/price-performance';
import type {SharedChart} from '@/lib/ui/chart-share';
import {companyResearchPath} from '@/lib/ui/chart-share';
import {localizedPath} from '@/lib/ui/i18n/urls';
import {useCompanyFollows} from './company-follow-button';
import {useSessionCompanyWatchlist} from './use-session-company-watchlist';
import {useLocale} from './providers/locale-provider';
import {FloatingEventWindow,type EventWindowAnchor} from './event-details-window';
import styles from './chart-stock-review.module.css';

export type ChartWatchlist={ids:string[];loading:boolean;error:boolean;session:boolean;change:(id:string,follow:boolean)=>Promise<void>;refresh:()=>void};
type Props={companyId:string;company?:GraphNode;graph?:KnowledgeGraph|null;anchor:EventWindowAnchor|null;closeTools:()=>void;settings:SharedChart;changeSettings:(patch:Partial<SharedChart>)=>void;openAverages:(anchor:EventWindowAnchor)=>void;selectCompany:(company:GraphNode)=>void;watchlist?:ChartWatchlist;showWatchlist:boolean;hideReview?:boolean;onShowWatchlistChange:(show:boolean)=>void};

export function ChartStockReview(props:Props){
 const {text,locale,chinese}=useLocale();
 const follows=useCompanyFollows();
 const guest=useSessionCompanyWatchlist();
 const [pending,setPending]=useState(false),[failed,setFailed]=useState(false);
 const locked=useRef(false);
 const [sector,setSector]=useState('');
 const [sectorsOpen,setSectorsOpen]=useState(false);
 const [reviewSector,setReviewSector]=useState('');
 const watchlist:ChartWatchlist=props.watchlist??{
  ids:follows.user?follows.ids:guest.ids,loading:follows.loading||Boolean(follows.user)&&!follows.ready&&!follows.error,error:follows.error,session:!follows.user,
  change:async(id,follow)=>{if(follows.user)await follows.change(id,follow);else guest.change(id,follow);},refresh:()=>{void follows.refresh();},
 };
 const companies=[...new Map((props.graph?.nodes??[]).filter(node=>node.kind==='COMPANY').map(node=>[node.id,node])).values()];
 const byId=new Map(companies.map(node=>[node.id,node]));
 if(props.company)byId.set(props.company.id,{...byId.get(props.company.id),...props.company});
 const current=byId.get(props.companyId);
 const fallback=(id:string):GraphNode=>({id,kind:'COMPANY',order:0,symbol:id.split(':').slice(1).join(':'),name:id.split(':').slice(1).join(':')||id});
 const selected=current??fallback(props.companyId);
 const sectors=current?stockSectors(current,props.graph,watchlist.ids):[];
 const selectedSector=sectors.find(item=>item.id===sector);
 const peers=selectedSector?stockSectorPeers(selectedSector,props.companyId,props.graph,watchlist.ids):[];
 const activeReviewSector=sectors.find(item=>item.id===reviewSector)??sectors[0];
 const reviewPeers=activeReviewSector?stockSectorPeers(activeReviewSector,props.companyId,props.graph,watchlist.ids):[];
 const saved=watchlist.ids.map(id=>byId.get(id)??fallback(id));
 const followed=watchlist.ids.includes(props.companyId);
 const close=()=>{setSector('');setSectorsOpen(false);props.closeTools();};
 async function toggleFollow(){
  if(!props.companyId||locked.current||watchlist.loading)return;
  locked.current=true;setPending(true);setFailed(false);
  try{await watchlist.change(props.companyId,!followed);}catch{setFailed(true);}finally{locked.current=false;setPending(false);}
 }
 function rows(nodes:GraphNode[]){return <div className={styles.scroll}><table>
  <thead><tr><th>{text('Company','公司')}</th><th>{text('Ticker','代码')}</th><th>{text('Last close','最新收盘')}</th><th>{text('Change','涨跌幅')}</th><th>{text('Price date','行情日期')}</th></tr></thead>
  <tbody>{nodes.map(node=><tr key={node.id} aria-selected={node.id===props.companyId}>
   <td><button type="button" onClick={()=>{close();props.selectCompany(node);}}>{companyName(node,locale)}</button></td><td>{node.symbol??node.id}</td>
   <td>{node.dailyPrice?`${new Intl.NumberFormat(locale,{maximumFractionDigits:2}).format(node.dailyPrice.close)} ${node.dailyPrice.currency}`:'—'}</td>
   <td className={node.dailyPrice?.change==null?undefined:node.dailyPrice.change>0?'price-up':node.dailyPrice.change<0?'price-down':undefined}>{node.dailyPrice?.change==null?'—':signedPercent(node.dailyPrice.change)}</td><td>{node.dailyPrice?.tradingDate??'—'}</td>
  </tr>)}</tbody>
 </table></div>;}
 return <>
  {!props.hideReview&&sectors.length>0&&<section className={styles.review} aria-label={text('Sector companies','同板块公司')} data-chart-sectors>
   <header><h3>{text('Sectors','所属板块')}</h3><small>{text('Select a company to switch its chart','点击公司切换图表')}</small></header>
   <div className={styles.sectorTabs} role="group" aria-label={text('Select sector','选择板块')}>{sectors.map(item=><button type="button" key={item.id} aria-pressed={item.id===activeReviewSector?.id} onClick={()=>setReviewSector(item.id)}>{chinese?item.zh:item.en}</button>)}</div>
   <p>{activeReviewSector&&(chinese?activeReviewSector.zh:activeReviewSector.en)} · {reviewPeers.length} {text('other covered companies','家已覆盖的其他公司')}</p>
   {reviewPeers.length?rows(reviewPeers):<p>{text('No other covered companies in this sector.','当前覆盖数据中暂无其他同板块公司。')}</p>}
   {activeReviewSector&&activeReviewSector.sources.length>0&&<details><summary>{text('Classification sources','分类依据')}</summary>{activeReviewSector.sources.map(source=><a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>)}</details>}
  </section>}
  {props.anchor&&<FloatingEventWindow anchor={props.anchor} title={text('Stock tools','股票工具')+(props.companyId?' · '+(selected.symbol??companyName(selected,locale)):'')} closeLabel={text('Close stock tools','关闭股票工具')} onClose={close}>
   <div className={styles.tools}>
    {selectedSector?<>
     <button type="button" onClick={()=>setSector('')}>← {text('Stock tools','股票工具')}</button>
     <h3>{chinese?selectedSector.zh:selectedSector.en}</h3>
     <p>{companyName(selected,locale)} · {text('Sector member','所属板块')}</p>
     <p>{text('Other companies covered in this graph','当前图谱覆盖的同板块其他公司')} · {peers.length}</p>
     {peers.length?rows(peers):<p>{text('No other covered companies in this sector.','当前覆盖数据中暂无其他同板块公司。')}</p>}
     {selectedSector.sources.length>0&&<details><summary>{text('Classification sources','分类依据')}</summary>{selectedSector.sources.map(source=><a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>)}</details>}
    </>:<>
     {!props.companyId&&<><p>{text('Select a stock to open its chart and company tools.','选择股票以打开图表和公司工具。')}</p><details><summary>{text('Select stock','选择股票')}</summary>{rows(companies)}</details>{saved.length>0&&<details><summary>{text('Saved stocks','自选股票')}</summary>{rows(saved)}</details>}</>}
     {props.companyId&&<><button type="button" disabled={pending||watchlist.loading} aria-pressed={followed} onClick={()=>void toggleFollow()}>{pending?text('Saving…','保存中…'):followed?text('Remove from watchlist','移出自选股'):text('Add to watchlist','加入自选股')}</button>
     <details open={sectorsOpen} onToggle={event=>setSectorsOpen(event.currentTarget.open)}><summary>{text('Sectors','所属板块')}</summary>{sectors.length?STOCK_SECTOR_GROUPS.map(group=>{
      const items=sectors.filter(item=>item.group===group.id);
      return items.length>0&&<div key={group.id} role="group" aria-label={chinese?group.zh:group.en} className={styles.sectorGroup}><strong>{chinese?group.zh:group.en}</strong>{items.map(item=><button type="button" key={item.id} onClick={()=>setSector(item.id)}>{chinese?item.zh:item.en} →</button>)}</div>;
     }):<p>{text('Sector classification is not available in the current graph.','当前图谱暂无此公司的板块分类。')}</p>}</details>
     <a href={companyResearchPath(props.companyId,locale)} onClick={close}>{text('Company research','公司研究')} ↗</a>
     {!props.companyId.startsWith('ORG:')&&<a href={localizedPath('/compare?'+new URLSearchParams({symbols:props.companyId.replace(/^US:/,'')}).toString(),locale)} onClick={close}>{text('Compare performance','对比表现')} ↗</a>}</>}
     <label className={styles.panelToggle}><input type="checkbox" checked={props.showWatchlist} onChange={event=>props.onShowWatchlistChange(event.target.checked)}/>{text('Watchlist','自选股')}</label>
     <hr/><strong>{text('Technical indicators','技术指标')}</strong>
     <button type="button" onClick={()=>{const anchor=props.anchor!;close();props.openAverages(anchor);}}>{text('Moving average settings','均线设置')}…</button>
     {(['volume','turnover'] as const).map(activity=><button key={activity} type="button" aria-pressed={props.settings.activity===activity} onClick={()=>props.changeSettings({activity})}>{activity==='volume'?text('Volume','成交量'):text('Turnover','成交额')}</button>)}
     {(['macd','kdj','boll'] as const).map(indicator=><button type="button" key={indicator} aria-pressed={props.settings.indicator===indicator} onClick={()=>{const next=props.settings.indicator===indicator?'none':indicator;props.changeSettings({indicator:next,macd:next==='macd'});}}>{indicator.toUpperCase()}</button>)}
    </>}
    {failed&&<p role="alert">{text('Could not update watchlist. Please retry.','自选股更新失败，请重试。')}</p>}
   </div>
  </FloatingEventWindow>}
  {props.showWatchlist&&!props.hideReview&&<section className={styles.review} aria-label={text('Watchlist review','自选股复盘')} data-chart-watchlist>
   <header><h3>{text('Watchlist review','自选股复盘')} <small>{saved.length}</small></h3><button type="button" disabled={pending||watchlist.loading} aria-pressed={followed} onClick={()=>void toggleFollow()}>{pending?text('Saving…','保存中…'):followed?text('Remove current stock','移出当前股票'):text('Add current stock','加入当前股票')}</button></header>
   {watchlist.session&&<p>{text('Session watchlist · sign in to save across visits.','本次会话自选股 · 登录后可跨访问保存。')}</p>}
   {watchlist.error&&<button type="button" onClick={watchlist.refresh}>{text('Could not refresh watchlist. Retry','自选股刷新失败，重试')}</button>}
   {watchlist.loading&&!saved.length?<p role="status">{text('Loading watchlist…','正在加载自选股…')}</p>:saved.length?rows(saved):!watchlist.error&&<p>{text('Add stocks to review them below the chart. Select a row to switch charts.','加入自选股后将在图表下方显示，点击股票即可切换图表。')}</p>}
   {failed&&!props.anchor&&<p role="alert">{text('Could not update watchlist. Please retry.','自选股更新失败，请重试。')}</p>}
  </section>}
 </>;
}
