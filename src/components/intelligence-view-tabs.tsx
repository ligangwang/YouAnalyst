"use client";

import { INDUSTRY_VIEWS, type IndustryView } from '@/lib/knowledge-graph/views';
import { useLocale } from './providers/locale-provider';
import styles from './intelligence-center-views.module.css';

export function IntelligenceViewTabs({view,onChange,id}:{view:IndustryView;onChange:(view:IndustryView)=>void;id:string}){
  const {text}=useLocale();
  return <div className={styles.tabs} role="tablist" aria-label={text('Universe views','公司宇宙视图')}>
    {([['graph','Graph','关系图','Relationship graph','关系图谱'],['tree','Tree','树状图','Industry tree','产业树'],['hierarchy','Hierarchy','层级图','Company hierarchy','公司层级图'],['table','List','列表','Company list','公司列表']] as const).map(([key,en,zh,label,labelZh])=><button key={key} type="button" role="tab" id={`${id}-${key}`} aria-label={text(label,labelZh)} aria-selected={view===key} aria-controls={`${id}-panel`} tabIndex={view===key?0:-1} onClick={()=>onChange(key)} onKeyDown={event=>{
      const index=INDUSTRY_VIEWS.indexOf(key);
      const next=event.key==='ArrowRight'?INDUSTRY_VIEWS[(index+1)%4]:event.key==='ArrowLeft'?INDUSTRY_VIEWS[(index+3)%4]:event.key==='Home'?INDUSTRY_VIEWS[0]:event.key==='End'?INDUSTRY_VIEWS[3]:undefined;
      if(next){event.preventDefault();onChange(next);document.getElementById(`${id}-${next}`)?.focus();}
    }}>{text(en,zh)}</button>)}
  </div>;
}
