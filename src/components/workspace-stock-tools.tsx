"use client";

import {useState} from 'react';
import type {KnowledgeGraph} from '@/lib/knowledge-graph/model';
import {parseSharedChart,sharedChartParams,type SharedChart} from '@/lib/ui/chart-share';
import {MA_PERIODS,movingAveragePeriods} from '@/lib/ui/technical-indicators';
import {ChartStockReview,type ChartWatchlist} from './chart-stock-review';
import {FloatingEventWindow,type EventWindowAnchor} from './event-details-window';
import {useIndustryBrowseParam,updateIndustryBrowse} from './industry-browse-state';
import {useLocale} from './providers/locale-provider';
import styles from './company-timeline.module.css';

/** Workspace preferences remain usable before a stock chart is mounted. */
export function WorkspaceStockTools({anchor,onClose,graph,watchlist,onSelect}:{anchor:EventWindowAnchor|null;onClose:()=>void;graph:KnowledgeGraph;watchlist:ChartWatchlist;onSelect:(id:string)=>void}){
 const {text}=useLocale();
 const chartRange=useIndustryBrowseParam('chartRange'),chartInterval=useIndustryBrowseParam('chartInterval'),chartStyle=useIndustryBrowseParam('chartStyle'),chartMA=useIndustryBrowseParam('chartMA'),chartMacd=useIndustryBrowseParam('chartMacd'),chartIndicator=useIndustryBrowseParam('chartIndicator'),chartActivity=useIndustryBrowseParam('chartActivity'),chartEvents=useIndustryBrowseParam('chartEvents');
 const showWatchlist=useIndustryBrowseParam('chartWatchlist')==='1';
 const settings=parseSharedChart(new URLSearchParams({chartRange,chartInterval,chartStyle,chartMA,chartMacd,chartIndicator,chartActivity,chartEvents}));
 const changeSettings=(patch:Partial<SharedChart>)=>updateIndustryBrowse(sharedChartParams({...settings,...patch}));
 const [averages,setAverages]=useState<EventWindowAnchor|null>(null);
 return <>
  <ChartStockReview companyId="" graph={graph} anchor={anchor} closeTools={onClose} settings={settings} changeSettings={changeSettings} openAverages={setAverages} selectCompany={node=>{onClose();onSelect(node.id);}} watchlist={watchlist} showWatchlist={showWatchlist} hideReview onShowWatchlistChange={show=>updateIndustryBrowse({chartWatchlist:show?'1':''})}/>
  {averages&&<FloatingEventWindow anchor={averages} title={text('Moving average settings','均线设置')} closeLabel={text('Close MA settings','关闭均线设置')} onClose={()=>setAverages(null)}>
   <div role="group" aria-label={text('Moving average lines','均线显示')} className={styles.indicatorControls}>{MA_PERIODS.map(period=><button key={period} type="button" aria-pressed={settings.averages.includes(period)} onClick={()=>changeSettings({averages:movingAveragePeriods(settings.averages.includes(period)?settings.averages.filter(value=>value!==period):[...settings.averages,period])})}>MA{period}</button>)}</div>
   <form key={settings.averages.join(',')} className={styles.maSettings} onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);changeSettings({averages:movingAveragePeriods(Array.from({length:8},(_,index)=>Number(form.get(`ma-${index}`))))});setAverages(null);}}>
    <p>{text('MA periods count bars in the selected interval. Set 0 to disable a line.','均线周期按所选K线的根数计算。填 0 关闭该线。')}</p>
    {Array.from({length:8},(_,index)=><label key={index}>{text('Line','均线')} {index+1}<input name={`ma-${index}`} type="number" min={0} max={500} step={1} defaultValue={settings.averages[index]??0}/></label>)}<button type="submit">{text('Apply','应用')}</button>
   </form>
  </FloatingEventWindow>}
 </>;
}
