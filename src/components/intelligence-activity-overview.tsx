"use client";
import type { GraphNode } from '@/lib/knowledge-graph/model';
import { companySector, GRAPH_SECTORS } from '@/lib/knowledge-graph/sectors';
import { summarizeIntelligence, type IntelligenceEvent, type IntelligenceSource } from '@/lib/intelligence/model';
import { useLocale } from './providers/locale-provider';
import styles from './intelligence-activity-overview.module.css';

const sourceColors:Record<IntelligenceSource,string>={SEC:'#ff9eae',IR:'#67e6bc',Exchange:'#65d9ff',GitHub:'#c4a0ff',X:'#f4eb87',Reddit:'#ffc57a',Other:'#8faaff'};

export function IntelligenceActivityOverview({events,companies,recentFallback,onSector,onSource,onEvent}:{
  events:IntelligenceEvent[];companies:GraphNode[];recentFallback:boolean;
  onSector:(id:string)=>void;onSource:(source:IntelligenceSource)=>void;onEvent:(id:string)=>void;
}){
  const {text,chinese}=useLocale();
  const activity=summarizeIntelligence(events,companies.map(company=>company.id),'');
  const sources=activity.sources.filter(source=>source.count>0);
  const sectors=GRAPH_SECTORS.map(sector=>{
    const ids=new Set(companies.filter(company=>companySector(company).id===sector.id).map(company=>company.id));
    return {...sector,count:events.filter(event=>event.companyIds.some(id=>ids.has(id))).length};
  }).filter(sector=>sector.count>0).sort((a,b)=>b.count-a.count);
  const largest=Math.max(1,...sectors.map(sector=>sector.count));
  if(!events.length)return null;
  return <section className={styles.overview} aria-label={text('Event activity overview','事件活动概览')}>
    <div className={styles.heading}><strong>{text('Event activity','事件活动')}</strong><span>{recentFallback?text('Last 30 days','近 30 天'):text('Selected period','当前时段')}</span></div>
    <div className={styles.metrics}>
      <div><strong>{activity.activeIds.length}</strong><span>{text('Active companies','活跃公司')}</span></div>
      <div><strong>{events.length}</strong><span>{text('Clusters','事件簇')}</span></div>
      <div><strong>{activity.signals}</strong><span>{text('Documents','来源文档')}</span></div>
    </div>
    <div className={styles.heading}><span>{text('Clusters by sector','各行业事件簇')}</span></div>
    <div className={styles.sectors}>{sectors.map(sector=><button key={sector.id} onClick={()=>onSector(sector.id)} title={text('Explore this sector','探索此行业')}>
      <span>{chinese?sector.zh:sector.en}</span><i><b style={{width:`${sector.count/largest*100}%`,background:sector.color}}/></i><strong>{sector.count}</strong>
    </button>)}</div>
    <div className={styles.heading}><span>{text('Source mix · documents','来源构成 · 文档')}</span></div>
    <div className={styles.sourceStrip}>{sources.map(source=><button key={source.name} onClick={()=>onSource(source.name)} style={{flexGrow:source.count,background:sourceColors[source.name]}} aria-label={`${source.name}: ${source.count}`} title={`${source.name} · ${source.count}`}/>)}</div>
    <div className={styles.sources}>{sources.map(source=><button key={source.name} onClick={()=>onSource(source.name)}><i style={{background:sourceColors[source.name]}}/>{source.name}<strong>{source.count}</strong></button>)}</div>
    {recentFallback&&<><div className={styles.heading}><span>{text('Recent event highlights','近期事件摘要')}</span></div><div className={styles.highlights}>{events.slice(0,3).map(event=><button key={event.id} onClick={()=>onEvent(event.id)}><time dateTime={event.publication_date}>{event.publication_date.slice(5)}</time><span>{event.title}</span><b>↗</b></button>)}</div><p className={styles.note}>{text('Recent records, not new arrivals today. A cluster can span multiple sectors.','近期记录，并非今日新增。一个事件簇可涉及多个行业。')}</p></>}
  </section>;
}
