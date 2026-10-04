"use client";
import type { GraphNode } from '@/lib/knowledge-graph/model';
import { companySector, GRAPH_SECTORS } from '@/lib/knowledge-graph/sectors';
import { summarizeIntelligence, type IntelligenceEvent, type IntelligenceSource } from '@/lib/intelligence/model';
import { useLocale } from './providers/locale-provider';
import styles from './intelligence-activity-overview.module.css';

const sourceColors:Record<IntelligenceSource,string>={SEC:'#ff9eae',IR:'#67e6bc',Exchange:'#65d9ff',GitHub:'#c4a0ff',X:'#f4eb87',Reddit:'#ffc57a',Other:'#8faaff'};

export function IntelligenceActivityOverview({events,companies,recentFallback,period,sourceFilter,limit,truncated,onSector,onSource,onEvent}:{
  events:IntelligenceEvent[];companies:GraphNode[];recentFallback:boolean;period:'today'|'recent'|'replay';sourceFilter:IntelligenceSource|'';limit:number;truncated:boolean;
  onSector:(id:string)=>void;onSource:(source:IntelligenceSource)=>void;onEvent:(id:string)=>void;
}){
  const {text,chinese}=useLocale();
  const activity=summarizeIntelligence(events,companies.map(company=>company.id),sourceFilter);
  const sources=activity.sources.filter(source=>source.count>0);
  const sectors=GRAPH_SECTORS.map(sector=>{
    const ids=new Set(companies.filter(company=>companySector(company).id===sector.id).map(company=>company.id));
    return {...sector,count:summarizeIntelligence(events,[...ids],sourceFilter).signals};
  }).filter(sector=>sector.count>0).sort((a,b)=>b.count-a.count);
  const largest=Math.max(1,...sectors.map(sector=>sector.count));
  if(!events.length)return null;
  return <section className={styles.overview} aria-label={text('Loaded source activity overview','已加载来源活动概览')}>
    <div className={styles.heading}><strong>{text('Source activity','来源活动')}</strong><span>{period==='recent'?text('Loaded · 30d','已加载 · 30 天'):period==='replay'?text('Loaded · replay','已加载 · 回放'):text('Loaded · today','已加载 · 今日')}</span></div>
    <div className={styles.metrics}>
      <div><strong>{activity.activeIds.length}</strong><span>{text('Active companies','活跃公司')}</span></div>
      <div><strong>{activity.signals}</strong><span>{text('Source documents','来源文档')}</span></div>
    </div>
    <p className={styles.scopeNote}>{truncated?text(`Feed limited to ${limit} entries; counts cover loaded sources only.`,`列表最多加载 ${limit} 条；统计仅涵盖已加载来源。`):text('Counts cover loaded sources only, not full-period totals.','统计仅涵盖已加载来源，并非整个时段的总量。')}</p>
    <div className={styles.heading}><span>{text('Source documents by sector','各行业来源文档')}</span></div>
    <div className={styles.sectors}>{sectors.map(sector=><button key={sector.id} onClick={()=>onSector(sector.id)} title={text('Explore this sector','探索此行业')}>
      <span>{chinese?sector.zh:sector.en}</span><i><b style={{width:`${sector.count/largest*100}%`,background:sector.color}}/></i><strong>{sector.count}</strong>
    </button>)}</div>
    <div className={styles.heading}><span>{text('Source mix · documents','来源构成 · 文档')}</span></div>
    <div className={styles.sourceStrip}>{sources.map(source=><button key={source.name} onClick={()=>onSource(source.name)} style={{flexGrow:source.count,background:sourceColors[source.name]}} aria-label={`${source.name}: ${source.count}`} title={`${source.name} · ${source.count}`}/>)}</div>
    <div className={styles.sources}>{sources.map(source=><button key={source.name} onClick={()=>onSource(source.name)}><i style={{background:sourceColors[source.name]}}/>{source.name}<strong>{source.count}</strong></button>)}</div>
    {recentFallback&&<><div className={styles.heading}><span>{text('Recent event highlights','近期事件摘要')}</span></div><div className={styles.highlights}>{events.slice(0,3).map(event=><button key={event.id} onClick={()=>onEvent(event.id)}><time dateTime={event.publication_date}>{event.publication_date.slice(5)}</time><span>{event.title}</span><b>↗</b></button>)}</div><p className={styles.note}>{text('Recent sources, not new arrivals today. A document can appear in multiple sectors.','近期来源，并非今日新增。一份文档可涉及多个行业。')}</p></>}
  </section>;
}
