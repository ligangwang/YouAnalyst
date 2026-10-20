"use client";

import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from './providers/locale-provider';
import { EventTypeDetails } from './event-type-details';
import { IntelligenceEventPriceReturns } from './intelligence-price-performance';
import { intelligenceEventTitle, type IntelligenceEvent } from '@/lib/intelligence/model';
import type { EventPriceReturn } from '@/lib/intelligence/price-performance';
import styles from './event-details-window.module.css';
import { EventCompanyNameResolution } from './company-name-resolution';

export type EventWindowAnchor = {x:number;y:number;trigger:HTMLElement|null;host:HTMLElement|null};
export function eventWindowAnchor(event:MouseEvent<HTMLElement>,trigger=event.currentTarget):EventWindowAnchor {
  const rect=trigger.getBoundingClientRect();
  const pointer=event.detail>0||event.type==='contextmenu'&&(event.clientX!==0||event.clientY!==0);
  const target=event.target instanceof Element?event.target:trigger;
  return {x:pointer?event.clientX:rect.right,y:pointer?event.clientY:rect.bottom,trigger,host:target.closest<HTMLElement>('[data-chart-size="full"]')??trigger.closest<HTMLElement>('[data-chart-size="full"]')};
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
    const handle=element.querySelector('header')!;
    let moved=false,position={x:0,y:0};
    let drag:{id:number;x:number;y:number;left:number;top:number}|null=null;
    const moveTo=(x:number,y:number)=>{
      const rect=element.getBoundingClientRect();
      position={x:Math.max(12,Math.min(innerWidth-rect.width-12,x)),y:Math.max(12,Math.min(innerHeight-rect.height-12,y))};
      element.style.left=`${position.x}px`;element.style.top=`${position.y}px`;
    };
    const place=()=>{
      const width=Math.min(380,innerWidth-24);
      element.style.width=`${width}px`;
      element.style.maxHeight=`${Math.min(560,innerHeight-24)}px`;
      const height=element.getBoundingClientRect().height;
      const x=anchor?.x??innerWidth-width-26,y=anchor?.y??48;
      const left=x+14+width<=innerWidth-12?x+14:x-width-14;
      const top=y+14+height<=innerHeight-12?y+14:y-height-14;
      moveTo(moved?position.x:left,moved?position.y:top);
    };
    place();(focusClose?element.querySelector<HTMLElement>('header button'):element)?.focus({preventScroll:true});
    const observer=new ResizeObserver(place);observer.observe(element);
    const start=(event:PointerEvent)=>{
      if(event.button!==0||!event.isPrimary||(event.target instanceof Element&&event.target.closest('button,a,input,select,textarea')))return;
      event.preventDefault();event.stopPropagation();
      const rect=element.getBoundingClientRect();
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
      handle.setPointerCapture(event.pointerId);handle.focus({preventScroll:true});element.dataset.dragging='true';
    };
    const move=(event:PointerEvent)=>{
      if(!drag||event.pointerId!==drag.id)return;
      event.preventDefault();event.stopPropagation();moved=true;
      moveTo(drag.left+event.clientX-drag.x,drag.top+event.clientY-drag.y);
    };
    const stop=(event:PointerEvent)=>{
      if(!drag||event.pointerId!==drag.id)return;
      const id=drag.id;drag=null;delete element.dataset.dragging;
      if(handle.hasPointerCapture(id))handle.releasePointerCapture(id);
    };
    const nudge=(event:KeyboardEvent)=>{
      if(event.target!==handle||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();moved=true;
      const step=event.shiftKey?30:10;
      moveTo(position.x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0),position.y+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0));
    };
    handle.addEventListener('pointerdown',start);handle.addEventListener('pointermove',move);
    handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);handle.addEventListener('lostpointercapture',stop);handle.addEventListener('keydown',nudge);
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
    return()=>{
      observer.disconnect();document.removeEventListener('pointerdown',dismiss,true);document.removeEventListener('keydown',keyboard);window.removeEventListener('resize',place);
      handle.removeEventListener('pointerdown',start);handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);handle.removeEventListener('lostpointercapture',stop);handle.removeEventListener('keydown',nudge);
      if(drag&&handle.hasPointerCapture(drag.id))handle.releasePointerCapture(drag.id);
      delete element.dataset.dragging;
    };
  },[mounted,anchor,focusClose]);
  if(!mounted)return null;
  const host=anchor?.host?.isConnected?anchor.host:document.body;
  return createPortal(<section ref={root} role={role} aria-modal={role==='dialog'?false:undefined} aria-label={title} tabIndex={-1} data-event-window data-event-chooser={role==='group'||undefined} className={styles.window}>
    <header tabIndex={0} role="group" aria-label={text('Move window','移动窗口')} title={text('Drag to move · Arrow keys to move','拖动移动 · 方向键移动')}><strong>{title}</strong><button type="button" aria-label={closeLabel??text('Close event details','关闭事件详情')} onClick={()=>{onClose();if(anchor?.trigger?.isConnected)anchor.trigger.focus({preventScroll:true});}}>×</button></header>
    <div className={styles.body}>{children}</div>
  </section>,host);
}

export function EventDetailsWindow({event,anchor,returns,symbol,onClose}:{event:IntelligenceEvent;anchor?:EventWindowAnchor|null;returns?:EventPriceReturn[];symbol:(id:string)=>string;onClose:()=>void}) {
  const {text,chinese,locale}=useLocale();
  const title=intelligenceEventTitle(event,locale);
  return <FloatingEventWindow key={event.id} anchor={anchor} title={text('Event details','事件详情')} onClose={onClose}>
    <EventTypeDetails event={event} chinese={chinese}/>
    <h2>{title}</h2>
    <p className={styles.meta}>{event.companyIds.map(symbol).join(' · ')} · {text('Published','发布于')} {event.published_at?new Date(event.published_at).toLocaleString(locale,{timeZone:'America/New_York'})+' ET':event.publication_date}</p>
    {event.eventDate&&<p className={styles.meta}>{text('Business / filing date','业务／申报日期')} · {event.eventDate}</p>}
    <p>{event.summary==='交易所上市公司原始公告。'?text('Original announcement from an exchange-listed company.',event.summary):event.summary}</p>
    {event.planned&&<p>{text('Announced / planned; completion is not established.','已宣布／计划中；尚不代表已完成。')}</p>}
    <IntelligenceEventPriceReturns returns={returns} symbol={symbol} publicationDate={event.publication_date} publishedAt={event.published_at}/>
    <nav aria-label={text('Primary sources','原始来源')}>{event.evidence.map(source=><a key={source.id} title={source.title===event.title&&title!==event.title?source.title:undefined} href={source.url} target="_blank" rel="noopener noreferrer">{source.channel} · {source.title===event.title?title:source.title} ↗<small>{source.sourceDate??text('Publication date unavailable','发布日期不可用')}</small></a>)}</nav>
    {event.id.startsWith('news-')&&<EventCompanyNameResolution eventId={event.id}/>}
  </FloatingEventWindow>;
}
