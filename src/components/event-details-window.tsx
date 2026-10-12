"use client";

import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from './providers/locale-provider';
import { EventTypeDetails } from './event-type-details';
import { IntelligenceEventPriceReturns } from './intelligence-price-performance';
import { intelligenceEventTitle, type IntelligenceEvent } from '@/lib/intelligence/model';
import type { EventPriceReturn } from '@/lib/intelligence/price-performance';
import styles from './event-details-window.module.css';

export type EventWindowAnchor = {x:number;y:number;trigger:HTMLElement|null;host:HTMLElement|null};
export function eventWindowAnchor(event:MouseEvent<HTMLElement>):EventWindowAnchor {
  const rect=event.currentTarget.getBoundingClientRect();
  return {x:event.detail?event.clientX:rect.right,y:event.detail?event.clientY:rect.bottom,trigger:event.currentTarget,host:event.currentTarget.closest<HTMLElement>('[data-chart-size="full"]')};
}
const subscribe=()=>()=>{};
export function FloatingEventWindow({anchor,title,children,onClose,closeLabel,role='dialog',focusClose=false}:{anchor?:EventWindowAnchor|null;title:string;children:ReactNode;onClose:()=>void;closeLabel?:string;role?:'dialog'|'group';focusClose?:boolean}) {
  const {text}=useLocale();
  const mounted=useSyncExternalStore(subscribe,()=>true,()=>false);
  const root=useRef<HTMLElement>(null);
  const close=useRef(onClose);
  useLayoutEffect(()=>{close.current=onClose;},[onClose]);
  useLayoutEffect(()=>{
    const element=root.current;if(!mounted||!element)return;
    const place=()=>{
      const width=Math.min(380,innerWidth-24);
      element.style.width=`${width}px`;
      element.style.maxHeight=`${Math.min(560,innerHeight-24)}px`;
      const height=element.getBoundingClientRect().height;
      const x=anchor?.x??innerWidth-width-26,y=anchor?.y??48;
      const left=x+14+width<=innerWidth-12?x+14:x-width-14;
      const top=y+14+height<=innerHeight-12?y+14:y-height-14;
      element.style.left=`${Math.max(12,Math.min(innerWidth-width-12,left))}px`;
      element.style.top=`${Math.max(12,Math.min(innerHeight-height-12,top))}px`;
    };
    place();(focusClose?element.querySelector<HTMLElement>('header button'):element)?.focus({preventScroll:true});
    const observer=new ResizeObserver(place);observer.observe(element);
    const dismiss=(event:PointerEvent)=>{
      if(event.target instanceof Element&&event.target.closest('[data-event-trigger]'))return;
      if(event.target instanceof Node&&!element.contains(event.target)&&!anchor?.trigger?.contains(event.target))close.current();
    };
    const keyboard=(event:KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      event.preventDefault();event.stopPropagation();close.current();
      if(anchor?.trigger?.isConnected)anchor.trigger.focus({preventScroll:true});
    };
    document.addEventListener('pointerdown',dismiss,true);document.addEventListener('keydown',keyboard);
    window.addEventListener('resize',place);
    return()=>{observer.disconnect();document.removeEventListener('pointerdown',dismiss,true);document.removeEventListener('keydown',keyboard);window.removeEventListener('resize',place);};
  },[mounted,anchor,focusClose]);
  if(!mounted)return null;
  const host=anchor?.host?.isConnected?anchor.host:document.body;
  return createPortal(<section ref={root} role={role} aria-modal={role==='dialog'?false:undefined} aria-label={title} tabIndex={-1} data-event-window data-event-chooser={role==='group'||undefined} className={styles.window}>
    <header><strong>{title}</strong><button type="button" aria-label={closeLabel??text('Close event details','关闭事件详情')} onClick={()=>{onClose();if(anchor?.trigger?.isConnected)anchor.trigger.focus({preventScroll:true});}}>×</button></header>
    <div className={styles.body}>{children}</div>
  </section>,host);
}

export function EventDetailsWindow({event,anchor,returns,symbol,onClose}:{event:IntelligenceEvent;anchor?:EventWindowAnchor|null;returns?:EventPriceReturn[];symbol:(id:string)=>string;onClose:()=>void}) {
  const {text,chinese,locale}=useLocale();
  const title=intelligenceEventTitle(event,locale);
  return <FloatingEventWindow key={event.id} anchor={anchor} title={text('Event details','事件详情')} onClose={onClose}>
    <EventTypeDetails event={event} chinese={chinese}/>
    <h2>{title}</h2>
    <p className={styles.meta}>{event.companyIds.map(symbol).join(' · ')} · {text('Published','发布于')} {event.published_at?new Date(event.published_at).toLocaleString(locale,{timeZone:'America/New_York'})+' ET':`${event.publication_date} · ${text('date only','仅日期')}`}</p>
    {event.eventDate&&<p className={styles.meta}>{text('Business / filing date','业务／申报日期')} · {event.eventDate}</p>}
    <p>{event.summary==='交易所上市公司原始公告。'?text('Original announcement from an exchange-listed company.',event.summary):event.summary}</p>
    {event.planned&&<p>{text('Announced / planned; completion is not established.','已宣布／计划中；尚不代表已完成。')}</p>}
    <IntelligenceEventPriceReturns returns={returns} symbol={symbol}/>
    <nav aria-label={text('Primary sources','原始来源')}>{event.evidence.map(source=><a key={source.id} title={source.title===event.title&&title!==event.title?source.title:undefined} href={source.url} target="_blank" rel="noopener noreferrer">{source.channel} · {source.title===event.title?title:source.title} ↗<small>{source.sourceDate??text('Publication date unavailable','发布日期不可用')}</small></a>)}</nav>
  </FloatingEventWindow>;
}
