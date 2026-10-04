'use client';

import type {IntelligenceEvent,IntelligenceSource} from '@/lib/intelligence/model';
import styles from './intelligence-summary.module.css';

export const intelligenceSourceColors:Record<IntelligenceSource,string>={SEC:'#ff9eae',IR:'#67e6bc',Exchange:'#65d9ff',GitHub:'#c4a0ff',X:'#f4eb87',Reddit:'#ffc57a',Other:'#8faaff'};

/** Only real, exact publisher datetimes contribute to an intraday chart. */
export function PublicationActivity({events,start,end,label}:{events:Pick<IntelligenceEvent,'published_at'>[];start:number;end:number;label:string}){
  const bins=Array<number>(24).fill(0),span=Math.max(1,end-start);
  for(const event of events){
    if(!event.published_at)continue;
    const at=Date.parse(event.published_at);
    if(at<start||at>end||!Number.isFinite(at))continue;
    bins[Math.min(23,Math.floor((at-start)/span*24))]++;
  }
  const max=Math.max(1,...bins);
  return <svg className={styles.sparkline} viewBox="0 0 72 16" role="img" aria-label={label}><title>{label}</title>{bins.map((count,index)=><rect key={index} x={index*3} y={count?15-count/max*13:14} width="2" height={count?count/max*13:1} rx=".5" fill={count?'#98e7d6':'#29404f'}/>)}</svg>;
}

export function ActiveCompanyMeter({active,total}:{active:number;total:number}){
  return <span className={styles.activeMeter} aria-hidden="true"><i style={{width:`${total?Math.min(100,active/total*100):0}%`}}/></span>;
}

export function SourceVolume({source,count,max,available}:{source:IntelligenceSource;count:number;max:number;available:boolean}){
  return <span className={styles.sourceMeter} aria-hidden="true" data-available={available}><i style={{width:`${available&&max?count/max*100:0}%`,background:intelligenceSourceColors[source]}}/></span>;
}
