"use client";
import type { GraphNode } from '@/lib/knowledge-graph/model';
import { companySector, GRAPH_SECTORS } from '@/lib/knowledge-graph/sectors';
import { sourceDocumentsForEvents, summarizeSourceDocuments, type IntelligenceSourceDocument, type IntelligenceEvent, type IntelligenceSource } from '@/lib/intelligence/model';
import { useLocale } from './providers/locale-provider';
import styles from './intelligence-activity-overview.module.css';

const sourceColors:Record<IntelligenceSource,string>={SEC:'#ff9eae',IR:'#67e6bc',Exchange:'#65d9ff',GitHub:'#c4a0ff',X:'#f4eb87',Reddit:'#ffc57a',Other:'#8faaff'};

export function IntelligenceActivityOverview({events,documents,complete=false,companies,recentFallback,period,sourceFilter,limit,truncated,onSector,onSource,onEvent}:{
  events:IntelligenceEvent[];documents?:IntelligenceSourceDocument[];complete?:boolean;companies:GraphNode[];recentFallback:boolean;period:'today'|'recent'|'replay';sourceFilter:IntelligenceSource|'';limit:number;truncated:boolean;
  onSector:(id:string)=>void;onSource:(source:IntelligenceSource)=>void;onEvent:(id:string)=>void;
}){
  const {text,chinese}=useLocale();
  const sourceDocuments=documents??sourceDocumentsForEvents(events);
  const activity=summarizeSourceDocuments(sourceDocuments,companies.map(company=>company.id),sourceFilter);
  const sources=activity.sources.filter(source=>source.count>0);
  const sectors=GRAPH_SECTORS.map(sector=>{
    const ids=new Set(companies.filter(company=>companySector(company).id===sector.id).map(company=>company.id));
    return {...sector,count:summarizeSourceDocuments(sourceDocuments,[...ids],sourceFilter).signals};
  }).filter(sector=>sector.count>0).sort((a,b)=>b.count-a.count);
  const largest=Math.max(1,...sectors.map(sector=>sector.count));
  if(!sourceDocuments.length)return null;
  return <section className={styles.overview} aria-label={text('Source activity overview','来源活动概览')}>
    <div className={styles.heading}><strong>{text('Source activity','来源活动')}</strong><span>{period==='recent'?text('Last 30 days','近 30 天'):period==='replay'?text('Replay','回放'):text('Today','今日')}{!complete&&text(' · Partial data',' · 部分数据')}</span></div>
    <div className={styles.metrics}>
      <div><strong>{activity.activeIds.length}</strong><span>{text('Active companies','活跃公司')}</span></div>
      <div><strong>{activity.signals}</strong><span>{text('Source documents','来源文档')}</span></div>
    </div>
    <p className={styles.scopeNote}>{!complete?text('Some sources are unavailable; totals are partial.','部分来源暂不可用；统计数据不完整。'):truncated?text(`Latest ${limit} entries shown; totals include all recorded sources in this period.`,`列表显示最新 ${limit} 条；统计涵盖该时段所有已收录来源。`):text('Totals include all recorded sources in this period.','统计涵盖该时段所有已收录来源。')}</p>
    <details className={styles.breakdown}><summary>{text('Sector breakdown','行业分布')}</summary>
    <div className={styles.sectors}>{sectors.map(sector=><button key={sector.id} onClick={()=>onSector(sector.id)} title={text('Explore this sector','探索此行业')}>
      <span>{chinese?sector.zh:sector.en}</span><i><b style={{width:`${sector.count/largest*100}%`,background:sector.color}}/></i><strong>{sector.count}</strong>
    </button>)}</div>
    <p className={styles.note}>{text('A document can appear in multiple sectors.','一份文档可涉及多个行业。')}</p></details>
    <div className={styles.heading}><span>{text('Source mix · documents','来源构成 · 文档')}</span></div>
    <div className={styles.sourceStrip}>{sources.map(source=><button key={source.name} onClick={()=>onSource(source.name)} style={{flexGrow:source.count,background:sourceColors[source.name]}} aria-label={`${source.name}: ${source.count}`} title={`${source.name} · ${source.count}`}/>)}</div>
    <div className={styles.sources}>{sources.map(source=><button key={source.name} onClick={()=>onSource(source.name)}><i style={{background:sourceColors[source.name]}}/>{source.name}<strong>{source.count}</strong></button>)}</div>
    {recentFallback&&<><div className={styles.heading}><span>{text('Recent event highlights','近期事件摘要')}</span></div><div className={styles.highlights}>{events.slice(0,3).map(event=><button key={event.id} onClick={()=>onEvent(event.id)}><time dateTime={event.publication_date}>{event.publication_date.slice(5)}</time><span>{event.title}</span><b>↗</b></button>)}</div><p className={styles.note}>{text('Recent sources, not new arrivals today. A document can appear in multiple sectors.','近期来源，并非今日新增。一份文档可涉及多个行业。')}</p></>}
  </section>;
}
