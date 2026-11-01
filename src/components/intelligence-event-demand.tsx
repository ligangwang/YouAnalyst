"use client";
import {useEffect,useRef,type ReactNode} from 'react';
import type {IntelligenceEvent} from '@/lib/intelligence/model';
import {useLocale} from './providers/locale-provider';

export function IntelligenceEventDemand({event,request,pending,failed,className,children}:{event:IntelligenceEvent;request:(ids:string[])=>void;pending:boolean;failed:boolean;className:string;children:ReactNode}){
  const ref=useRef<HTMLDivElement>(null),{chinese}=useLocale();
  const ids=JSON.stringify([event.id,...(event.relatedEventIds??[])]);
  useEffect(()=>{
    const element=ref.current;if(!element||typeof IntersectionObserver==='undefined')return;
    let visible=false;
    const load=()=>{if(visible&&document.visibilityState!=='hidden')request(JSON.parse(ids));};
    const observer=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);load();},{threshold:0});
    observer.observe(element);document.addEventListener('visibilitychange',load);
    return()=>{observer.disconnect();document.removeEventListener('visibilitychange',load);};
  },[ids,request]);
  return <div ref={ref} className={className} data-calendar={Boolean(event.calendarEvents?.length)}>{children}
    {failed?<button type="button" onClick={()=>request(JSON.parse(ids))}>{chinese?'重试详情':'Retry details'}</button>:pending?<small role="status">{chinese?'详情待加载':'Details pending'}</small>:null}
  </div>;
}
